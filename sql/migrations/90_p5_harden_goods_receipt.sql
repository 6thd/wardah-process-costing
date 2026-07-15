-- ===================================================================
-- Migration 90: تشديد استلام البضاعة — علاقات + منع تجاوز + PO ذرّي + سباق
-- ===================================================================
-- ملاحظات المراجعة على Migration 89:
--   - لا تحقق: المورد = مورد أمر الشراء، سطر PO تابع لنفس الأمر، منتج السطر
--     يطابق المستلم، عدم تجاوز الكمية المطلوبة، ملكية المخزن، حالة PO للاستلام،
--     الكمية/التكلفة غير سالبتين.
--   - تحديث كميات/حالة أمر الشراء يتم في الواجهة منفصلاً (غير ذرّي).
--   - سباق idempotency: طلبان متزامنان بنفس المفتاح ⇒ الثاني يحصل على
--     unique_violation بدل إعادة النتيجة.
--
-- هذا الملف يعيد تعريف rpc_post_goods_receipt (CREATE OR REPLACE — إضافي)
-- بكل القيود، وينقل تحديث سطور/حالة أمر الشراء داخل نفس المعاملة، ويصلح
-- سباق idempotency بنقل الفحص إلى ما بعد القفل الاستشاري (تسلسل لكل مؤسسة).
-- التقييم/دفتر المخزون (bins) يبقى في الواجهة عمداً (بعد إصلاح P0 يستخدم
-- المحرّك الحقيقي) — بورت SQL له دفعة مخصّصة.
-- ===================================================================

