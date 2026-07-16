BEGIN;

-- 1) Trigger function
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

-- 2) Recalculate existing token_hash values
UPDATE public.invitations
SET token_hash = encode(sha256(token::bytea), 'hex')
WHERE token IS NOT NULL AND (token_hash IS NULL OR token_hash = '');

DO $$
DECLARE v_bad INT;
BEGIN
    SELECT COUNT(*) INTO v_bad FROM public.invitations WHERE token IS NOT NULL AND token_hash IS NULL;
    IF v_bad > 0 THEN RAISE EXCEPTION 'FAIL[112-1] — % صف بلا token_hash', v_bad; END IF;
    RAISE NOTICE 'VERIFY[112-1] OK — token_hash محسوبة بـ sha256()';
END;
$$;

-- 3) rpc_accept_invitation (returns JSONB — same signature as migration 104)
CREATE OR REPLACE FUNCTION public.rpc_accept_invitation(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_caller_id    UUID := auth.uid();
    v_caller_email TEXT;
    v_inv          invitations%ROWTYPE;
    v_hash         TEXT;
BEGIN
    IF v_caller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
    SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;
    v_hash := encode(sha256(p_token::bytea), 'hex');
    SELECT * INTO v_inv FROM invitations WHERE token_hash = v_hash FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_NOT_FOUND'); END IF;
    IF v_inv.status != 'pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_ALREADY_USED'); END IF;
    IF v_inv.expires_at < NOW() THEN
        UPDATE invitations SET status = 'expired' WHERE id = v_inv.id;
        RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_EXPIRED');
    END IF;
    IF lower(v_caller_email) != lower(v_inv.email) THEN RETURN jsonb_build_object('ok', false, 'error', 'EMAIL_MISMATCH'); END IF;
    INSERT INTO user_organizations (user_id, org_id, is_active, is_org_admin, joined_at, invited_by)
    VALUES (v_caller_id, v_inv.org_id, true, false, NOW(), v_inv.invited_by)
    ON CONFLICT (user_id, org_id) DO NOTHING;
    IF v_inv.role_ids IS NOT NULL AND array_length(v_inv.role_ids, 1) > 0 THEN
        INSERT INTO user_roles (user_id, role_id, org_id)
        SELECT v_caller_id, role_id, v_inv.org_id FROM unnest(v_inv.role_ids) AS role_id
        ON CONFLICT DO NOTHING;
    END IF;
    UPDATE invitations SET status = 'accepted', accepted_at = NOW() WHERE id = v_inv.id;
    RETURN jsonb_build_object('ok', true, 'org_id', v_inv.org_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rpc_accept_invitation(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_accept_invitation(text) TO authenticated;

-- 4) rpc_get_invitation_preview — DROP + recreate (signature changed from JSONB to TABLE in migration 103)
DROP FUNCTION IF EXISTS public.rpc_get_invitation_preview(text);
CREATE FUNCTION public.rpc_get_invitation_preview(p_token TEXT)
RETURNS TABLE(
    email       TEXT,
    org_name    TEXT,
    org_name_ar TEXT,
    status      TEXT,
    expires_at  TIMESTAMPTZ,
    is_valid    BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT;
BEGIN
    v_hash := encode(sha256(p_token::bytea), 'hex');
    RETURN QUERY
    SELECT inv.email::TEXT, org.name::TEXT, org.name_ar::TEXT,
           inv.status::TEXT, inv.expires_at,
           (inv.status = 'pending' AND inv.expires_at > NOW()) AS is_valid
    FROM invitations inv
    JOIN organizations org ON org.id = inv.org_id
    WHERE inv.token_hash = v_hash;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rpc_get_invitation_preview(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_get_invitation_preview(text) TO anon, authenticated;

COMMIT;
