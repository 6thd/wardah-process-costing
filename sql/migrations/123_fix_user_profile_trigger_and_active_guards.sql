-- migration_number: 123
-- description: Correct auth profile target and require active organization membership.
-- safety: replace-only; no table, column, policy, trigger, or data is deleted.

-- Keep the existing auth.users trigger and replace only its target function.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.user_profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    NEW.email
  )
  ON CONFLICT (user_id) DO UPDATE
  SET full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
      email = COALESCE(EXCLUDED.email, public.user_profiles.email),
      updated_at = now();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Preserve signup availability while surfacing the database error in logs.
    RAISE WARNING 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Fail closed: NULL or false is not an active membership.
CREATE OR REPLACE FUNCTION public.wardah_assert_org_member(p_org uuid)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'ORG_UNRESOLVED';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_organizations
    WHERE user_id = auth.uid()
      AND org_id = p_org
      AND is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'NOT_ORG_MEMBER';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wardah_is_org_admin(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_organizations
    WHERE user_id = auth.uid()
      AND org_id = p_org
      AND is_active IS TRUE
      AND (COALESCE(is_org_admin, FALSE) OR role IN ('admin', 'owner'))
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.wardah_assert_org_member(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wardah_is_org_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wardah_is_org_admin(uuid) TO authenticated;
