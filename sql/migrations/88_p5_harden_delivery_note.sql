-- ===================================================================
-- Migration 88: تحصين إذن التسليم الذرّي — سلامة أعمال + أمان + Fail-closed
-- ===================================================================
-- Migration 87 جعل الدالة تعمل على المخطط الحيّ (products/org_id)، لكنها
-- بقيت تثق بالمدخلات: تجلب المنتج/الفاتورة/السطر بالـ id دون شرط org_id،
-- ولا تتحقق من عضوية المستخدم، ولا تمنع التسليم الزائد أو التكرار، وتبتلع
-- فشل قيد COGS. هذا الملف يعيد تعريف الدالة (CREATE OR REPLACE — إضافي)
-- بقيود صارمة، ويضيف idempotency، ويجعل فشل القيد المحاسبي يُجهض العملية.
--
-- المبدأ: لا مخزون مخصوم بلا قيد مقابل (Fail-closed)، ولا عبور مؤسسات،
-- ولا تسليم فوق كمية الفاتورة، ولا تكرار عند إعادة الإرسال.
-- ===================================================================

-- 1) عمود idempotency + فهرس فريد جزئي لكل مؤسسة (إضافي، آمن على البيانات)
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_delivery_notes_idempotency
    ON delivery_notes (org_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- 2) الدالة المحصَّنة
