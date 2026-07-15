-- ===================================================================
-- Migration 87: مواءمة دالة التسليم الذرّي مع المخطط الحيّ (تصحيح 85)
-- ===================================================================
-- الخلفية: Migration 85 كُتبت لمخطط يستخدم جدول `items` وأعمدة
-- `tenant_id`/`delivery_id`/`invoice_line_id`. لكن قاعدة الإنتاج الحيّة
-- موحَّدة على `products` (الأصناف — 118 صفاً؛ `items` جدول ميت فارغ،
-- وكل مفاتيح product_id الأجنبية تشير إلى products) و`org_id` وأعمدة
-- `delivery_note_id`/`sales_invoice_line_id`. فكانت 85 تفشل وقت التشغيل
-- وتسقط للمسار القديم — أي أن التسليم الذرّي لم يكن يعمل فعلاً.
--
-- هذا الملف يعيد تعريف نفس الدالة بالأسماء الحيّة الصحيحة. لا تغيير في
-- المنطق أو الدلالة (قفل صف + خصم + COGS في معاملة واحدة). CREATE OR
-- REPLACE — idempotent، إضافي، لا يمس بيانات.
--
-- تحقّق حيّ (rollback): استُدعيت على فاتورة فعلية داخل معاملة أُلغيت،
-- فأرجعت success مع delivery_number وtotal_cogs دون أي خطأ عمود/جدول.
-- ===================================================================

