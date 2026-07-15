-- ===================================================================
-- Migration 104: P1 تكملة — تضييق منح anon، سياسات USING(true)، token_hash
-- ===================================================================
-- ما يفعله هذا الـ migration:
--   1. سحب EXECUTE من anon على RPCs الحساسة (يبقى rpc_get_invitation_preview)
--   2. سحب ALL من anon على الجداول المالية والإدارية الحساسة
--   3. إصلاح audit_logs.audit_insert: WITH CHECK(true) → user_id = auth.uid()
--   4. إصلاح bill_of_materials_20250905_1900: USING(true) → super_admin فقط
--   5. إصلاح users_profiles_20250905_1900: USING(true) → user_id = auth.uid()
--   6. token_hash: إضافة SHA-256 المحسوب تلقائيًا للدعوات + تحديث RPCs
-- ===================================================================

BEGIN;

-- ===================================================================
-- 1. سحب EXECUTE من anon على RPCs الحساسة
-- ===================================================================
REVOKE EXECUTE ON FUNCTION public.rpc_set_org_admin(uuid, uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_accept_invitation(text)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_create_journal_entry(jsonb)         FROM anon;
REVOKE EXECUTE ON FUNCTION public.wardah_is_org_admin(uuid)               FROM anon;
-- rpc_get_invitation_preview(text): يبقى لـ anon — معاينة الدعوة قبل التسجيل

-- ===================================================================
-- 2. سحب صلاحيات anon الواسعة عن الجداول الحساسة
--    RLS يحمي الصفوف، لكن TRUNCATE لا يمر بـ RLS — نمنع من الأساس
-- ===================================================================
REVOKE ALL ON TABLE public.gl_entries         FROM anon;
REVOKE ALL ON TABLE public.gl_entry_lines     FROM anon;
REVOKE ALL ON TABLE public.user_organizations FROM anon;
REVOKE ALL ON TABLE public.user_roles         FROM anon;
REVOKE ALL ON TABLE public.roles              FROM anon;
REVOKE ALL ON TABLE public.role_permissions   FROM anon;
REVOKE ALL ON TABLE public.invitations        FROM anon;

-- ===================================================================
-- 3. إصلاح audit_logs.audit_insert
--    قبل: WITH CHECK(true) — أي مستخدم موثَّق يكتب أي صف
--    بعد: WITH CHECK(user_id = auth.uid()) — مقيَّد بمعرِّف المستخدم
-- ===================================================================
DROP POLICY IF EXISTS "audit_insert" ON public.audit_logs;
CREATE POLICY "audit_insert" ON public.audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- ===================================================================
-- 4. إصلاح backup: bill_of_materials_20250905_1900
--    لا يحتوي org_id → قصر الوصول على super_admins فقط
-- ===================================================================
DROP POLICY IF EXISTS "authenticated_all_bill_materials" ON public.bill_of_materials_20250905_1900;
CREATE POLICY "bom_backup_super_admin_only" ON public.bill_of_materials_20250905_1900
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.super_admins sa
            WHERE sa.user_id = auth.uid() AND sa.is_active = true
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.super_admins sa
            WHERE sa.user_id = auth.uid() AND sa.is_active = true
        )
    );

-- ===================================================================
-- 5. إصلاح backup: users_profiles_20250905_1900
--    قبل: USING(true) / WITH CHECK(true)
--    بعد: user_id = auth.uid() فقط
-- ===================================================================
DROP POLICY IF EXISTS "safe_insert_profiles" ON public.users_profiles_20250905_1900;
DROP POLICY IF EXISTS "safe_select_profiles" ON public.users_profiles_20250905_1900;
DROP POLICY IF EXISTS "safe_update_profiles" ON public.users_profiles_20250905_1900;

