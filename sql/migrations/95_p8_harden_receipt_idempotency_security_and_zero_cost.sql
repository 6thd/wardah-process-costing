-- ===================================================================
-- Migration 95: إغلاق ملاحظات مراجعة Codex على دفعة P6/P7 (92–94)
-- ===================================================================
-- إضافي 100% (CREATE OR REPLACE + REVOKE)، بلا تغيير معماري:
--
-- P0-1 (تكرار مخزون على replay): مسار idempotent replay في rpc_post_goods_receipt
--   كان يعود بلا inventory_atomic ⇒ الواجهة تظنّ أن الدفتر لم يُطبَّق فتُكرّر
--   SLE/bin. الآن يعود بـ inventory_atomic=TRUE (والواجهة تعامل replay كمُعالَج).
--
-- P0-2 (أمني): wardah_apply_stock_incoming كانت SECURITY DEFINER + GRANT
--   authenticated بلا تحقق عضوية وتستقبل p_org من المستدعي ⇒ يمكن لأي مستخدم
--   موثَّق تعديل bins/SLE لأي مؤسسة إن عرف المعرفات. الحل: سحب صلاحية التنفيذ
--   من PUBLIC/authenticated فتبقى داخلية (يستدعيها فقط rpc_post_goods_receipt
--   وهي SECURITY DEFINER تفحص العضوية). النداء الداخلي يعمل بصلاحية المالك.
--
-- P1 (تشديد الاستلام المباشر): تحقق وجود المورد وملكيته للمؤسسة + إلزام المخزن
--   للسطر المقبول بكمية موجبة + منع purchase_order_line_id بلا purchase_order_id.
--
-- P2 (إتمام تصنيع بتكلفة صفرية): كان يُتمّ بتحذير فقط (يلوّث متوسط تكلفة المنتج).
--   الآن Fail-closed افتراضياً ما لم يُمرَّر allow_zero_cost=true صراحةً.
-- ===================================================================

-- ===================================================================
-- 1) P0-2 أمني: جعل الدالة المساعدة داخلية فقط
-- ===================================================================
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, UUID, TEXT, DATE
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wardah_apply_stock_incoming(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, UUID, TEXT, DATE
) FROM authenticated;

-- ===================================================================
-- 2) rpc_post_goods_receipt: replay يعيد inventory_atomic + تشديدات P1
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
    v_recv_date  DATE;
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
    -- P1: المورد موجود ويخص المؤسسة
    IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = v_vendor_id AND org_id = v_org) THEN
        RAISE EXCEPTION 'VENDOR_NOT_FOUND: المورد ليس ضمن مؤسستك';
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

    v_recv_date := COALESCE((p_payload->>'receipt_date')::DATE, CURRENT_DATE);

    -- ===== فحص الفترة (إن وُجد) =====
    BEGIN
        PERFORM assert_period_open(v_org, v_recv_date);
    EXCEPTION WHEN undefined_function THEN NULL;
    END;

    -- ===== قفل استشاري (تسلسل لكل مؤسسة) ثم فحص idempotency = لا سباق =====
    PERFORM pg_advisory_xact_lock(hashtext('goods_receipts:' || v_org::TEXT));

    v_idem_key := NULLIF(p_payload->>'idempotency_key', '');
    IF v_idem_key IS NOT NULL THEN
        SELECT id, receipt_number INTO v_existing_id, v_existing_no
        FROM goods_receipts WHERE org_id = v_org AND idempotency_key = v_idem_key;
        IF v_existing_id IS NOT NULL THEN
            -- P0-1: أعِد inventory_atomic ليمنع تكرار SLE/bin في الواجهة على الـ replay
            RETURN jsonb_build_object(
                'success', TRUE, 'goods_receipt_id', v_existing_id,
                'receipt_number', v_existing_no, 'idempotent_replay', TRUE,
                'inventory_atomic', TRUE
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
        v_org, v_gr_number, v_po_id, v_vendor_id, v_recv_date,
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

        -- P1: سطر مقبول بكمية موجبة يتطلب مخزناً (وإلا استلام بلا حركة مخزون)
        IF v_quality = 'accepted' AND v_recv > 0 AND v_wh_id IS NULL THEN
            RAISE EXCEPTION 'WAREHOUSE_REQUIRED: السطر % مقبول بكمية موجبة ويتطلب warehouse_id لتسجيل حركة المخزون', v_line_no;
        END IF;

        -- سطر أمر الشراء (إن مُرِّر): ملكية + مطابقة منتج + منع تجاوز + تحديث ذرّي
        v_pol_id := NULLIF(v_line->>'purchase_order_line_id', '')::UUID;
        IF v_pol_id IS NOT NULL THEN
            -- P1: سطر أمر شراء يستلزم أمر شراء مرتبطاً بالسند (وإلا سطر PO يُحدَّث بلا ربط)
            IF v_po_id IS NULL THEN
                RAISE EXCEPTION 'PO_REQUIRED: السطر % يحمل purchase_order_line_id بلا purchase_order_id للسند', v_line_no;
            END IF;
            SELECT purchase_order_id, product_id, quantity, COALESCE(received_quantity, 0) AS received
            INTO v_pol
            FROM purchase_order_lines WHERE id = v_pol_id AND org_id = v_org
            FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'INVALID_PO_LINE: سطر أمر الشراء غير موجود (السطر %)', v_line_no;
            END IF;
            IF v_pol.purchase_order_id <> v_po_id THEN
                RAISE EXCEPTION 'INVALID_PO_LINE: السطر لا يتبع أمر الشراء المحدد (السطر %)', v_line_no;
            END IF;
            IF v_pol.product_id <> v_prod THEN
                RAISE EXCEPTION 'PRODUCT_MISMATCH: منتج السطر لا يطابق سطر أمر الشراء (السطر %)', v_line_no;
            END IF;
            IF (v_pol.received + v_recv) > v_pol.quantity THEN
                RAISE EXCEPTION 'OVER_RECEIPT: الكمية % تتجاوز المتبقّي % في السطر %',
                    v_recv, (v_pol.quantity - v_pol.received), v_line_no;
            END IF;

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
            -- ذرّية المخزون (Migration 94): SLE + bin داخل نفس المعاملة (المخزن مضمون أعلاه)
            PERFORM wardah_apply_stock_incoming(
                v_org, v_prod, v_wh_id, v_recv, v_cost,
                'Goods Receipt', v_gr_id, v_gr_number, v_recv_date
            );
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
        'lines_processed', v_line_no,
        'inventory_atomic', TRUE
    );