CREATE OR REPLACE FUNCTION public.rpc_post_delivery_note(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org         UUID;
    v_uid         UUID;
    v_dn_id       UUID;
    v_dn_number   TEXT;
    v_invoice_id  UUID;
    v_inv_customer UUID;
    v_payload_customer UUID;
    v_idem_key    TEXT;
    v_existing_id UUID;
    v_existing_no TEXT;
    v_allow_over  BOOLEAN;
    v_line        JSONB;
    v_item        RECORD;
    v_inv_line    RECORD;
    v_qty         NUMERIC;
    v_unit_cost   NUMERIC;
    v_total_cogs  NUMERIC := 0;
    v_line_no     INTEGER := 0;
    v_warnings    JSONB := '[]'::JSONB;
BEGIN
    -- ===== هوية المؤسسة + تحقق العضوية (يغلق ثقة القيمة الصريحة من العميل) =====
    v_org := wardah_org_id(NULLIF(p_payload->>'tenant_id', '')::UUID);
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'ORG_NOT_RESOLVED: تعذر تحديد هوية المؤسسة';
    END IF;

    v_uid := auth.uid();
    IF v_uid IS NULL OR NOT EXISTS (
        SELECT 1 FROM user_organizations
        WHERE user_id = v_uid AND org_id = v_org
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN_ORG: المستخدم ليس عضواً في المؤسسة المطلوبة';
    END IF;

    -- ===== تحقق أساسي من الحمولة =====
    v_invoice_id := (p_payload->>'sales_invoice_id')::UUID;
    IF v_invoice_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_PAYLOAD: sales_invoice_id مطلوب';
    END IF;
    IF jsonb_array_length(COALESCE(p_payload->'lines', '[]'::JSONB)) = 0 THEN
        RAISE EXCEPTION 'INVALID_PAYLOAD: لا سطور في إذن التسليم';
    END IF;
    v_allow_over := COALESCE((p_payload->>'allow_over_delivery')::BOOLEAN, FALSE);

    -- ===== Idempotency: إعادة الإرسال بنفس المفتاح تُعيد النتيجة بلا خصم مكرر =====
    v_idem_key := NULLIF(p_payload->>'idempotency_key', '');
    IF v_idem_key IS NOT NULL THEN
        SELECT id, delivery_number INTO v_existing_id, v_existing_no
        FROM delivery_notes
        WHERE org_id = v_org AND idempotency_key = v_idem_key;
        IF v_existing_id IS NOT NULL THEN
            SELECT COALESCE(SUM(quantity_delivered * unit_cost_at_delivery), 0)
            INTO v_total_cogs
            FROM delivery_note_lines WHERE delivery_note_id = v_existing_id;
            RETURN jsonb_build_object(
                'success', TRUE, 'delivery_id', v_existing_id,
                'delivery_number', v_existing_no,
                'total_cogs', ROUND(v_total_cogs, 6),
                'idempotent_replay', TRUE, 'warnings', '[]'::JSONB
            );
        END IF;
    END IF;

    -- ===== الفاتورة: يجب أن تخص نفس المؤسسة =====
    SELECT customer_id INTO v_inv_customer
    FROM sales_invoices
    WHERE id = v_invoice_id AND org_id = v_org;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVOICE_NOT_FOUND: الفاتورة % ليست ضمن مؤسستك', v_invoice_id;
    END IF;

    -- تطابق العميل (إن مُرِّر) — الفاتورة هي المرجع
    v_payload_customer := NULLIF(p_payload->>'customer_id', '')::UUID;
    IF v_payload_customer IS NOT NULL AND v_payload_customer <> v_inv_customer THEN
        RAISE EXCEPTION 'CUSTOMER_MISMATCH: العميل لا يطابق عميل الفاتورة';
    END IF;

    -- ===== فحص الفترة المحاسبية (Migration 79 — إن وُجدت) =====
    BEGIN
        PERFORM assert_period_open(
            v_org, COALESCE((p_payload->>'delivery_date')::DATE, CURRENT_DATE)
        );
    EXCEPTION WHEN undefined_function THEN NULL;
    END;

    -- ===== توليد رقم التسليم داخل المعاملة (قفل استشاري يمنع التصادم) =====
    PERFORM pg_advisory_xact_lock(hashtext('delivery_notes:' || v_org::TEXT));
    SELECT 'DN-' || LPAD((
        COALESCE(MAX(NULLIF(regexp_replace(delivery_number, '\D', '', 'g'), ''))::BIGINT, 0) + 1
    )::TEXT, 6, '0')
    INTO v_dn_number
    FROM delivery_notes
    WHERE org_id = v_org AND delivery_number ~ '^DN-\d+$';
    v_dn_number := COALESCE(v_dn_number, 'DN-000001');

    -- ===== رأس إذن التسليم (العميل من الفاتورة، لا من العميل الموثوق) =====
    INSERT INTO delivery_notes (
        org_id, delivery_number, sales_invoice_id, customer_id,
        delivery_date, vehicle_number, driver_name, status, notes, idempotency_key
    ) VALUES (
        v_org, v_dn_number, v_invoice_id, v_inv_customer,
        COALESCE((p_payload->>'delivery_date')::DATE, CURRENT_DATE),
        NULLIF(p_payload->>'vehicle_number', ''),
        NULLIF(p_payload->>'driver_name', ''),
        'delivered',
        NULLIF(p_payload->>'notes', ''),
        v_idem_key
    )
    RETURNING id INTO v_dn_id;

    -- ===== السطور: تحقق ملكية ← قفل ← منع تسليم زائد ← خصم ← حركة =====
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_payload->'lines')
    LOOP
        v_line_no := v_line_no + 1;
        v_qty := (v_line->>'delivered_quantity')::NUMERIC;
        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION 'INVALID_LINE: كمية غير صالحة في السطر %', v_line_no;
        END IF;

        -- سطر الفاتورة إلزامي، ويجب أن يخص هذه الفاتورة (تُحسم المؤسسة والمنتج تالياً)
        IF NULLIF(v_line->>'sales_invoice_line_id', '') IS NULL THEN
            RAISE EXCEPTION 'LINE_REQUIRED: sales_invoice_line_id مطلوب لكل سطر (السطر %)', v_line_no;
        END IF;

        SELECT id, product_id, quantity, unit_price, COALESCE(delivered_quantity, 0) AS delivered
        INTO v_inv_line
        FROM sales_invoice_lines
        WHERE id = (v_line->>'sales_invoice_line_id')::UUID
          AND invoice_id = v_invoice_id
          AND org_id = v_org
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'INVALID_LINE: سطر الفاتورة غير موجود ضمن هذه الفاتورة (السطر %)', v_line_no;
        END IF;

        -- المنتج المُرسل يجب أن يطابق منتج سطر الفاتورة
        IF (v_line->>'item_id')::UUID <> v_inv_line.product_id THEN
            RAISE EXCEPTION 'PRODUCT_MISMATCH: المنتج لا يطابق منتج سطر الفاتورة (السطر %)', v_line_no;
        END IF;

        -- منع التسليم فوق الكمية المتبقّية (ما لم يُسمح صراحةً)
        IF NOT v_allow_over AND (v_inv_line.delivered + v_qty) > v_inv_line.quantity THEN
            RAISE EXCEPTION 'OVER_DELIVERY: الكمية % تتجاوز المتبقّي % في السطر %',
                v_qty, (v_inv_line.quantity - v_inv_line.delivered), v_line_no;
        END IF;

        -- قفل صف المنتج ضمن المؤسسة — يمنع سباق الخصم المتزامن
        SELECT id, stock_quantity, cost_price, name, name_ar
        INTO v_item
        FROM products
        WHERE id = v_inv_line.product_id AND org_id = v_org
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ITEM_NOT_FOUND: المنتج غير موجود ضمن مؤسستك (السطر %)', v_line_no;
        END IF;

        IF COALESCE(v_item.stock_quantity, 0) < v_qty THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: % — المتاح: %، المطلوب: %',
                COALESCE(v_item.name_ar, v_item.name),
                COALESCE(v_item.stock_quantity, 0), v_qty;
        END IF;

        v_unit_cost := COALESCE(v_item.cost_price, 0);
        v_total_cogs := v_total_cogs + (v_qty * v_unit_cost);

        INSERT INTO delivery_note_lines (
            org_id, delivery_note_id, sales_invoice_line_id, product_id,
            invoiced_quantity, delivered_quantity, quantity_delivered,
            unit_price, unit_cost_at_delivery, notes
        ) VALUES (
            v_org, v_dn_id, v_inv_line.id, v_item.id,
            v_inv_line.quantity, v_qty, v_qty,
            COALESCE(v_inv_line.unit_price, 0), v_unit_cost,
            NULLIF(v_line->>'notes', '')
        );

        UPDATE products
        SET stock_quantity = stock_quantity - v_qty, updated_at = NOW()
        WHERE id = v_item.id;

        IF to_regclass('public.stock_moves') IS NOT NULL THEN
            INSERT INTO stock_moves (
                org_id, product_id, quantity, move_type, unit_cost_out,
                reference_type, reference_id, reference_number, status, date_done
            ) VALUES (
                v_org, v_item.id, -v_qty, 'sales_delivery', v_unit_cost,
                'DELIVERY_NOTE', v_dn_id, v_dn_number, 'done', NOW()
            );
        END IF;

        UPDATE sales_invoice_lines
        SET delivered_quantity = v_inv_line.delivered + v_qty,
            unit_cost_at_sale = v_unit_cost
        WHERE id = v_inv_line.id;
    END LOOP;

    -- ===== قيد COGS — Fail-closed: أي فشل يُجهض العملية كلها =====
    -- (خريطة COGS_DELIVERY مزروعة؛ فشل الترحيل = خطأ حقيقي يجب ألا يمرّ)
    IF v_total_cogs > 0 THEN
        PERFORM rpc_post_event_journal(
            'COGS_DELIVERY', v_total_cogs,
            'تكلفة بضاعة مباعة - ' || v_dn_number,
            'DELIVERY_NOTE', v_dn_id, v_org,
            'COGS_DELIVERY:' || v_dn_id::TEXT, NULL
        );
    END IF;

    -- ===== تحديث حالة تسليم الفاتورة =====
    UPDATE sales_invoices si
    SET delivery_status = CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM sales_invoice_lines l
            WHERE l.invoice_id = si.id
              AND COALESCE(l.delivered_quantity, 0) < l.quantity
        ) THEN 'fully_delivered'
        ELSE 'partially_delivered'
    END
    WHERE si.id = v_invoice_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'delivery_id', v_dn_id,
        'delivery_number', v_dn_number,
        'total_cogs', ROUND(v_total_cogs, 6),
        'lines_processed', v_line_no,
        'warnings', v_warnings
    );
END;
$$;

COMMENT ON FUNCTION public.rpc_post_delivery_note(JSONB) IS
'إذن تسليم ذرّي محصَّن (Migration 88): تحقق عضوية المستخدم + عزل org لكل استعلام + ملكية الفاتورة/السطر/المنتج + منع تسليم زائد + idempotency + خصم تحت قفل + قيد COGS Fail-closed. معاملة واحدة كلها تنجح أو تفشل معاً.';

GRANT EXECUTE ON FUNCTION public.rpc_post_delivery_note(JSONB) TO authenticated;

-- ===================================================================
-- التحقق: SELECT proname FROM pg_proc WHERE proname='rpc_post_delivery_note';
--   SELECT 1 FROM information_schema.columns
--   WHERE table_name='delivery_notes' AND column_name='idempotency_key';
-- ===================================================================