CREATE OR REPLACE FUNCTION public.rpc_post_goods_receipt(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org        UUID;
    v_uid        UUID;
    v_gr_id      UUID;
    v_gr_number  TEXT;
    v_po_id      UUID;
    v_po_status  TEXT;
    v_po_vendor  UUID;
    v_vendor_id  UUID;
    v_wh_id      UUID;
    v_idem_key   TEXT;
    v_existing_id UUID;
    v_existing_no TEXT;
    v_line       JSONB;
    v_line_no    INTEGER := 0;
    v_prod       UUID;
    v_recv       NUMERIC;
    v_cost       NUMERIC;
    v_quality    TEXT;
    v_total      NUMERIC := 0;
    v_pol        RECORD;
    v_pol_id     UUID;
BEGIN
    -- ===== المؤسسة + العضوية =====
    v_org := wardah_org_id(NULLIF(p_payload->>'tenant_id', '')::UUID);
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'ORG_NOT_RESOLVED: تعذر تحديد هوية المؤسسة';
    END IF;
    v_uid := auth.uid();
    IF v_uid IS NULL OR NOT EXISTS (
        SELECT 1 FROM user_organizations WHERE user_id = v_uid AND org_id = v_org
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN_ORG: المستخدم ليس عضواً في المؤسسة المطلوبة';
    END IF;

    v_vendor_id := (p_payload->>'vendor_id')::UUID;
    IF v_vendor_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_PAYLOAD: vendor_id مطلوب';
    END IF;
    IF jsonb_array_length(COALESCE(p_payload->'lines', '[]'::JSONB)) = 0 THEN
        RAISE EXCEPTION 'INVALID_PAYLOAD: لا سطور في سند الاستلام';
    END IF;

    -- ===== المخزن يخص المؤسسة (إن مُرِّر) =====
    v_wh_id := NULLIF(p_payload->>'warehouse_id', '')::UUID;
    IF v_wh_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM warehouses WHERE id = v_wh_id AND org_id = v_org
    ) THEN
        RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND: المخزن ليس ضمن مؤسستك';
    END IF;

    -- ===== أمر الشراء: ملكية + حالة قابلة للاستلام + مطابقة المورد =====
    v_po_id := NULLIF(p_payload->>'purchase_order_id', '')::UUID;
    IF v_po_id IS NOT NULL THEN
        SELECT status, vendor_id INTO v_po_status, v_po_vendor
        FROM purchase_orders WHERE id = v_po_id AND org_id = v_org
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PO_NOT_FOUND: أمر الشراء ليس ضمن مؤسستك';
        END IF;
        IF v_po_status NOT IN ('approved', 'submitted', 'partially_received') THEN
            RAISE EXCEPTION 'PO_NOT_RECEIVABLE: حالة أمر الشراء (%) لا تسمح بالاستلام', v_po_status;
        END IF;
        IF v_po_vendor IS NOT NULL AND v_po_vendor <> v_vendor_id THEN
            RAISE EXCEPTION 'VENDOR_MISMATCH: المورد لا يطابق مورد أمر الشراء';
        END IF;
    END IF;

    -- ===== فحص الفترة (إن وُجد) =====
    BEGIN
        PERFORM assert_period_open(
            v_org, COALESCE((p_payload->>'receipt_date')::DATE, CURRENT_DATE)
        );
    EXCEPTION WHEN undefined_function THEN NULL;
    END;

    -- ===== قفل استشاري (تسلسل لكل مؤسسة) ثم فحص idempotency = لا سباق =====
    PERFORM pg_advisory_xact_lock(hashtext('goods_receipts:' || v_org::TEXT));

    v_idem_key := NULLIF(p_payload->>'idempotency_key', '');
    IF v_idem_key IS NOT NULL THEN
        SELECT id, receipt_number INTO v_existing_id, v_existing_no
        FROM goods_receipts WHERE org_id = v_org AND idempotency_key = v_idem_key;
        IF v_existing_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', TRUE, 'goods_receipt_id', v_existing_id,
                'receipt_number', v_existing_no, 'idempotent_replay', TRUE
            );
        END IF;
    END IF;

    -- ===== رقم السند =====
    SELECT 'GR-' || LPAD((
        COALESCE(MAX(NULLIF(regexp_replace(receipt_number, '\D', '', 'g'), ''))::BIGINT, 0) + 1
    )::TEXT, 6, '0')
    INTO v_gr_number
    FROM goods_receipts
    WHERE org_id = v_org AND receipt_number ~ '^GR-\d+$';
    v_gr_number := COALESCE(v_gr_number, 'GR-000001');

    -- ===== الرأس =====
    INSERT INTO goods_receipts (
        org_id, receipt_number, purchase_order_id, vendor_id, receipt_date,
        warehouse_id, warehouse_location, receiver_name, status, notes,
        idempotency_key, created_by
    ) VALUES (
        v_org, v_gr_number, v_po_id, v_vendor_id,
        COALESCE((p_payload->>'receipt_date')::DATE, CURRENT_DATE),
        v_wh_id, NULLIF(p_payload->>'warehouse_location', ''),
        NULLIF(p_payload->>'receiver_name', ''), 'confirmed',
        NULLIF(p_payload->>'notes', ''), v_idem_key, v_uid
    )
    RETURNING id INTO v_gr_id;

    -- ===== السطور =====
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_payload->'lines')
    LOOP
        v_line_no := v_line_no + 1;
        v_prod := (v_line->>'product_id')::UUID;
        v_recv := COALESCE((v_line->>'received_quantity')::NUMERIC, 0);
        v_cost := COALESCE((v_line->>'unit_cost')::NUMERIC, 0);
        v_quality := COALESCE(NULLIF(v_line->>'quality_status', ''), 'accepted');

        IF v_recv < 0 OR v_cost < 0 THEN
            RAISE EXCEPTION 'INVALID_LINE: كمية/تكلفة سالبة (السطر %)', v_line_no;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_prod AND org_id = v_org) THEN
            RAISE EXCEPTION 'ITEM_NOT_FOUND: المنتج غير موجود ضمن مؤسستك (السطر %)', v_line_no;
        END IF;

        -- سطر أمر الشراء (إن مُرِّر): ملكية + مطابقة منتج + منع تجاوز + تحديث ذرّي
        v_pol_id := NULLIF(v_line->>'purchase_order_line_id', '')::UUID;
        IF v_pol_id IS NOT NULL THEN
            SELECT purchase_order_id, product_id, quantity, COALESCE(received_quantity, 0) AS received
            INTO v_pol
            FROM purchase_order_lines WHERE id = v_pol_id AND org_id = v_org
            FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'INVALID_PO_LINE: سطر أمر الشراء غير موجود (السطر %)', v_line_no;
            END IF;
            IF v_po_id IS NOT NULL AND v_pol.purchase_order_id <> v_po_id THEN
                RAISE EXCEPTION 'INVALID_PO_LINE: السطر لا يتبع أمر الشراء المحدد (السطر %)', v_line_no;
            END IF;
            IF v_pol.product_id <> v_prod THEN
                RAISE EXCEPTION 'PRODUCT_MISMATCH: منتج السطر لا يطابق سطر أمر الشراء (السطر %)', v_line_no;
            END IF;
            IF (v_pol.received + v_recv) > v_pol.quantity THEN
                RAISE EXCEPTION 'OVER_RECEIPT: الكمية % تتجاوز المتبقّي % في السطر %',
                    v_recv, (v_pol.quantity - v_pol.received), v_line_no;
            END IF;

            -- تحديث الكمية المستلمة في سطر أمر الشراء — داخل المعاملة (ذرّي)
            UPDATE purchase_order_lines
            SET received_quantity = v_pol.received + v_recv
            WHERE id = v_pol_id;
        END IF;

        INSERT INTO goods_receipt_lines (
            org_id, goods_receipt_id, purchase_order_line_id, product_id,
            ordered_quantity, received_quantity, unit_cost, quality_status, notes
        ) VALUES (
            v_org, v_gr_id, v_pol_id, v_prod,
            COALESCE((v_line->>'ordered_quantity')::NUMERIC, v_recv),
            v_recv, v_cost, v_quality, NULLIF(v_line->>'notes', '')
        );

        IF v_quality = 'accepted' AND v_recv > 0 THEN
            v_total := v_total + (v_recv * v_cost);
        END IF;
    END LOOP;

    -- ===== تحديث حالة أمر الشراء (ذرّي) =====
    IF v_po_id IS NOT NULL THEN
        UPDATE purchase_orders po
        SET status = CASE
            WHEN NOT EXISTS (
                SELECT 1 FROM purchase_order_lines l
                WHERE l.purchase_order_id = po.id
                  AND COALESCE(l.received_quantity, 0) < l.quantity
            ) THEN 'fully_received'
            ELSE 'partially_received'
        END
        WHERE po.id = v_po_id;
    END IF;

    -- ===== قيد GRNI — Fail-closed =====
    IF v_total > 0 THEN
        PERFORM rpc_post_event_journal(
            'GR_RECEIPT', v_total, 'استلام بضاعة ' || v_gr_number,
            'GOODS_RECEIPT', v_gr_id, v_org,
            'GR_RECEIPT:' || v_gr_id::TEXT, NULL
        );
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE, 'goods_receipt_id', v_gr_id,
        'receipt_number', v_gr_number, 'total_value', ROUND(v_total, 6),
        'lines_processed', v_line_no
    );
END;
$$;

COMMENT ON FUNCTION public.rpc_post_goods_receipt(JSONB) IS
'استلام بضاعة ذرّي محصَّن (Migration 90): عضوية + عزل org + ملكية المخزن/PO/سطر PO/المنتج + مطابقة المورد + حالة PO قابلة للاستلام + منع تجاوز الكمية + منع السالب + تحديث سطور/حالة أمر الشراء داخل نفس المعاملة + قيد GRNI Fail-closed + idempotency بلا سباق (فحص بعد القفل). دفتر المخزون/التقييم يبقى في الواجهة (محرّك حقيقي بعد إصلاح P0).';

GRANT EXECUTE ON FUNCTION public.rpc_post_goods_receipt(JSONB) TO authenticated;

-- ===================================================================
-- التحقق: اختبارات rollback حيّة لكل قيد (مورد/سطر PO/تجاوز/سالب/مخزن/حالة).
-- ===================================================================