END;
$$;

COMMENT ON FUNCTION public.rpc_post_goods_receipt(JSONB) IS
'استلام بضاعة ذرّي محصَّن (90) + دفتر مخزون ذرّي (94) + تشديدات مراجعة (95): مستند + سطور + PO + GRNI + SLE + bins بتقييم مقفول — معاملة واحدة Fail-closed تحت قفل استشاري لكل مؤسسة. عضوية + عزل org + وجود المورد + إلزام المخزن للسطر المقبول + PO للسطر المرتبط + منع تجاوز/سالب + idempotency (replay يعيد inventory_atomic).';

GRANT EXECUTE ON FUNCTION public.rpc_post_goods_receipt(JSONB) TO authenticated;

-- ===================================================================
-- 3) rpc_complete_manufacturing_order: تكلفة صفرية Fail-closed (P2)
-- ===================================================================
CREATE OR REPLACE FUNCTION public.rpc_complete_manufacturing_order(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org        UUID;
    v_uid        UUID;
    v_mo_id      UUID;
    v_mo         RECORD;
    v_prod       RECORD;
    v_done_qty   NUMERIC;
    v_wip_cost   NUMERIC;
    v_unit_cost  NUMERIC;
    v_new_qty    NUMERIC;
    v_new_rate   NUMERIC;
    v_allow_zero BOOLEAN;
    v_warnings   JSONB := '[]'::JSONB;
BEGIN
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

    v_mo_id := (p_payload->>'mo_id')::UUID;
    IF v_mo_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_PAYLOAD: mo_id مطلوب';
    END IF;

    SELECT id, status, quantity, completed_quantity, product_id, total_cost
    INTO v_mo
    FROM manufacturing_orders
    WHERE id = v_mo_id AND org_id = v_org
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MO_NOT_FOUND: أمر التصنيع غير موجود ضمن مؤسستك';
    END IF;

    IF normalize_mo_status(v_mo.status) = 'done' THEN
        RETURN jsonb_build_object(
            'success', TRUE, 'mo_id', v_mo_id, 'already_done', TRUE,
            'completed_quantity', v_mo.completed_quantity,
            'total_cost', ROUND(COALESCE(v_mo.total_cost, 0), 6)
        );
    END IF;

    IF v_mo.product_id IS NULL THEN
        RAISE EXCEPTION 'MO_NO_PRODUCT: أمر التصنيع بلا منتج تام محدَّد';
    END IF;

    v_done_qty := COALESCE((p_payload->>'completed_quantity')::NUMERIC, v_mo.quantity);
    IF v_done_qty IS NULL OR v_done_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QUANTITY: الكمية المنجزة يجب أن تكون موجبة';
    END IF;

    -- تكلفة WIP الفعلية المتراكمة من استهلاك المواد
    SELECT COALESCE(SUM(COALESCE(total_cost, consumed_quantity * COALESCE(unit_cost, 0))), 0)
    INTO v_wip_cost
    FROM material_consumption
    WHERE mo_id = v_mo_id AND org_id = v_org;

    -- ===== P2: تكلفة صفرية = Fail-closed افتراضياً (تلوّث متوسط التكلفة) =====
    v_allow_zero := COALESCE(p_payload->>'allow_zero_cost', 'false') = 'true';
    IF v_wip_cost <= 0 AND NOT v_allow_zero THEN
        RAISE EXCEPTION 'ZERO_COST_COMPLETION: لا تكلفة مواد مسجَّلة لأمر التصنيع — '
          'الإتمام بتكلفة صفرية مرفوض (يلوّث متوسط تكلفة المنتج). سجّل استهلاك المواد '
          'أولاً، أو مرّر allow_zero_cost=true للإتمام المصرَّح بتكلفة صفرية.';
    END IF;

    v_unit_cost := CASE WHEN v_done_qty > 0 THEN v_wip_cost / v_done_qty ELSE 0 END;

    -- ===== زيادة مخزون المنتج التام (متوسط مرجّح للتكلفة) =====
    SELECT id, COALESCE(stock_quantity, 0) AS qty, COALESCE(cost_price, 0) AS cost
    INTO v_prod
    FROM products WHERE id = v_mo.product_id AND org_id = v_org
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ITEM_NOT_FOUND: منتج أمر التصنيع غير موجود ضمن مؤسستك';
    END IF;

    v_new_qty := v_prod.qty + v_done_qty;
    v_new_rate := CASE WHEN v_new_qty > 0
        THEN (v_prod.qty * v_prod.cost + v_wip_cost) / v_new_qty
        ELSE v_unit_cost END;

    UPDATE products
    SET stock_quantity = v_new_qty, cost_price = v_new_rate, updated_at = NOW()
    WHERE id = v_mo.product_id;

    IF to_regclass('public.stock_moves') IS NOT NULL THEN
        INSERT INTO stock_moves (
            org_id, product_id, quantity, move_type, unit_cost_in,
            reference_type, reference_id, reference_number, status, date_done
        ) VALUES (
            v_org, v_mo.product_id, v_done_qty, 'production_receipt', v_unit_cost,
            'MANUFACTURING_ORDER', v_mo_id, NULL, 'done', NOW()
        );
    END IF;

    UPDATE manufacturing_orders
    SET status = 'done', completed_quantity = v_done_qty,
        total_cost = v_wip_cost, unit_cost = v_unit_cost
    WHERE id = v_mo_id;

    IF v_wip_cost > 0 THEN
        PERFORM rpc_post_event_journal(
            'MATERIAL_ISSUE', v_wip_cost, 'صرف مواد لأمر تصنيع - ' || v_mo_id::TEXT,
            'MANUFACTURING_ORDER', v_mo_id, v_org, 'MATERIAL_ISSUE:' || v_mo_id::TEXT, NULL
        );
        PERFORM rpc_post_event_journal(
            'FG_RECEIPT', v_wip_cost, 'إنتاج تام لأمر تصنيع - ' || v_mo_id::TEXT,
            'MANUFACTURING_ORDER', v_mo_id, v_org, 'FG_RECEIPT:' || v_mo_id::TEXT, NULL
        );
    ELSE
        -- لا يُبلَغ هنا إلا عند allow_zero_cost=true (وإلا رُفض أعلاه)
        v_warnings := v_warnings || to_jsonb(
            'إتمام بتكلفة صفرية (مصرَّح allow_zero_cost): لا استهلاك مواد مسجَّل، لا قيد مُرحَّل.'::TEXT
        );
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE, 'mo_id', v_mo_id,
        'completed_quantity', v_done_qty,
        'total_cost', ROUND(v_wip_cost, 6),
        'unit_cost', ROUND(v_unit_cost, 6),
        'fg_new_stock', v_new_qty,
        'warnings', v_warnings
    );
END;
$$;

COMMENT ON FUNCTION public.rpc_complete_manufacturing_order(JSONB) IS
'إتمام أمر تصنيع ذرّي (93) + سياسة تكلفة صفرية (95): تكلفة فعلية متراكمة ⇒ مخزون تام (متوسط مرجّح) + قيود Raw→WIP→FG Fail-closed + done + idempotent. تكلفة صفرية مرفوضة افتراضياً (Fail-closed) ما لم يُمرَّر allow_zero_cost=true. عضوية + عزل org.';

GRANT EXECUTE ON FUNCTION public.rpc_complete_manufacturing_order(JSONB) TO authenticated;

-- ===================================================================
-- التحقق الحيّ (rollback): (1) نفس idempotency_key مرتين ⇒ replay يعيد
-- inventory_atomic=true وSLE واحد وbin يزيد مرة؛ (2) استدعاء الدالة المساعدة
-- مباشرة كـ authenticated ⇒ رفض صلاحية؛ (3) مورد أجنبي/سطر PO بلا PO/مخزن غائب
-- ⇒ رفض؛ (4) إتمام MO بلا تكلفة ⇒ ZERO_COST_COMPLETION ما لم allow_zero_cost.
-- ===================================================================
