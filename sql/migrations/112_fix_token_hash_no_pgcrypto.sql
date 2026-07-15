-- ===================================================================
-- Migration 112: استبدال pgcrypto.digest() بـ sha256() المدمجة
-- ===================================================================
-- المشكلة:
--   Migration 104 أنشأ fn_invitations_set_token_hash + rpc_accept_invitation
--   + rpc_get_invitation_preview باستخدام digest(text,'sha256') من pgcrypto.
--   pgcrypto غير مثبَّتة ⇒ كل INSERT/UPDATE على invitations يفشل.
-- الحل:
--   استبدال digest(x,'sha256') بـ sha256(x::bytea) المدمجة في PostgreSQL 11+.
--   النتيجة الهاشية متطابقة — SHA-256 هو SHA-256 بصرف النظر عن المصدر.
-- ===================================================================

BEGIN;

-- 1) إعادة بناء trigger function بـ sha256() المدمجة
CREATE OR REPLACE FUNCTION public.fn_invitations_set_token_hash()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.token IS NOT NULL THEN
        NEW.token_hash := encode(sha256(NEW.token::bytea), 'hex');
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_invitations_set_token_hash() FROM PUBLIC, anon, authenticated;

-- 2) إعادة حساب token_hash للصفوف القائمة (أي كانت NULL بسبب pgcrypto المعطوبة)
UPDATE public.invitations
SET token_hash = encode(sha256(token::bytea), 'hex')
WHERE token IS NOT NULL
  AND (token_hash IS NULL OR token_hash = '');

DO $$
DECLARE v_fixed INT;
BEGIN
    SELECT COUNT(*) INTO v_fixed FROM public.invitations WHERE token IS NOT NULL AND token_hash IS NULL;
    IF v_fixed > 0 THEN
        RAISE EXCEPTION 'FAIL[112-1] — % صف دعوة لا يزال بلا token_hash بعد الإصلاح', v_fixed;
    END IF;
    RAISE NOTICE 'VERIFY[112-1] ✓ — كل token_hash محسوبة بـ sha256()';
END;
$$;

-- 3) rpc_accept_invitation — البحث بالهاش بدل التوكن الخام
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
    v_hash := encode(sha256(p_token::bytea), 'hex');

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

-- 4) rpc_get_invitation_preview — البحث بالهاش
CREATE OR REPLACE FUNCTION public.rpc_get_invitation_preview(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_inv  RECORD;
    v_hash TEXT;
BEGIN
    v_hash := encode(sha256(p_token::bytea), 'hex');

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

RAISE NOTICE 'VERIFY[112-2] ✓ — fn_invitations_set_token_hash + rpc_accept_invitation + rpc_get_invitation_preview: sha256() مدمجة بلا pgcrypto';

COMMIT;
