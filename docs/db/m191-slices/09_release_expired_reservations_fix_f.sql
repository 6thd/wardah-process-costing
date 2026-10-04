-- Wardah ERP / F2 / M191 review slice 09
-- Object 11 only: release_expired_reservations(uuid) — Fix F.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 61 plus the current out-of-band
-- search_path hardening, as fixed by the M191 source/evidence matrix.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized change in this slice only:
--   * replace the predecessor's unordered multi-row UPDATE acquisition with an
--     ordered lock-then-update: first capture every row that qualifies at this
--     call's lock snapshot in ascending material_reservations.id order using
--     FOR NO KEY UPDATE, then update exactly those locked ids.
--
-- Preserved deliberately:
--   * SECURITY INVOKER (no SECURITY DEFINER is introduced);
--   * current search_path = public,pg_temp hardening;
--   * p_org_id NULL means all organizations; a non-NULL value scopes by org_id;
--   * eligibility remains status='reserved', expires_at IS NOT NULL, expires_at
--     < now();
--   * status/released_at/quantity_released/updated_at assignments are unchanged;
--   * quantity_released remains exactly quantity_reserved - quantity_consumed,
--     including the predecessor's existing NULL propagation;
--   * return value remains the number of rows updated;
--   * no SKIP LOCKED / best-effort semantics;
--   * existing PUBLIC/anon/authenticated/service_role ACL is unchanged and is
--     intentionally not restated in this review fragment.

CREATE OR REPLACE FUNCTION public.release_expired_reservations(
  p_org_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
  v_ids uuid[] := '{}'::uuid[];
  v_id uuid;
BEGIN
  -- M191 Fix F: consume and release must acquire material_reservations rows in
  -- the same deterministic id order. Lock the complete qualifying set first;
  -- do not use SKIP LOCKED, because this function remains an exact sweep rather
  -- than a best-effort cron pass.
  FOR v_id IN
    SELECT mr.id
    FROM public.material_reservations mr
    WHERE mr.status = 'reserved'
      AND mr.expires_at IS NOT NULL
      AND mr.expires_at < now()
      AND (p_org_id IS NULL OR mr.org_id = p_org_id)
    ORDER BY mr.id
    FOR NO KEY UPDATE
  LOOP
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  -- Update the frozen, already-locked id set. Do not re-run the eligibility
  -- predicate here: the ordered locking pass is the authoritative snapshot for
  -- this call, and no other transaction can mutate a captured row before this
  -- update completes.
  UPDATE public.material_reservations
  SET status = 'expired',
      released_at = now(),
      quantity_released = quantity_reserved - quantity_consumed,
      updated_at = now()
  WHERE id = ANY(v_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
