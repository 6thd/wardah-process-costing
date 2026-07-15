-- ===================================================================
-- Migration 97: توحيد المخزون — products كمجمّع مرجعي مشتق من bins
-- ===================================================================
-- الفجوة المؤكَّدة حيّاً: نظاما مخزون منفصلان بلا مزامنة:
--   • إكمال أمر التصنيع (Migration 93) يكتب المنتج التام إلى products.stock_quantity.
--   • استلام البضاعة (Migration 94) يكتب إلى bins فقط (دفتر FIFO/تقييم مفصّل).
-- النتيجة: القيمتان منفصلتان (products=18,200 لمنتج تام، bins=3,250 لمادة خام)،
-- وتقارير الواجهة/اللوحة/تقييم المخزون تقرأ products ⇒ لا ترى مخزون المواد المستلمة.
--
-- القرار (الخيار B — الأقل تدخّلاً، إضافي 100%، بلا فقد بيانات):
--   products = المجمّع المرجعي الكامل للمخزون. التقارير تقرؤه أصلاً. bins يبقى
--   دفتر التقييم/الطابور المفصّل دون تغيير لدوره في التكلفة (FIFO/LIFO/متوسط).
--   لكل منتج **له صف bin** تُشتقّ products.stock_quantity و cost_price من مجموع
--   bins (عبر كل المخازن) — اشتقاق idempotent لا يضاعف. المنتجات التامة القادمة
--   من التصنيع (بلا bin) تبقى كما كتبها Migration 93 (لا تُمَسّ).
--
-- المبدأ: إضافي 100% (CREATE OR REPLACE + UPDATE تسوية idempotent، لا حذف).
-- الأمان: يبقى fail-closed وذرّية Migration 94 كما هي — نُضيف مزامنة products
-- **داخل** wardah_apply_stock_incoming بعد upsert الـ bin وضمن نفس المعاملة/القفل.
--
-- افتراض موثَّق: منتج يُصنَّع (تام، بلا bin) ومنتج يُستلَم (له bin) متمايزان في
-- هذا النموذج. منتج «هجين» (يُصنَّع ويُستلَم للمخزون معاً) نادر؛ عندئذ يسود اشتقاق
-- bins. يُعالَج مستقبلاً بجعل إكمال التصنيع يكتب bin للتام أيضاً (توحيد كامل).
-- ===================================================================

-- 1) إعادة تعريف wardah_apply_stock_incoming: نفس منطق Migration 94 حرفياً +
--    مزامنة products من bins بعد upsert الـ bin (ضمن نفس الذرّية/القفل).
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
    v_prod_qty   NUMERIC;
    v_prod_rate  NUMERIC;
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
        v_new_rate := COALESCE((v_new_queue->0->>'rate')::NUMERIC, p_rate);
    ELSIF v_method = 'LIFO' THEN
        v_len := jsonb_array_length(v_new_queue);
        v_new_rate := COALESCE((v_new_queue->(v_len - 1)->>'rate')::NUMERIC, p_rate);
    ELSE
        v_new_rate  := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE 0 END;
        v_new_queue := jsonb_build_array(jsonb_build_object('qty', v_new_qty, 'rate', v_new_rate));
    END IF;

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

    -- ✅ توحيد المخزون (Migration 97): مزامنة products من مجموع bins لهذا المنتج
    --    عبر كل المخازن — اشتقاق idempotent (لا يضاعف عند إعادة التطبيق). يجعل
    --    products المجمّع المرجعي الذي تقرؤه التقارير/اللوحة/تقييم المخزون.
    SELECT COALESCE(SUM(actual_qty), 0),
           CASE WHEN COALESCE(SUM(actual_qty), 0) > 0
                THEN SUM(stock_value) / SUM(actual_qty) ELSE NULL END
    INTO v_prod_qty, v_prod_rate
    FROM bins WHERE product_id = p_product AND org_id = p_org;

    UPDATE products
    SET stock_quantity = v_prod_qty,
        cost_price     = COALESCE(v_prod_rate, cost_price),
        updated_at     = NOW()
    WHERE id = p_product AND org_id = p_org;

    RETURN jsonb_build_object(
        'applied', TRUE, 'new_qty', v_new_qty,
        'new_rate', ROUND(v_new_rate, 6), 'new_value', ROUND(v_new_value, 6),
        'method', v_method,
        'product_synced', jsonb_build_object(
            'stock_quantity', v_prod_qty,
            'cost_price', ROUND(COALESCE(v_prod_rate, 0), 6))
    );
END;
$$;

COMMENT ON FUNCTION public.wardah_apply_stock_incoming(UUID,UUID,UUID,NUMERIC,NUMERIC,TEXT,UUID,TEXT,DATE) IS
'تطبيق حركة مخزون واردة ذرّياً (Migration 94 + توحيد 97): قفل صف bin ⇒ تقييم (FIFO/LIFO/متوسط) ⇒ SLE + upsert bin + مزامنة products.stock_quantity/cost_price من مجموع bins (اشتقاق idempotent). products هو المجمّع المرجعي للمخزون؛ bins دفتر التقييم المفصّل.';

GRANT EXECUTE ON FUNCTION public.wardah_apply_stock_incoming(UUID,UUID,UUID,NUMERIC,NUMERIC,TEXT,UUID,TEXT,DATE) TO authenticated;

-- ===================================================================
-- 2) تسوية لمرة واحدة (idempotent): مواءمة products مع bins الموجودة مسبقاً
--    التي استُلمت قبل هذا الترحيل (لم تكن تُحدِّث products). لا تمسّ المنتجات
--    التامة بلا bin (تبقى بقيمة إكمال التصنيع). قابلة لإعادة التشغيل بأمان.
-- ===================================================================
UPDATE products p
SET stock_quantity = agg.q,
    cost_price     = COALESCE(agg.r, p.cost_price),
    updated_at     = NOW()
FROM (
    SELECT product_id, org_id,
           SUM(actual_qty) AS q,
           CASE WHEN SUM(actual_qty) > 0
                THEN SUM(stock_value) / SUM(actual_qty) ELSE NULL END AS r
    FROM bins
    GROUP BY product_id, org_id
) agg
WHERE p.id = agg.product_id
  AND p.org_id = agg.org_id
  AND (p.stock_quantity IS DISTINCT FROM agg.q
       OR p.cost_price IS DISTINCT FROM COALESCE(agg.r, p.cost_price));
