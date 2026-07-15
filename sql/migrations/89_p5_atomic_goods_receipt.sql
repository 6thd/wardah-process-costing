-- ===================================================================
-- Migration 89: استلام بضاعة ذرّي (المستند + القيد) — Fail-closed
-- ===================================================================
-- المشكلة (ملاحظة المراجع): receiveGoods يُنشئ سند الاستلام وسطوره ويحدّث
-- المخزون ثم يرحّل قيد GRNI **منفصلاً ومتسامحاً** (glWarning). فقد ينتهي
-- الأمر بمستند استلام بلا قيد محاسبي مقابل.
--
-- الحل (بلا مساس بمحرّك التقييم الغنيّ bins/FIFO/LIFO في TypeScript):
-- دالة تُنشئ **الرأس + السطور + قيد GRNI في معاملة واحدة، Fail-closed**.
-- الواجهة تستدعيها أولاً، ثم تُكمل تحديث دفتر المخزون/الـ bins بالمعرّف
-- المُعاد. النتيجة: لا مستند استلام مسجَّل بلا قيد GRNI. عزل org + تحقق
-- عضوية + idempotency. أي فشل في القيد يُجهض المستند كله.
--
-- المبدأ: إضافي — دالة جديدة فقط + عمود idempotency. لا يمس بيانات.
-- ===================================================================

ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_goods_receipts_idempotency
    ON goods_receipts (org_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

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
    v_vendor_id  UUID;
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
BEGIN
    -- ===== المؤسسة + تحقق العضوية =====
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

    -- ===== Idempotency =====
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

    -- ===== أمر الشراء (إن مُرِّر) يجب أن يخص المؤسسة =====
    v_po_id := NULLIF(p_payload->>'purchase_order_id', '')::UUID;
    IF v_po_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM purchase_orders WHERE id = v_po_id AND org_id = v_org
    ) THEN
        RAISE EXCEPTION 'PO_NOT_FOUND: أمر الشراء ليس ضمن مؤسستك';
    END IF;

    -- ===== فحص الفترة (إن وُجد) =====
    BEGIN
        PERFORM assert_period_open(
            v_org, COALESCE((p_payload->>'receipt_date')::DATE, CURRENT_DATE)
        );
    EXCEPTION WHEN undefined_function THEN NULL;
    END;

    -- ===== رقم السند داخل المعاملة (قفل استشاري) =====
    PERFORM pg_advisory_xact_lock(hashtext('goods_receipts:' || v_org::TEXT));
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
        NULLIF(p_payload->>'warehouse_id', '')::UUID,
        NULLIF(p_payload->>'warehouse_location', ''),
        NULLIF(p_payload->>'receiver_name', ''),
        'confirmed',
        NULLIF(p_payload->>'notes', ''),
        v_idem_key, v_uid
    )
    RETURNING id INTO v_gr_id;

    -- ===== السطور (تحقق ملكية المنتج للمؤسسة) =====
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_payload->'lines')
    LOOP
        v_line_no := v_line_no + 1;
        v_prod := (v_line->>'product_id')::UUID;
        v_recv := COALESCE((v_line->>'received_quantity')::NUMERIC, 0);
        v_cost := COALESCE((v_line->>'unit_cost')::NUMERIC, 0);
        v_quality := COALESCE(NULLIF(v_line->>'quality_status', ''), 'accepted');

        IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_prod AND org_id = v_org) THEN
            RAISE EXCEPTION 'ITEM_NOT_FOUND: المنتج غير موجود ضمن مؤسستك (السطر %)', v_line_no;
        END IF;

        INSERT INTO goods_receipt_lines (
            org_id, goods_receipt_id, purchase_order_line_id, product_id,
            ordered_quantity, received_quantity, unit_cost, quality_status, notes
        ) VALUES (
            v_org, v_gr_id,
            NULLIF(v_line->>'purchase_order_line_id', '')::UUID, v_prod,
            COALESCE((v_line->>'ordered_quantity')::NUMERIC, v_recv),
            v_recv, v_cost, v_quality,
            NULLIF(v_line->>'notes', '')
        );

        -- قيمة GRNI تُحتسب على الكميات المقبولة فقط (مطابقة منطق الواجهة)
        IF v_quality = 'accepted' AND v_recv > 0 THEN
            v_total := v_total + (v_recv * v_cost);
        END IF;
    END LOOP;

    -- ===== قيد GRNI (مدين مخزون / دائن GRNI) — Fail-closed =====
    IF v_total > 0 THEN
        PERFORM rpc_post_event_journal(
            'GR_RECEIPT', v_total,
            'استلام بضاعة ' || v_gr_number,
            'GOODS_RECEIPT', v_gr_id, v_org,
            'GR_RECEIPT:' || v_gr_id::TEXT, NULL
        );
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'goods_receipt_id', v_gr_id,
        'receipt_number', v_gr_number,
        'total_value', ROUND(v_total, 6),
        'lines_processed', v_line_no
    );
END;
$$;

COMMENT ON FUNCTION public.rpc_post_goods_receipt(JSONB) IS
'استلام بضاعة ذرّي (Migration 89): رأس + سطور + قيد GRNI في معاملة واحدة Fail-closed — لا مستند استلام بلا قيد مقابل. تحقق عضوية + عزل org + ملكية PO/المنتج + idempotency. دفتر المخزون/التقييم (bins/FIFO/LIFO) يبقى في الواجهة ويُنفَّذ بعد نجاح هذه الدالة.';

GRANT EXECUTE ON FUNCTION public.rpc_post_goods_receipt(JSONB) TO authenticated;

-- ===================================================================
-- التحقق: SELECT proname FROM pg_proc WHERE proname='rpc_post_goods_receipt';
-- ===================================================================
