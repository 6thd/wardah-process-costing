-- ===================================================================
-- Migration 92: إصلاح تعارض مخطط آلة حالات أمر التصنيع (drift)
-- ===================================================================
-- المشكلة: rpc_transition_mo_status و trg_mo_status_machine (Migration 78)
-- تشيران لأعمدة غير موجودة في الجدول الحيّ:
--   mo_number      → الصحيح order_number
--   date_started   → الصحيح start_date
--   date_finished  → الصحيح completed_date
-- فأي محاولة لتغيير حالة أمر تصنيع تفشل بـ:
--   ERROR 42703: column "mo_number" does not exist
-- أي أن آلة حالات التصنيع كلها **معطوبة** على الإنتاج (كتعارض التسليم في 87).
--
-- هذا الملف يعيد تعريف الدالتين بالأسماء الحيّة الصحيحة، ويضيف تحقق عضوية
-- المستخدم، ويصحّح previous_status (كان يعيد الحالة الجديدة). CREATE OR
-- REPLACE — إضافي، لا يمس بيانات. لا تغيير في منطق آلة الحالات.
-- ===================================================================

-- 1) الـ Trigger — تصحيح أسماء أعمدة التواريخ
CREATE OR REPLACE FUNCTION public.trg_mo_status_machine()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_norm_status TEXT;
BEGIN
    v_norm_status := normalize_mo_status(NEW.status);
    PERFORM validate_mo_transition(OLD.status, v_norm_status);
    NEW.status := v_norm_status;

    IF v_norm_status = 'in_progress' AND OLD.start_date IS NULL THEN
        NEW.start_date := NOW();
    END IF;

    IF v_norm_status IN ('done', 'cancelled') AND OLD.completed_date IS NULL THEN
        NEW.completed_date := NOW();
    END IF;

    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

-- 2) دالة الانتقال — تصحيح الأعمدة + تحقق العضوية + previous_status صحيح
CREATE OR REPLACE FUNCTION public.rpc_transition_mo_status(
    p_mo_id UUID, p_status TEXT, p_notes TEXT DEFAULT NULL, p_tenant UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org  UUID;
    v_uid  UUID;
    v_prev TEXT;
    v_norm TEXT;
    v_mo   RECORD;
BEGIN
    v_org  := wardah_org_id(p_tenant);
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'ORG_NOT_RESOLVED: تعذر تحديد هوية المؤسسة';
    END IF;

    v_uid := auth.uid();
    IF v_uid IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM user_organizations WHERE user_id = v_uid AND org_id = v_org
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN_ORG: المستخدم ليس عضواً في المؤسسة المطلوبة';
    END IF;

    v_norm := normalize_mo_status(p_status);

    SELECT id, status, order_number INTO v_mo
    FROM manufacturing_orders
    WHERE id = p_mo_id AND org_id = v_org;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MO_NOT_FOUND: أمر التصنيع "%" غير موجود ضمن مؤسستك', p_mo_id;
    END IF;
    v_prev := normalize_mo_status(v_mo.status);

    PERFORM validate_mo_transition(v_mo.status, v_norm);

    UPDATE manufacturing_orders
    SET status = v_norm, notes = COALESCE(p_notes, notes)
    WHERE id = p_mo_id AND org_id = v_org;

    SELECT id, order_number, status, start_date, completed_date, updated_at
    INTO v_mo
    FROM manufacturing_orders WHERE id = p_mo_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'mo_id', p_mo_id,
        'order_number', v_mo.order_number,
        'previous_status', v_prev,
        'new_status', v_norm,
        'start_date', v_mo.start_date,
        'completed_date', v_mo.completed_date,
        'updated_at', v_mo.updated_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_transition_mo_status(UUID, TEXT, TEXT, UUID) TO authenticated;

-- ===================================================================
-- التحقق: rpc_transition_mo_status على أمر حقيقي (rollback) ⇒ success
-- بلا خطأ عمود. ملاحظة: الإتمام المالي (مخزون تام + قيد FG) غير مطبَّق بعد —
-- بند مستقل (بناء منظومة تكلفة التصنيع) يحتاج قرار سياسة تقييم من المالك.
-- ===================================================================
