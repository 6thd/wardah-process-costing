-- ===================================================================
-- Migration 94: إغلاق ذرّية المخزون — دفتر المخزون (SLE + bins) داخل الاستلام
-- ===================================================================
-- الفجوة (كانت موثَّقة عمداً في 89/90): بعد نجاح rpc_post_goods_receipt الذرّي
-- (مستند + سطور + تحديث PO + قيد GRNI في معاملة واحدة)، كانت الواجهة تُحدِّث
-- دفتر المخزون (Stock Ledger Entry + bins + طابور FIFO/LIFO) في **خطوات عميل
-- منفصلة**: تقرأ الـ bin ⇒ تحسب التقييم في JS ⇒ تكتب الـ bin. هذا:
--   1) غير ذرّي مع المستند/القيد (استلام+GRNI بلا حركة مخزون إن انقطع العميل)،
--   2) عرضة لسباق القراءة/الكتابة على الـ bin (لا قفل صف بين القراءة والكتابة).
--
-- الحل: نقل حساب التقييم + إدراج SLE + تحديث الـ bin **داخل** rpc_post_goods_receipt
-- ضمن نفس المعاملة والقفل الاستشاري لكل مؤسسة، عبر دالة مساعدة قابلة لإعادة
-- الاستخدام wardah_apply_stock_incoming (قفل صف الـ bin FOR UPDATE ⇒ لا سباق).
-- فيصبح: مستند + سطور + PO + GRNI + SLE + bin **كلها ذرّية واحدة Fail-closed**.
--
-- المبدأ: إضافي 100% (CREATE OR REPLACE، لا حذف/تعديل بيانات). خوارزميات التقييم
-- مطابِقة لمحرّك الواجهة (services/valuation): FIFO/LIFO يحفظان الطابور، والمتوسط
-- المرجّح/المتحرّك ينهار لباتش واحد. رياضيات FIFO/LIFO مضمَّنة (وصول jsonb) فلا
-- اعتماد على دوال خارجية. الطريقة تُقرأ من products.valuation_method (افتراضي متوسط).
-- ===================================================================