CREATE OR REPLACE FUNCTION public.rpc_post_delivery_note(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org        UUID;
    v_dn_id      UUID;
    v_dn_number  TEXT;
    v_invoice_id UUID;
    v_line       JSONB;
    v_item       RECORD;
    v_qty        NUMERIC;
    v_unit_cost  NUMERIC;
    v_line_cogs  NUMERIC;
    v_total_cogs NUMERIC := 0;
    v_line_no    INTEGER := 0;
    v_inv_line_id UUID;
    v_prev_delivered NUMERIC;
    v_inv_qty    NUMERIC;
    v_inv_price  NUMERIC;
    v_warnings   JSONB := '[]'::JSONB;
BEGIN
    -- ===== هوية المؤسسة =====
    v_org := wardah_org_id(NULLIF(p_payload->>'tenant_id', '')::UUID);
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'ORG_NOT_RESOLVED: تعذر تحديد هوية المؤسسة';
    END IF;

    v_invoice_id := (p_payload->>'sales_invoice_id')::UUID;
    IF v_invoice_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_PAYLOAD: sales_invoice_id مطلوب';
    END IF;
    IF jsonb_array_length(COALESCE(p_payload->'lines', '[]'::JSONB)) = 0 THEN
        RAISE EXCEPTION 'INVALID_PAYLOAD: لا سطور في إذن التسليم';
    END IF;

    -- ===== فحص الفترة المحاسبية (Migration 79 — إن وُجدت) =====
    BEGIN
        PERFORM assert_period_open(
            v_org,
            COALESCE((p_payload->>'delivery_date')::DATE, CURRENT_DATE)
        );
    EXCEPTION
        WHEN undefined_function THEN NULL;  -- 79 غير مطبَّقة — نكمل
    END;

    -- ===== توليد رقم التسليم داخل المعاملة (بقفل استشاري يمنع التصادم) =====
    PERFORM pg_advisory_xact_lock(hashtext('delivery_notes:' || v_org::TEXT));
    SELECT 'DN-' || LPAD((
        COALESCE(MAX(NULLIF(regexp_replace(delivery_number, '\D', '', 'g'), ''))::BIGINT, 0) + 1
    )::TEXT, 6, '0')
    INTO v_dn_number
    FROM delivery_notes
    WHERE org_id = v_org AND delivery_number ~ '^DN-\d+$';
    v_dn_number := COALESCE(v_dn_number, 'DN-000001');

    -- ===== رأس إذن التسليم =====
    INSERT INTO delivery_notes (
        org_id, delivery_number, sales_invoice_id, customer_id,
        delivery_date, vehicle_number, driver_name, status, notes
    ) VALUES (
        v_org, v_dn_number, v_invoice_id,
        (p_payload->>'customer_id')::UUID,
        COALESCE((p_payload->>'delivery_date')::DATE, CURRENT_DATE),
        NULLIF(p_payload->>'vehicle_number', ''),
        NULLIF(p_payload->>'driver_name', ''),
        'delivered',
        NULLIF(p_payload->>'notes', '')
    )
    RETURNING id INTO v_dn_id;

    -- ===== السطور: قفل ← تحقق ← خصم ← حركة ← تحديث سطر الفاتورة =====
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_payload->'lines')
    LOOP
        v_line_no := v_line_no + 1;
        v_qty := (v_line->>'delivered_quantity')::NUMERIC;
        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION 'INVALID_LINE: كمية غير صالحة في السطر %', v_line_no;
        END IF;

        -- قفل صف الصنف في products — يمنع سباق الخصم المتزامن نهائياً
        SELECT id, stock_quantity, cost_price, name, name_ar
        INTO v_item
        FROM products
        WHERE id = (v_line->>'item_id')::UUID
        FOR UPDATE;

        IF v_item.id IS NULL THEN
            RAISE EXCEPTION 'ITEM_NOT_FOUND: الصنف % غير موجود', v_line->>'item_id';
        END IF;

        -- نفس دلالة الواجهة الحالية: لا تسليم برصيد غير كافٍ
        IF COALESCE(v_item.stock_quantity, 0) < v_qty THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: % — المتاح: %، المطلوب: %',
                COALESCE(v_item.name_ar, v_item.name),
                COALESCE(v_item.stock_quantity, 0), v_qty;
        END IF;

        v_unit_cost := COALESCE(v_item.cost_price, 0);
        v_line_cogs := v_qty * v_unit_cost;
        v_total_cogs := v_total_cogs + v_line_cogs;

        -- جلب سطر الفاتورة (لأعمدة NOT NULL: invoiced_quantity/unit_price)
        -- وقفله لتحديث الكمية المسلَّمة لاحقاً — استعلام واحد
        v_inv_line_id := NULLIF(v_line->>'sales_invoice_line_id', '')::UUID;
        v_inv_qty := NULL; v_inv_price := NULL; v_prev_delivered := 0;
        IF v_inv_line_id IS NOT NULL THEN
            SELECT quantity, unit_price, COALESCE(delivered_quantity, 0)
            INTO v_inv_qty, v_inv_price, v_prev_delivered
            FROM sales_invoice_lines WHERE id = v_inv_line_id
            FOR UPDATE;
        END IF;

        -- سطر التسليم — الجدول يحمل invoiced/delivered/quantity_delivered كلها
        INSERT INTO delivery_note_lines (
            org_id, delivery_note_id, sales_invoice_line_id, product_id,
            invoiced_quantity, delivered_quantity, quantity_delivered,
            unit_price, unit_cost_at_delivery, notes
        ) VALUES (
            v_org, v_dn_id, v_inv_line_id, v_item.id,
            COALESCE(v_inv_qty, v_qty), v_qty, v_qty,
            COALESCE(v_inv_price, 0), v_unit_cost,
            NULLIF(v_line->>'notes', '')
        );

        -- الخصم — تحت القفل، لا سباق
        UPDATE products
        SET stock_quantity = stock_quantity - v_qty,
            updated_at = NOW()
        WHERE id = v_item.id;

        -- حركة المخزون (إن وُجد الجدول — دفاعي)
        IF to_regclass('public.stock_moves') IS NOT NULL THEN
            INSERT INTO stock_moves (
                org_id, product_id, quantity, move_type,
                unit_cost_out, reference_type, reference_id,
                reference_number, status, date_done
            ) VALUES (
                v_org, v_item.id, -v_qty, 'sales_delivery',
                v_unit_cost, 'DELIVERY_NOTE', v_dn_id,
                v_dn_number, 'done', NOW()
            );
        END IF;

        -- تحديث الكمية المسلَّمة في سطر الفاتورة (مقفول أعلاه)
        IF v_inv_line_id IS NOT NULL THEN
            UPDATE sales_invoice_lines
            SET delivered_quantity = v_prev_delivered + v_qty,
                unit_cost_at_sale = v_unit_cost
            WHERE id = v_inv_line_id;
        END IF;
    END LOOP;

    -- ===== قيد COGS عبر بوابة الأحداث (إن وُجدت خريطة COGS_DELIVERY) =====
    IF v_total_cogs > 0 THEN
        BEGIN
            PERFORM rpc_post_event_journal(
                'COGS_DELIVERY', v_total_cogs,
                'تكلفة بضاعة مباعة - ' || v_dn_number,
                'DELIVERY_NOTE', v_dn_id, v_org,
                'COGS_DELIVERY:' || v_dn_id::TEXT, NULL
            );
        EXCEPTION WHEN OTHERS THEN
            v_warnings := v_warnings || to_jsonb(
                'قيد COGS لم يُرحَّل: ' || SQLERRM ||
                ' — ازرع خريطة COGS_DELIVERY عبر rpc_upsert_event_mapping'
            );
        END;
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
'إذن تسليم ذرّي (مواءم للمخطط الحيّ products/org_id — Migration 87): رأس + سطور + قفل صف المنتج (FOR UPDATE) + خصم المخزون + حركة stock_moves (إن وُجد) + قيد COGS عبر rpc_post_event_journal — معاملة واحدة، كلها تنجح معاً أو تفشل معاً.';

GRANT EXECUTE ON FUNCTION public.rpc_post_delivery_note(JSONB) TO authenticated;

-- ===================================================================
-- التحقق: SELECT proname FROM pg_proc WHERE proname='rpc_post_delivery_note';
-- ===================================================================
