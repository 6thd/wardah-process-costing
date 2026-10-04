-- Mechanics proof (NOT a hosted-Supabase proof): the exact ownership-switch
-- sequence of Migration 202, executed by a NON-superuser CREATEROLE schema owner
-- (the privilege shape of Supabase's `postgres`). It must leave the target role
-- owning the function with no SET/INHERIT membership edge, no CREATE grant and no ACL
-- entry. The ADMIN-only self-membership that CREATE ROLE gives a non-superuser creator
-- cannot be revoked by that creator (verified); it is the one tolerated residue.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE zz_mig_owner NOSUPERUSER CREATEROLE NOLOGIN;
CREATE SCHEMA zz_s AUTHORIZATION zz_mig_owner;
SET LOCAL SESSION AUTHORIZATION zz_mig_owner;
CREATE FUNCTION zz_s.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
CREATE ROLE zz_target NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT zz_target TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;
GRANT CREATE ON SCHEMA zz_s TO zz_target;
ALTER FUNCTION zz_s.f() OWNER TO zz_target;
REVOKE CREATE ON SCHEMA zz_s FROM zz_target;
REVOKE zz_target FROM CURRENT_USER;
RESET SESSION AUTHORIZATION;
DO $$
BEGIN
  IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid = 'zz_s.f()'::regprocedure) <> 'zz_target'
     OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = 'zz_target'::regrole
                OR (m.roleid = 'zz_target'::regrole AND (m.set_option OR m.inherit_option
                    OR NOT m.admin_option OR m.member <> 'zz_mig_owner'::regrole)))
     OR has_schema_privilege('zz_target', 'zz_s', 'CREATE')
     OR EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refobjid = 'zz_target'::regrole AND d.deptype = 'a') THEN
    RAISE EXCEPTION 'M202_OWNER_SWITCH_MECHANICS_FAIL';
  END IF;
  RAISE NOTICE 'M202_OWNER_SWITCH_MECHANICS_OK non-superuser CREATEROLE owner switched the function and left only the creator ADMIN-only membership (no SET/INHERIT), no CREATE grant and no ACL entry';
END $$;
ROLLBACK;
