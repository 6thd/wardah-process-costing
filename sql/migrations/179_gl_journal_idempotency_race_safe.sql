-- Migration 179 — race-safe generic GL journal idempotency (Issue #176)
--
-- Migration 76 already created the authoritative partial unique index:
--   uq_gl_entries_org_idem (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL
-- This migration does NOT replace that boundary. It adds request identity and makes
-- rpc_create_journal_entry handle the already-existing uniqueness race deterministically.
--
-- Historical keyed rows intentionally keep request_hash NULL. Their original JSON
-- payload cannot be reconstructed losslessly from normalized ledger rows, so 179
-- never invents/backfills a hash for them. Legacy replay is explicit in the RPC result.

BEGIN;

ALTER TABLE public.gl_entries
  ADD COLUMN IF NOT EXISTS request_hash text;

COMMENT ON COLUMN public.gl_entries.request_hash IS
  'SHA-256 of canonical jsonb request text for 179+ keyed journal creation. NULL on historical keyed rows by design.';

CREATE OR REPLACE FUNCTION public.rpc_create_journal_entry(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_org uuid;
    v_journal_id uuid;
    v_entry_id uuid;
    v_entry_number text;
    v_entry_date date;
    v_total_debit numeric := 0;
    v_total_credit numeric := 0;
    v_line_count integer := 0;
    v_idem text;
    v_hash text;
    v_auto_post boolean := COALESCE((p_payload ->> 'auto_post')::boolean, false);
    v_existing record;
    v_constraint text;
BEGIN
    -- Preserve the Migration 76 tenant contract.
    v_org := public.wardah_org_id(NULLIF(p_payload ->> 'org_id', '')::uuid);
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'TENANT_MISSING: تعذر تحديد هوية المؤسسة';
    END IF;

    v_entry_date := COALESCE(NULLIF(p_payload ->> 'entry_date', '')::date, CURRENT_DATE);
    PERFORM public.assert_period_open(v_org, v_entry_date);

    v_idem := NULLIF(p_payload ->> 'idempotency_key', '');
    IF v_idem IS NOT NULL THEN
        -- Match Migration 150's newer convention: canonical jsonb::text, SHA-256,
        -- with idempotency_key intentionally included in request identity.
        v_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');

        SELECT ge.id, ge.entry_number, ge.request_hash
          INTO v_existing
        FROM public.gl_entries ge
        WHERE ge.org_id = v_org
          AND ge.idempotency_key = v_idem
        LIMIT 1;

        IF FOUND THEN
            IF v_existing.request_hash IS NULL THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'entry_id', v_existing.id,
                    'entry_number', v_existing.entry_number,
                    'duplicate', true,
                    'payload_verified', false,
                    'legacy_replay', true
                );
            END IF;

            IF v_existing.request_hash IS DISTINCT FROM v_hash THEN
                RAISE EXCEPTION
                  'IDEMPOTENCY_KEY_CONFLICT: المفتاح استُخدم سابقًا مع حمولة مختلفة';
            END IF;

            RETURN jsonb_build_object(
                'success', true,
                'entry_id', v_existing.id,
                'entry_number', v_existing.entry_number,
                'duplicate', true,
                'payload_verified', true,
                'legacy_replay', false
            );
        END IF;
    END IF;

    SELECT COALESCE(SUM(COALESCE((l ->> 'debit')::numeric, 0)), 0),
           COALESCE(SUM(COALESCE((l ->> 'credit')::numeric, 0)), 0),
           COUNT(*)
    INTO v_total_debit, v_total_credit, v_line_count
    FROM jsonb_array_elements(p_payload -> 'lines') l;

    IF v_line_count < 2 THEN
        RAISE EXCEPTION 'EMPTY_ENTRY: القيد يحتاج سطرين على الأقل';
    END IF;
    IF round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
        RAISE EXCEPTION 'UNBALANCED_ENTRY: مدين=% دائن=%', v_total_debit, v_total_credit;
    END IF;
    IF round(v_total_debit, 2) = 0 THEN
        RAISE EXCEPTION 'ZERO_ENTRY: قيمة القيد صفر';
    END IF;

    v_journal_id := NULLIF(p_payload ->> 'journal_id', '')::uuid;
    IF v_journal_id IS NULL AND to_regclass('public.journals') IS NOT NULL THEN
        SELECT id INTO v_journal_id
        FROM public.journals
        WHERE org_id = v_org AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1;
    END IF;

    BEGIN
        v_entry_number := public.generate_entry_number(v_journal_id);
    EXCEPTION WHEN OTHERS THEN
        BEGIN
            v_entry_number := public.generate_entry_number(v_org, v_entry_date);
        EXCEPTION WHEN OTHERS THEN
            v_entry_number := 'JE-' || to_char(v_entry_date, 'YYYY') || '-' ||
                              lpad(floor(random() * 1000000)::text, 6, '0');
        END;
    END;

    INSERT INTO public.gl_entries (
        org_id, journal_id, entry_number, entry_date, entry_type,
        description, description_ar, reference_type, reference_number,
        status, total_debit, total_credit, idempotency_key, request_hash
    ) VALUES (
        v_org, v_journal_id, v_entry_number, v_entry_date, 'manual',
        NULLIF(p_payload ->> 'description', ''),
        NULLIF(p_payload ->> 'description_ar', ''),
        NULLIF(p_payload ->> 'reference_type', ''),
        NULLIF(p_payload ->> 'reference_number', ''),
        'draft', v_total_debit, v_total_credit, v_idem, v_hash
    )
    RETURNING id INTO v_entry_id;

    INSERT INTO public.gl_entry_lines (
        org_id, tenant_id, entry_id, line_number, account_id,
        debit, credit, currency_code, description, description_ar
    )
    SELECT
        v_org, v_org, v_entry_id,
        COALESCE((l.value ->> 'line_number')::int, l.ord::int),
        (l.value ->> 'account_id')::uuid,
        COALESCE((l.value ->> 'debit')::numeric, 0),
        COALESCE((l.value ->> 'credit')::numeric, 0),
        COALESCE(NULLIF(l.value ->> 'currency_code', ''), 'SAR'),
        NULLIF(l.value ->> 'description', ''),
        NULLIF(l.value ->> 'description_ar', '')
    FROM jsonb_array_elements(p_payload -> 'lines') WITH ORDINALITY AS l(value, ord);

    IF v_auto_post THEN
        UPDATE public.gl_entries
        SET status = 'posted', posted_at = NOW()
        WHERE id = v_entry_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'entry_id', v_entry_id,
        'entry_number', v_entry_number,
        'total_debit', v_total_debit,
        'total_credit', v_total_credit,
        'status', CASE WHEN v_auto_post THEN 'posted' ELSE 'draft' END,
        'duplicate', false,
        'payload_verified', (v_idem IS NOT NULL),
        'legacy_replay', false
    );

EXCEPTION
    WHEN unique_violation THEN
        -- gl_entries has more than one unique boundary. Only the Migration 76
        -- idempotency index is eligible for replay handling; all others keep the
        -- original PostgreSQL error unchanged.
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_idem IS NULL OR v_constraint IS DISTINCT FROM 'uq_gl_entries_org_idem' THEN
            RAISE;
        END IF;

        SELECT ge.id, ge.entry_number, ge.request_hash
          INTO v_existing
        FROM public.gl_entries ge
        WHERE ge.org_id = v_org
          AND ge.idempotency_key = v_idem
        LIMIT 1;

        IF NOT FOUND THEN
            RAISE;
        END IF;

        IF v_existing.request_hash IS NULL THEN
            -- Compatibility only for a historical keyed row. 179 never fills it.
            RETURN jsonb_build_object(
                'success', true,
                'entry_id', v_existing.id,
                'entry_number', v_existing.entry_number,
                'duplicate', true,
                'payload_verified', false,
                'legacy_replay', true
            );
        END IF;

        IF v_existing.request_hash IS DISTINCT FROM v_hash THEN
            RAISE EXCEPTION
              'IDEMPOTENCY_KEY_CONFLICT: المفتاح استُخدم سابقًا مع حمولة مختلفة';
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'entry_id', v_existing.id,
            'entry_number', v_existing.entry_number,
            'duplicate', true,
            'payload_verified', true,
            'legacy_replay', false
        );
END;
$function$;

-- 178 deliberately revoked browser execution of this generic primitive.
-- CREATE OR REPLACE preserves those existing ACLs; do not widen them here.

COMMIT;