-- 1) دالة مساعدة: تطبيق حركة مخزون واردة (SLE + bin) بتقييم مقفول ذرّياً
CREATE OR REPLACE FUNCTION public.wardah_apply_stock_incoming(
    p_org            UUID,
    p_product        UUID,
    p_warehouse      UUID,
    p_qty            NUMERIC,
    p_rate           NUMERIC,
    p_voucher_type   TEXT,
    p_voucher_id     UUID,
    p_voucher_number TEXT,
    p_posting_date   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_method     TEXT;
    v_prev_qty   NUMERIC := 0;
    v_prev_value NUMERIC := 0;
    v_prev_queue JSONB   := '[]'::JSONB;
    v_new_qty    NUMERIC;
    v_new_value  NUMERIC;
    v_new_rate   NUMERIC;
    v_new_queue  JSONB;
    v_len        INTEGER;
BEGIN
    -- لا مخزن ⇒ لا دفتر مخزون (المخزن اختياري في سند الاستلام)
    IF p_warehouse IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
        RETURN jsonb_build_object('applied', FALSE, 'reason', 'NO_WAREHOUSE_OR_QTY');
    END IF;

    -- طريقة التقييم (افتراضي: متوسط مرجّح)
    SELECT COALESCE(valuation_method, 'Weighted Average')
    INTO v_method
    FROM products WHERE id = p_product AND org_id = p_org;
    v_method := COALESCE(v_method, 'Weighted Average');

    -- قفل صف الـ bin (أو غيابه) — يمنع سباق القراءة/الكتابة.
    -- ⚠️ عند غياب الصف يضبط SELECT INTO كل المتغيّرات NULL (لا تنطبق COALESCE
    --    على الأعمدة لأنه لا صف)، لذا نُطبّق COALESCE على المتغيّرات **بعد** الجلب.
    SELECT actual_qty, stock_value, stock_queue
    INTO v_prev_qty, v_prev_value, v_prev_queue
    FROM bins
    WHERE product_id = p_product AND warehouse_id = p_warehouse
    FOR UPDATE;

    v_prev_qty   := COALESCE(v_prev_qty, 0);
    v_prev_value := COALESCE(v_prev_value, 0);
    v_prev_queue := COALESCE(v_prev_queue, '[]'::JSONB);

    v_new_qty   := v_prev_qty + p_qty;
    v_new_value := v_prev_value + (p_qty * p_rate);
    v_new_queue := v_prev_queue
                   || jsonb_build_array(jsonb_build_object('qty', p_qty, 'rate', p_rate));

    IF v_method = 'FIFO' THEN
        -- سعر أقدم باتش (أول عنصر في الطابور)
        v_new_rate := COALESCE((v_new_queue->0->>'rate')::NUMERIC, p_rate);
    ELSIF v_method = 'LIFO' THEN
        -- سعر أحدث باتش (آخر عنصر في الطابور)
        v_len := jsonb_array_length(v_new_queue);
        v_new_rate := COALESCE((v_new_queue->(v_len - 1)->>'rate')::NUMERIC, p_rate);
    ELSE
        -- متوسط مرجّح/متحرّك: ينهار الطابور لباتش واحد بالمتوسط
        v_new_rate  := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE 0 END;
        v_new_queue := jsonb_build_array(jsonb_build_object('qty', v_new_qty, 'rate', v_new_rate));
    END IF;

    -- SLE دفتر إلحاقي: كل حركة (كل سطر) تُنشئ صفاً مستقلاً. لا نُزيل التكرار هنا —
    -- إعادة تطبيق سند كامل يمنعها idempotency_key على مستوى rpc_post_goods_receipt
    -- (يعود مبكراً قبل حلقة السطور)، وسطران متمايزان بنفس المنتج/المخزن/الكمية
    -- يجب أن يحصل كلٌّ منهما على SLE خاصّ (وإلا تخلّف رصيد الدفتر عن الـ bin).
    INSERT INTO stock_ledger_entries (
        voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
        posting_date, actual_qty, qty_after_transaction, incoming_rate,
        valuation_rate, stock_value, stock_value_difference, stock_queue,
        docstatus, org_id, created_by
    ) VALUES (
        p_voucher_type, p_voucher_id, p_voucher_number, p_product, p_warehouse,
        COALESCE(p_posting_date, CURRENT_DATE), p_qty, v_new_qty, p_rate,
        v_new_rate, v_new_value, (p_qty * p_rate), v_new_queue,
        1, p_org, auth.uid()
    );

    -- Bin: upsert (فهرس فريد على product_id, warehouse_id)
    INSERT INTO bins (
        org_id, product_id, warehouse_id, actual_qty,
        valuation_rate, stock_value, stock_queue, updated_at
    ) VALUES (
        p_org, p_product, p_warehouse, v_new_qty,
        v_new_rate, v_new_value, v_new_queue, NOW()
    )
    ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
        actual_qty     = EXCLUDED.actual_qty,
        valuation_rate = EXCLUDED.valuation_rate,
        stock_value    = EXCLUDED.stock_value,
        stock_queue    = EXCLUDED.stock_queue,
        updated_at     = NOW();

    RETURN jsonb_build_object(
        'applied', TRUE, 'new_qty', v_new_qty,
        'new_rate', ROUND(v_new_rate, 6), 'new_value', ROUND(v_new_value, 6),
        'method', v_method
    );
END;
$$;

COMMENT ON FUNCTION public.wardah_apply_stock_incoming(UUID,UUID,UUID,NUMERIC,NUMERIC,TEXT,UUID,TEXT,DATE) IS
'تطبيق حركة مخزون واردة ذرّياً (Migration 94): قفل صف bin FOR UPDATE ⇒ حساب التقييم (FIFO/LIFO/متوسط مرجّح مطابِق لمحرّك الواجهة) ⇒ إدراج SLE (غير مكرَّر) + upsert bin. تُستدعى داخل rpc_post_goods_receipt فتصبح حركة المخزون جزءاً من ذرّية المستند/القيد.';

GRANT EXECUTE ON FUNCTION public.wardah_apply_stock_incoming(UUID,UUID,UUID,NUMERIC,NUMERIC,TEXT,UUID,TEXT,DATE) TO authenticated;

-- ===================================================================
-- 2) rpc_post_goods_receipt — نسخة Migration 90 حرفياً + استدعاء الدالة المساعدة
--    داخل كتلة السطر المقبول (فيصبح دفتر المخزون جزءاً من نفس المعاملة الذرّية).
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

            -- ===== ذرّية المخزون (Migration 94): SLE + bin داخل نفس المعاملة =====
            -- يطبَّق فقط عند وجود مخزن (المخزن اختياري)؛ Fail-closed: أي فشل هنا
            -- يُجهض الاستلام والقيد كله (لا مستند/GRNI بلا حركة مخزون).
            IF v_wh_id IS NOT NULL THEN
                PERFORM wardah_apply_stock_incoming(
                    v_org, v_prod, v_wh_id, v_recv, v_cost,
                    'Goods Receipt', v_gr_id, v_gr_number, v_recv_date
                );
            END IF;
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
'استلام بضاعة ذرّي محصَّن (Migration 90) + دفتر مخزون ذرّي (Migration 94): مستند + سطور + تحديث سطور/حالة أمر الشراء + قيد GRNI + Stock Ledger Entry + bins بتقييم مقفول (FIFO/LIFO/متوسط) — كلها في معاملة واحدة Fail-closed تحت قفل استشاري لكل مؤسسة. عضوية + عزل org + ملكية + منع تجاوز/سالب + idempotency بلا سباق.';

GRANT EXECUTE ON FUNCTION public.rpc_post_goods_receipt(JSONB) TO authenticated;

-- ===================================================================
-- التحقق (اختبار حيّ rollback — يُشغَّل عند توفّر وصول DB):
--   DO $$ DECLARE r JSONB; BEGIN
--     PERFORM set_config('request.jwt.claims', '{"sub":"<member-uid>"}', true);
--     r := rpc_post_goods_receipt('{...tenant_id,vendor_id,warehouse_id,lines...}'::jsonb);
--     RAISE EXCEPTION 'RESULT=%', r::text;  -- يُجهض المعاملة (لا كتابة) ويكشف النتيجة
--   END $$;
-- المتوقَّع: bins.actual_qty/valuation_rate/stock_queue محدَّثة، صف SLE واحد لكل
-- سطر مقبول، قيد GRNI مُرحَّل، والكل يصفو إن فشل أيّ جزء (Fail-closed).
-- ===================================================================
