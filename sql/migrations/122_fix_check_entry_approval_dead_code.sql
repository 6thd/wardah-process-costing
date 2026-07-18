-- migration_number: 122
-- description: Remove dead-code app.current_org_id fallback from check_entry_approval_required
--              The function is SECURITY INVOKER (safe), but the fallback to the default org
--              was misleading. Cleaned to avoid confusion with pre-121 patterns.

CREATE OR REPLACE FUNCTION public.check_entry_approval_required(p_entry_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_entry_amount NUMERIC;
BEGIN
    -- Read under caller's RLS context (SECURITY INVOKER by default)
    SELECT COALESCE(SUM(GREATEST(debit_amount, credit_amount)), 0)
    INTO v_entry_amount
    FROM gl_entry_lines
    WHERE entry_id = p_entry_id;

    -- TODO: Implement approval workflow thresholds per org settings
    RETURN false;
END;
$function$;