CREATE POLICY "profiles_backup_self" ON public.users_profiles_20250905_1900
    FOR ALL TO authenticated
    USING   (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ===================================================================
-- 6. token_hash: SHA-256 للدعوات (pgcrypto مفعَّلة)
-- ===================================================================

-- 6a. إضافة عمود token_hash
ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS token_hash TEXT;

-- 6b. ملء الصفوف القائمة
UPDATE public.invitations
SET token_hash = encode(digest(token, 'sha256'), 'hex')
WHERE token_hash IS NULL AND token IS NOT NULL;

-- 6c. فهرس فريد (يُسرَّع البحث ويمنع التكرار)
CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_hash_key
    ON public.invitations (token_hash);

-- 6d. دالة Trigger لحساب الهاش تلقائيًا
CREATE OR REPLACE FUNCTION public.fn_invitations_set_token_hash()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.token IS NOT NULL THEN
        NEW.token_hash := encode(digest(NEW.token, 'sha256'), 'hex');
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_invitations_set_token_hash() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_invitations_set_token_hash ON public.invitations;
CREATE TRIGGER trg_invitations_set_token_hash
    BEFORE INSERT OR UPDATE OF token ON public.invitations
    FOR EACH ROW EXECUTE FUNCTION public.fn_invitations_set_token_hash();

-- 6e. تحديث rpc_accept_invitation: البحث بالهاش بدل التوكن الخام
CREATE OR REPLACE FUNCTION public.rpc_accept_invitation(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_caller_id    UUID := auth.uid();
    v_caller_email TEXT;
    v_inv          invitations%ROWTYPE;
    v_hash         TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;
    v_hash := encode(digest(p_token, 'sha256'), 'hex');

    -- FOR UPDATE: منع قبول نفس الدعوة مرتين بشكل متزامن
    SELECT * INTO v_inv
    FROM invitations
    WHERE token_hash = v_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_NOT_FOUND');
    END IF;

    IF v_inv.status != 'pending' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_ALREADY_USED');
    END IF;

    IF v_inv.expires_at < NOW() THEN
        UPDATE invitations SET status = 'expired' WHERE id = v_inv.id;
        RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_EXPIRED');
    END IF;

    IF lower(v_caller_email) != lower(v_inv.email) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'EMAIL_MISMATCH');
    END IF;

    INSERT INTO user_organizations (user_id, org_id, is_active, is_org_admin, joined_at, invited_by)
    VALUES (v_caller_id, v_inv.org_id, true, false, NOW(), v_inv.invited_by)
    ON CONFLICT (user_id, org_id) DO NOTHING;

    IF v_inv.role_ids IS NOT NULL AND array_length(v_inv.role_ids, 1) > 0 THEN
        INSERT INTO user_roles (user_id, role_id, org_id)
        SELECT v_caller_id, role_id, v_inv.org_id
        FROM unnest(v_inv.role_ids) AS role_id
        ON CONFLICT DO NOTHING;
    END IF;

    UPDATE invitations
    SET status = 'accepted', accepted_at = NOW()
    WHERE id = v_inv.id;

    RETURN jsonb_build_object('ok', true, 'org_id', v_inv.org_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_accept_invitation(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_accept_invitation(text) TO authenticated;

-- 6f. تحديث rpc_get_invitation_preview: البحث بالهاش
CREATE OR REPLACE FUNCTION public.rpc_get_invitation_preview(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_inv  RECORD;
    v_hash TEXT;
BEGIN
    v_hash := encode(digest(p_token, 'sha256'), 'hex');

    SELECT i.id, i.org_id, i.email, i.status, i.expires_at,
           o.name AS org_name
    INTO v_inv
    FROM invitations i
    JOIN organizations o ON o.id = i.org_id
    WHERE i.token_hash = v_hash;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invitation_not_found');
    END IF;

    IF v_inv.status != 'pending' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invitation_not_pending');
    END IF;

    IF v_inv.expires_at < NOW() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invitation_expired');
    END IF;

    RETURN jsonb_build_object(
        'ok',         true,
        'org_name',   v_inv.org_name,
        'email',      v_inv.email,
        'expires_at', v_inv.expires_at
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_get_invitation_preview(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_get_invitation_preview(text) TO anon, authenticated;

COMMIT;
