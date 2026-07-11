-- ===================================================================
-- Migration 93: إتمام أمر التصنيع الذرّي — تكلفة فعلية متراكمة (WIP→FG)
-- ===================================================================
-- الفجوة: إتمام أمر التصنيع لم يكن يُنشئ مخزوناً تامّاً ولا يُرحّل أي قيد.
-- المواد تُستهلَك (تُخفَّض من المخزون وتُسجَّل في material_consumption) لكن
-- بلا أثر محاسبي، والإتمام لا يزيد مخزون المنتج التام ولا يُرحّل WIP→FG.
--
-- الحل (قرار المالك: تكلفة فعلية متراكمة): عند الإتمام تُحسب تكلفة WIP
-- الفعلية من material_consumption، ويُرحَّل — في معاملة واحدة Fail-closed —
-- قيدا سلسلة التكلفة:
--   1) MATERIAL_ISSUE : مدين WIP / دائن مواد خام   (إدخال المواد للـ WIP)
--   2) FG_RECEIPT     : مدين تام / دائن WIP          (تحويل WIP لتام)
-- فيصفو WIP (داخل/خارج) وصافي الأثر مدين تام / دائن مواد، ويزيد مخزون
-- المنتج التام بالكمية المنجزة بتكلفة الوحدة = WIP/الكمية.
--
-- المبدأ: org + عضوية + ملكية + عدم إتمام مزدوج (idempotent) + Fail-closed.
-- الأجور/الأوفرهيد وWIP متعدد المراحل: بناء لاحق (تُضاف كأحداث WIP إضافية).
-- ===================================================================

-- 0) مواءمة خريطة FG_RECEIPT لتدائن نفس حساب WIP الذي يُدين به MATERIAL_ISSUE
--    (كان يدائن 134500 بينما MATERIAL_ISSUE يدين 134100 ⇒ WIP لا يصفو)
SELECT rpc_upsert_event_mapping('FG_RECEIPT', '135100', '134100', NULL,
  'استلام إنتاج تام: مدين مخزون تام / دائن WIP');

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

    -- قفل أمر التصنيع + ملكية المؤسسة
    SELECT id, status, quantity, completed_quantity, product_id, total_cost
    INTO v_mo
    FROM manufacturing_orders
    WHERE id = v_mo_id AND org_id = v_org
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MO_NOT_FOUND: أمر التصنيع غير موجود ضمن مؤسستك';
    END IF;

    -- idempotency: أمر مُتَمّ سلفاً ⇒ إعادة النتيجة بلا تكرار
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
            v_org, v_mo.product_id, v_done_qty, 'manufacturing_receipt', v_unit_cost,
            'MANUFACTURING_ORDER', v_mo_id, NULL, 'done', NOW()
        );
    END IF;

    -- ===== حالة أمر التصنيع = done (الـ trigger يضبط completed_date) + التكلفة =====
    UPDATE manufacturing_orders
    SET status = 'done', completed_quantity = v_done_qty,
        total_cost = v_wip_cost, unit_cost = v_unit_cost
    WHERE id = v_mo_id;

    -- ===== سلسلة القيود — Fail-closed — تُرحَّل فقط عند تكلفة موجبة =====
    IF v_wip_cost > 0 THEN
        -- مدين WIP / دائن مواد خام (إدخال المواد المستهلَكة للـ WIP)
        PERFORM rpc_post_event_journal(
            'MATERIAL_ISSUE', v_wip_cost, 'صرف مواد لأمر تصنيع - ' || v_mo_id::TEXT,
            'MANUFACTURING_ORDER', v_mo_id, v_org, 'MATERIAL_ISSUE:' || v_mo_id::TEXT, NULL
        );
        -- مدين تام / دائن WIP (تحويل WIP لتام)
        PERFORM rpc_post_event_journal(
            'FG_RECEIPT', v_wip_cost, 'إنتاج تام لأمر تصنيع - ' || v_mo_id::TEXT,
            'MANUFACTURING_ORDER', v_mo_id, v_org, 'FG_RECEIPT:' || v_mo_id::TEXT, NULL
        );
    ELSE
        v_warnings := v_warnings || to_jsonb(
            'لا تكلفة مواد مسجَّلة لهذا الأمر — أُتمّ بلا قيد (تكلفة صفرية). ' ||
            'تأكد من تسجيل استهلاك المواد قبل الإتمام.'::TEXT
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
'إتمام أمر تصنيع ذرّي (Migration 93): تكلفة فعلية متراكمة من material_consumption ⇒ زيادة مخزون المنتج التام (متوسط مرجّح) + سلسلة قيود Raw→WIP→FG (Fail-closed) + حالة done + idempotent (لا إتمام مزدوج). عضوية + عزل org.';

GRANT EXECUTE ON FUNCTION public.rpc_complete_manufacturing_order(JSONB) TO authenticated;

-- ===================================================================
-- التحقق: اختبار حيّ (rollback) — صرف مواد وهمي ⇒ إتمام ⇒ مخزون تام يزيد،
-- total_cost = مجموع المواد، قيدان MATERIAL_ISSUE + FG_RECEIPT، إتمام ثانٍ = replay.
-- ===================================================================
