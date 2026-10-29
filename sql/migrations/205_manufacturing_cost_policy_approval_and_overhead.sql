-- 205: Manufacturing cost policy approval, pool activity and overhead budgets (stage 1 of #260).
--
-- Plan: docs/db/MIGRATION_205_OVERHEAD_PLAN.md revision 4 (fc11a3cb). Owner decisions: group A
-- (2026-10-28) and 205-Q1..Q4 (2026-10-29), with the two permission points confirmed on
-- 2026-10-29: a 205-only checker over role assignments, and "organization super admin" = the org
-- admin inside the company with the key assigned explicitly, never a platform override.
-- Reference arithmetic: docs/db/stage-costing-260/reference_calculator.py revision 4d
-- (rate_205, validate_205_version, check_unallocated_exception_205, unallocated_205,
-- approve_205_check, compute_205), mirrored here function for function. A rate has 204's precision
-- (numeric(18,6), at most 999999999) and an amount is rounded once, at the cent, as 204 does.
--
-- Additive beside 204. No table, row, function, trigger or grant of 204 (or of 174) changes. One
-- existing function outside 204 and 174 changes, in section 1b: create_role_from_template (M201
-- body) stops granting the three explicit keys through a wildcard template. Otherwise:
--   * a version is written to the 204 tables only when its draft is approved, in the approval
--     transaction, so the 204 pin triggers never see a draft;
--   * the 205 data of a version (pool activity, budgets, pool budgets, setup acknowledgements,
--     controlled exception) lives in side tables keyed by policy_version_id, written once;
--   * a 204 version without 205 data is "legacy": compute refuses it until a legacy resolution,
--     approved through the same draft/approval path, writes its 205 data beside it.
-- New objects only:
--   * four permission keys (manufacturing module, roles screen);
--   * wardah_internal tables: drafts, budgets, pool activity, pool budgets, setup acks,
--     approvals, unallocated exceptions, approval settings and their audit, legacy resolutions;
--   * internal functions: org lock, assigned-permission checker, settings, validator, exception
--     check, unallocated budgets, approval check, pure and stored compute, draft checks;
--   * public RPCs: create/update/withdraw/reject/approve draft, create legacy-resolution draft,
--     set self-approval, set unallocated policy, get, preview.
--
-- An approval names the draft revision the approver reviewed (rpc_get_mfg_cost_policy_205 shows
-- it); every edit of a draft moves its revision on, so content edited after it was shown is never
-- approved (COST_POLICY_DRAFT_REVISION_CONFLICT).
--
-- Not toggleable by any company setting: org isolation, the permission guards, one budget in one
-- pool, no duplicate or overlapping budget source, the rates, setup acknowledgement, the hours
-- rules, immutability after approval, and identities taken from the session (auth.uid()).
--
-- Cost centers: public.cost_centers is keyed by tenant_id with no foreign key to organizations
-- (its policy reads a session setting), so a center's organization cannot be proven. Per plan §3
-- no cost center is accepted (COST_POLICY_COST_CENTER_FOREIGN) and only the account-wide scope is
-- available until that relation is proven: the owner's "by cost center" choice (205-Q3) is NOT
-- implemented by 205. It needs a proven organization relation or an explicit link design first.
--
-- Transaction: runner-owned, as for 195-204. Apply with psql --single-transaction (or an
-- equivalent single-transaction runner); the file has no BEGIN/COMMIT.
SET LOCAL lock_timeout = '10s';

DO $preflight$
DECLARE
  v_mismatch text;
BEGIN
  IF to_regclass('wardah_internal.mfg_cost_policy_drafts_205') IS NOT NULL THEN
    RAISE EXCEPTION 'M205_ALREADY_APPLIED';
  END IF;
  IF to_regclass('wardah_internal.mfg_cost_policy_versions') IS NULL
     OR to_regprocedure('wardah_internal.mfg_cost_policy_compute_204(uuid,uuid,uuid,numeric,numeric,numeric)') IS NULL
     OR to_regprocedure('wardah_internal.manufacturing_settings_can_update_201(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.modules WHERE name = 'manufacturing') THEN
    RAISE EXCEPTION 'M205_REQUIRES_M204';
  END IF;
  IF EXISTS (SELECT 1 FROM public.permissions WHERE permission_key LIKE 'manufacturing.cost_policy.%') THEN
    RAISE EXCEPTION 'M205_PERMISSION_KEYS_PRESENT';
  END IF;
  -- 205 calls these; each must still be the body it was written against (md5 of pg_proc.prosrc,
  -- as in 201). A later CREATE OR REPLACE stops 205 here instead of being relied on unseen.
  SELECT string_agg(format('%s: md5 %s, expected %s', e.sig, COALESCE(md5(p.prosrc), 'missing'), e.body_md5),
                    '; ' ORDER BY e.sig)
  INTO v_mismatch
  FROM (VALUES
    -- M205_PREFLIGHT_PINS_BEGIN
    ('public.create_role_from_template(uuid,uuid,character varying,uuid)', 'd1d315bab6f854a846624d79006b6008'),
    ('public.has_permission(uuid,uuid,character varying)', 'ce46307ed6beccf1863f52b6bb9758e9'),
    ('public.wardah_assert_org_member(uuid)', '33c67e93cd2d49eb67dd84bf85721908'),
    ('public.wardah_is_org_admin(uuid)', '5f9184946d63312758ac000a338f8677'),
    ('public.wardah_is_sensitive_permission(text)', '4758317e1f5e21abce0f0a4f058c4088'),
    ('wardah_internal.manufacturing_settings_can_update_201(uuid)', '0d17b42a6d71efdfe9f1971dfd56a087'),
    ('wardah_internal.mfg_cost_policy_can_read_204(uuid)', 'd2270ac445f0da02e4f557fa2c320677'),
    ('wardah_internal.mfg_cost_policy_compute_204(uuid,uuid,uuid,numeric,numeric,numeric)', 'a8972b75b506ed4375d6d52ab01f425f'),
    ('wardah_internal.mfg_cost_policy_immutable_204()', 'a720e677fe4142de768222d3c4a46265'),
    ('wardah_internal.mfg_cost_policy_org_today_204(uuid,boolean)', '98e4efca1fcc2068753e001d0ce6fac1'),
    ('wardah_internal.mfg_cost_policy_version_at_204(uuid,date)', '055061fd13724b5ded7d7daaeebbaefc'),
    ('wardah_internal.mfg_cost_policy_version_json_204(uuid,date)', '5427e39967868f205f52d14bc1b6cd5a'),
    ('wardah_internal.pin_mo_cost_policy_204()', '4fff752bda4063d01bb6c51ebaeb85b8'),
    ('wardah_internal.pin_mo_cost_policy_on_start_204()', 'fa4d93af35974821a4ed48e838aac7c4')
    -- M205_PREFLIGHT_PINS_END
  ) AS e(sig, body_md5)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
  WHERE md5(p.prosrc) IS DISTINCT FROM e.body_md5;
  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'M205_UNEXPECTED_BODY: %', v_mismatch;
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Permission catalog (ordinary keys; not in wardah_is_sensitive_permission).
--    approve goes through has_permission like every manufacturing key. The other three are
--    "explicit": only mfg_cost_policy_has_assigned_205 grants them (an assigned role), never the
--    org-admin or platform override.
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions(module_id,resource,resource_ar,action,action_ar,
  permission_key,description,description_ar)
SELECT m.id,v.resource,v.resource_ar,v.action,v.action_ar,v.key,v.description,v.description_ar
FROM public.modules m CROSS JOIN (VALUES
  ('cost_policy','سياسة التكلفة','approve','اعتماد',
   'manufacturing.cost_policy.approve',
   'Approve a cost policy draft created by someone else, or a legacy-version resolution',
   'اعتماد مسودة سياسة تكلفة أنشأها غيرك، أو معالجة إصدار قديم'),
  ('cost_policy','سياسة التكلفة','self_approve','اعتماد ذاتي',
   'manufacturing.cost_policy.self_approve',
   'Approve your own cost policy draft, only when the company enables self-approval (needs approve as well)',
   'اعتماد مسودة أنشأتها بنفسك، فقط إذا فعّلت الشركة الاعتماد الذاتي (تحتاج صلاحية الاعتماد معها)'),
  ('cost_policy','سياسة التكلفة','approval_settings.manage','إدارة إعدادات الاعتماد',
   'manufacturing.cost_policy.approval_settings.manage',
   'Turn cost policy self-approval on or off for the company (with a reason; audited)',
   'تفعيل الاعتماد الذاتي لسياسة التكلفة أو إيقافه للشركة (بسبب، ومدقق)'),
  ('cost_policy','سياسة التكلفة','unallocated_policy.manage','إدارة سياسة الموازنة غير الموزعة',
   'manufacturing.cost_policy.unallocated_policy.manage',
   'Org admin only: choose block or controlled exception for selected budgets no pool loads (with a reason; audited)',
   'لمدير المؤسسة وحده: اختيار المنع أو الاستثناء المضبوط للموازنات المختارة التي لا يحمّلها مجمع (بسبب، ومدقق)')
) v(resource,resource_ar,action,action_ar,key,description,description_ar)
WHERE m.name = 'manufacturing';

-- ---------------------------------------------------------------------------
-- 1b. Template expansion: a wildcard template ('manufacturing.%') must not grant the three
--     explicit keys; a template that names a key exactly still grants it. As M196, M199 and M201
--     did, the three keys join the exact-name-only list of create_role_from_template. The body is
--     the M201 body (pinned in the preflight) with exactly two edits, made here on the pinned
--     text rather than retyped: the three keys added after manufacturing.settings.update, and the
--     comment line that names the migrations narrowing the expansion. Owner, ACL, SECURITY
--     DEFINER and search_path are those of the existing function (CREATE OR REPLACE from its own
--     pg_get_functiondef). has_permission and the other 174 functions are not touched.
-- ---------------------------------------------------------------------------
DO $template$
DECLARE
  c_sig CONSTANT text := 'public.create_role_from_template(uuid,uuid,character varying,uuid)';
  c_list_old CONSTANT text := E'''manufacturing.settings.update'')';
  c_list_new CONSTANT text := E'''manufacturing.settings.update'',\n                 ''manufacturing.cost_policy.self_approve'',\n                 ''manufacturing.cost_policy.approval_settings.manage'',\n                 ''manufacturing.cost_policy.unallocated_policy.manage'')';
  c_note_old CONSTANT text := E'-- Preserve the M175 audit record; M196, M199 and M201 only narrow template\n    -- expansion above.';
  c_note_new CONSTANT text := E'-- Preserve the M175 audit record; M196, M199, M201 and M205 only narrow\n    -- template expansion above.';
  v_src text;
  v_new text;
  v_def text;
BEGIN
  SELECT prosrc, pg_get_functiondef(oid) INTO v_src, v_def FROM pg_proc WHERE oid = to_regprocedure(c_sig);
  IF (length(v_src) - length(replace(v_src, c_list_old, ''))) / length(c_list_old) <> 1
     OR (length(v_src) - length(replace(v_src, c_note_old, ''))) / length(c_note_old) <> 1
     OR (length(v_def) - length(replace(v_def, v_src, ''))) / length(v_src) <> 1 THEN
    RAISE EXCEPTION 'M205_TEMPLATE_BODY_UNEXPECTED';
  END IF;
  v_new := replace(replace(v_src, c_list_old, c_list_new), c_note_old, c_note_new);
  EXECUTE replace(v_def, v_src, v_new);
  IF (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure(c_sig)) IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'M205_TEMPLATE_BODY_NOT_WRITTEN';
  END IF;
END
$template$;

-- ---------------------------------------------------------------------------
-- 2. Storage. Private schema, no client privileges; the RPCs are the only path.
-- ---------------------------------------------------------------------------

-- A draft: the proposed version (kind 'version') or a legacy-version resolution (kind
-- 'legacy_resolution'). Edited only while pending; status moves one way.
CREATE TABLE wardah_internal.mfg_cost_policy_drafts_205 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('version','legacy_resolution')),
  legacy_version_id uuid,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash text NOT NULL,
  expected_latest_version_no integer CHECK (expected_latest_version_no IS NULL OR expected_latest_version_no >= 0),
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','withdrawn')),
  -- 1 at creation; every edit of the content moves it on by one (guard trigger). An approval names
  -- the revision the approver reviewed.
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  idempotency_key uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  result_version_id uuid,
  UNIQUE (org_id, idempotency_key),
  UNIQUE (id, org_id),
  CONSTRAINT mfg_cost_policy_draft_kind_shape_205 CHECK (
    (kind = 'version' AND legacy_version_id IS NULL AND expected_latest_version_no IS NOT NULL)
    OR (kind = 'legacy_resolution' AND legacy_version_id IS NOT NULL AND expected_latest_version_no IS NULL
        AND reason IS NOT NULL)),
  CONSTRAINT mfg_cost_policy_draft_decision_205 CHECK (
    (status = 'draft' AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL
       AND result_version_id IS NULL)
    OR (status = 'approved' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND result_version_id IS NOT NULL)
    OR (status IN ('rejected','withdrawn') AND decided_by IS NOT NULL AND decided_at IS NOT NULL
        AND decision_reason IS NOT NULL AND result_version_id IS NULL)),
  FOREIGN KEY (legacy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (result_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE
);
CREATE INDEX mfg_cost_policy_drafts_205_org_status ON wardah_internal.mfg_cost_policy_drafts_205 (org_id, status);

-- The budgets a version selects for loading (205-Q3: account required, cost center optional;
-- none = the account-wide scope).
CREATE TABLE wardah_internal.mfg_cost_policy_budgets_205 (
  policy_version_id uuid NOT NULL,
  org_id uuid NOT NULL,
  budget_code text NOT NULL CHECK (budget_code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE RESTRICT,
  setup_related boolean NOT NULL,
  amount numeric(18,2) CHECK (amount IS NULL OR amount >= 0),
  planned_hours numeric(18,6) CHECK (planned_hours IS NULL OR planned_hours >= 0),
  PRIMARY KEY (policy_version_id, budget_code),
  FOREIGN KEY (policy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE
);
-- NULL is not equal to NULL in an ordinary unique constraint, so the account-wide scope gets its
-- own partial index: one source per version, with or without a center.
CREATE UNIQUE INDEX mfg_cost_policy_budgets_205_account_scope
  ON wardah_internal.mfg_cost_policy_budgets_205 (policy_version_id, gl_account_id)
  WHERE cost_center_id IS NULL;
CREATE UNIQUE INDEX mfg_cost_policy_budgets_205_center_scope
  ON wardah_internal.mfg_cost_policy_budgets_205 (policy_version_id, gl_account_id, cost_center_id)
  WHERE cost_center_id IS NOT NULL;

CREATE TABLE wardah_internal.mfg_cost_policy_pool_ext_205 (
  policy_version_id uuid NOT NULL,
  org_id uuid NOT NULL,
  pool_code text NOT NULL,
  activity text NOT NULL CHECK (activity IN ('run','setup','both')),
  PRIMARY KEY (policy_version_id, pool_code),
  FOREIGN KEY (policy_version_id, pool_code)
    REFERENCES wardah_internal.mfg_cost_policy_pools(policy_version_id, pool_code) ON DELETE CASCADE,
  FOREIGN KEY (policy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE
);

-- One budget in one pool: the primary key is (version, budget).
CREATE TABLE wardah_internal.mfg_cost_policy_pool_budgets_205 (
  policy_version_id uuid NOT NULL,
  org_id uuid NOT NULL,
  pool_code text NOT NULL,
  budget_code text NOT NULL,
  PRIMARY KEY (policy_version_id, budget_code),
  UNIQUE (policy_version_id, pool_code, budget_code),
  FOREIGN KEY (policy_version_id, pool_code)
    REFERENCES wardah_internal.mfg_cost_policy_pool_ext_205(policy_version_id, pool_code) ON DELETE CASCADE,
  FOREIGN KEY (policy_version_id, budget_code)
    REFERENCES wardah_internal.mfg_cost_policy_budgets_205(policy_version_id, budget_code) ON DELETE CASCADE,
  FOREIGN KEY (policy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE
);

-- A scoped acknowledgement names a budget of the pool itself.
CREATE TABLE wardah_internal.mfg_cost_policy_setup_acks_205 (
  policy_version_id uuid NOT NULL,
  org_id uuid NOT NULL,
  pool_code text NOT NULL,
  budget_code text NOT NULL,
  PRIMARY KEY (policy_version_id, pool_code, budget_code),
  FOREIGN KEY (policy_version_id, pool_code, budget_code)
    REFERENCES wardah_internal.mfg_cost_policy_pool_budgets_205(policy_version_id, pool_code, budget_code) ON DELETE CASCADE,
  FOREIGN KEY (policy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE
);

-- 205-Q4 controlled exception, recorded with the approved version. The excepted budgets are the
-- version's budgets no pool loads; their amounts are in budgets_205 and copied here as shown.
CREATE TABLE wardah_internal.mfg_cost_policy_unallocated_exceptions_205 (
  policy_version_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  budgets jsonb NOT NULL CHECK (jsonb_typeof(budgets) = 'object' AND budgets <> '{}'::jsonb),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  treatment text NOT NULL CHECK (length(btrim(treatment)) BETWEEN 1 AND 500),
  approved_by uuid NOT NULL,
  policy_at_approval text NOT NULL CHECK (policy_at_approval = 'controlled_exception'),
  approved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (policy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (draft_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_drafts_205(id, org_id) ON DELETE CASCADE
);

-- The approval of each version written through 205 (a new version or a legacy resolution).
CREATE TABLE wardah_internal.mfg_cost_policy_approvals_205 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  draft_id uuid NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('version','legacy_resolution')),
  policy_version_id uuid NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  draft_revision integer NOT NULL CHECK (draft_revision >= 1),
  self_approved boolean NOT NULL,
  self_approval_enabled_at_approval boolean NOT NULL,
  unallocated_policy_at_approval text NOT NULL
    CHECK (unallocated_policy_at_approval IN ('block','controlled_exception')),
  CHECK (self_approved = (created_by = approved_by)),
  CHECK (NOT self_approved OR self_approval_enabled_at_approval),
  FOREIGN KEY (policy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (draft_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_drafts_205(id, org_id) ON DELETE CASCADE
);

CREATE TABLE wardah_internal.mfg_cost_policy_legacy_resolutions_205 (
  policy_version_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  draft_id uuid NOT NULL UNIQUE,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_by uuid NOT NULL,
  approved_by uuid NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (policy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (draft_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_drafts_205(id, org_id) ON DELETE CASCADE
);

-- Company settings (205-Q1, 205-Q4). No row = the defaults: no self-approval, 'block'.
CREATE TABLE wardah_internal.mfg_cost_policy_approval_settings_205 (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  self_approval_enabled boolean NOT NULL DEFAULT false,
  unallocated_budget_policy text NOT NULL DEFAULT 'block'
    CHECK (unallocated_budget_policy IN ('block','controlled_exception')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL
);

CREATE TABLE wardah_internal.mfg_cost_policy_approval_settings_audit_205 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  setting text NOT NULL CHECK (setting IN ('self_approval_enabled','unallocated_budget_policy')),
  old_value text NOT NULL,
  new_value text NOT NULL,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CHECK (old_value <> new_value)
);
CREATE INDEX mfg_cost_policy_settings_audit_205_org ON wardah_internal.mfg_cost_policy_approval_settings_audit_205 (org_id, id);

REVOKE ALL ON wardah_internal.mfg_cost_policy_drafts_205,
              wardah_internal.mfg_cost_policy_budgets_205,
              wardah_internal.mfg_cost_policy_pool_ext_205,
              wardah_internal.mfg_cost_policy_pool_budgets_205,
              wardah_internal.mfg_cost_policy_setup_acks_205,
              wardah_internal.mfg_cost_policy_unallocated_exceptions_205,
              wardah_internal.mfg_cost_policy_approvals_205,
              wardah_internal.mfg_cost_policy_legacy_resolutions_205,
              wardah_internal.mfg_cost_policy_approval_settings_205,
              wardah_internal.mfg_cost_policy_approval_settings_audit_205
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE wardah_internal.mfg_cost_policy_drafts_205 IS
  'Migration 205: cost policy drafts (new versions and legacy resolutions); a version reaches the 204 tables only on approval. See docs/db/MIGRATION_205_OVERHEAD_PLAN.md.';
COMMENT ON TABLE wardah_internal.mfg_cost_policy_approval_settings_205 IS
  'Migration 205: per-org approval settings (205-Q1 self-approval, off by default; 205-Q4 unallocated budget policy, block by default). Changed only by the two settings RPCs, each audited.';

-- ---------------------------------------------------------------------------
-- 3. Immutability. Side tables, approvals, exceptions, resolutions and the settings audit are
--    append-only: the 204 immutability function (unchanged) refuses UPDATE and any DELETE that is
--    not the cascade of a parent already gone. 205 data of a version is written once: after the
--    version's approval row exists, no side row can be added.
-- ---------------------------------------------------------------------------
CREATE TRIGGER mfg_cost_policy_budgets_205_immutable
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_budgets_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mfg_cost_policy_pool_ext_205_immutable
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_pool_ext_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mfg_cost_policy_pool_budgets_205_immutable
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_pool_budgets_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mfg_cost_policy_setup_acks_205_immutable
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_setup_acks_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mfg_cost_policy_unallocated_exceptions_205_immutable
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_unallocated_exceptions_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mfg_cost_policy_approvals_205_immutable
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_approvals_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mfg_cost_policy_legacy_resolutions_205_immutable
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_legacy_resolutions_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mfg_cost_policy_settings_audit_205_immutable
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_approval_settings_audit_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();

CREATE FUNCTION wardah_internal.mfg_cost_policy_side_insert_205()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approvals_205
             WHERE policy_version_id = NEW.policy_version_id) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'COST_POLICY_IMMUTABLE';
  END IF;
  IF TG_TABLE_NAME = 'mfg_cost_policy_budgets_205' THEN
    -- 205-Q3: the account belongs to the version's organization; a cost center cannot be proven
    -- to (cost_centers has tenant_id, no relation to organizations), so none is accepted.
    IF NOT EXISTS (SELECT 1 FROM public.gl_accounts WHERE id = NEW.gl_account_id AND org_id = NEW.org_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'COST_POLICY_GL_ACCOUNT_FOREIGN';
    END IF;
    IF NEW.cost_center_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'COST_POLICY_COST_CENTER_FOREIGN';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_side_insert_205()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER mfg_cost_policy_budgets_205_insert
BEFORE INSERT ON wardah_internal.mfg_cost_policy_budgets_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_side_insert_205();
CREATE TRIGGER mfg_cost_policy_pool_ext_205_insert
BEFORE INSERT ON wardah_internal.mfg_cost_policy_pool_ext_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_side_insert_205();
CREATE TRIGGER mfg_cost_policy_pool_budgets_205_insert
BEFORE INSERT ON wardah_internal.mfg_cost_policy_pool_budgets_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_side_insert_205();
CREATE TRIGGER mfg_cost_policy_setup_acks_205_insert
BEFORE INSERT ON wardah_internal.mfg_cost_policy_setup_acks_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_side_insert_205();
CREATE TRIGGER mfg_cost_policy_unallocated_exceptions_205_insert
BEFORE INSERT ON wardah_internal.mfg_cost_policy_unallocated_exceptions_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_side_insert_205();

-- Drafts: identity, kind and key never change; the payload changes only while pending, and every
-- change of the content moves the revision on by exactly one (the revision changes with nothing
-- else); the status moves once, from draft to approved, rejected or withdrawn.
CREATE FUNCTION wardah_internal.mfg_cost_policy_draft_guard_205()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_content_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.org_id)
       OR (OLD.legacy_version_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM wardah_internal.mfg_cost_policy_versions WHERE id = OLD.legacy_version_id))
       OR (OLD.result_version_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM wardah_internal.mfg_cost_policy_versions WHERE id = OLD.result_version_id)) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'COST_POLICY_DRAFT_IMMUTABLE';
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'COST_POLICY_DRAFT_NOT_PENDING';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.legacy_version_id IS DISTINCT FROM OLD.legacy_version_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'COST_POLICY_DRAFT_IMMUTABLE';
  END IF;
  IF NEW.status <> 'draft' AND (NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.expected_latest_version_no IS DISTINCT FROM OLD.expected_latest_version_no
       OR NEW.reason IS DISTINCT FROM OLD.reason) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'COST_POLICY_DRAFT_IMMUTABLE';
  END IF;
  v_content_changed := NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
                       OR NEW.expected_latest_version_no IS DISTINCT FROM OLD.expected_latest_version_no
                       OR NEW.reason IS DISTINCT FROM OLD.reason;
  IF NEW.revision IS DISTINCT FROM OLD.revision + v_content_changed::int THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'COST_POLICY_DRAFT_REVISION_INVALID';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_draft_guard_205()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER mfg_cost_policy_drafts_205_guard
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_drafts_205
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_draft_guard_205();

-- ---------------------------------------------------------------------------
-- 4. Internal helpers (no client EXECUTE).
-- ---------------------------------------------------------------------------

-- One transaction lock per organization for every 205 path that reads or writes the approval
-- settings or writes a version: approvals (new versions and legacy resolutions) and both setting
-- changes, including the first creation of the settings row. FOR SHARE on that row could not
-- lock a row that does not exist yet. Released at the end of the transaction.
CREATE FUNCTION wardah_internal.mfg_cost_policy_lock_org_205(p_org uuid)
RETURNS void LANGUAGE sql VOLATILE SET search_path = ''
AS $fn$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wardah.mfg_cost_policy_205:' || p_org::text, 205));
$fn$;

-- Explicit permission (205-Q1, 205-Q4): held only through an assigned role. The identity is the
-- session's (auth.uid()); there is no user parameter. Same assignment conditions as has_permission
-- (active membership, the role's own org, active role, unexpired assignment), with neither the
-- org-admin override nor the platform super-admin override. The 174 functions are not changed.
CREATE FUNCTION wardah_internal.mfg_cost_policy_has_assigned_205(p_org uuid, p_key text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.user_organizations uo
      ON uo.user_id = ur.user_id AND uo.org_id = ur.org_id AND uo.is_active IS TRUE
    JOIN public.roles r
      ON r.id = ur.role_id AND r.org_id = p_org AND COALESCE(r.is_active, true)
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND ur.org_id = p_org
      AND p.permission_key = p_key
      AND (ur.expires_at IS NULL OR ur.expires_at > now()));
$fn$;

CREATE FUNCTION wardah_internal.mfg_cost_policy_settings_205(p_org uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'self_approval_enabled', COALESCE((SELECT s.self_approval_enabled
      FROM wardah_internal.mfg_cost_policy_approval_settings_205 s WHERE s.org_id = p_org), false),
    'unallocated_budget_policy', COALESCE((SELECT s.unallocated_budget_policy
      FROM wardah_internal.mfg_cost_policy_approval_settings_205 s WHERE s.org_id = p_org), 'block'));
$fn$;

-- number_205: an input amount as an exact numeric. Not a number (JSON number or numeric string),
-- NaN, an infinity, negative, or (p_positive) zero is refused with the given code.
CREATE FUNCTION wardah_internal.mfg_cost_policy_num_205(p_x jsonb, p_code text, p_positive boolean)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_n numeric;
BEGIN
  IF p_x IS NULL OR jsonb_typeof(p_x) NOT IN ('number','string') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = p_code;
  END IF;
  BEGIN
    v_n := (p_x #>> '{}')::numeric;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = p_code;
  END;
  IF v_n = 'NaN'::numeric OR v_n = 'Infinity'::numeric OR v_n = '-Infinity'::numeric
     OR v_n < 0 OR (p_positive AND v_n = 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = p_code;
  END IF;
  RETURN v_n;
END
$fn$;

-- rate_205: a rate as 204 stores and accepts it (numeric(18,6), 204's C_MAX_RATE): positive, at
-- most six decimal places (scale(), trailing zeros included), at most 999999999.
CREATE FUNCTION wardah_internal.mfg_cost_policy_rate_205(p_x jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_n numeric := wardah_internal.mfg_cost_policy_num_205(p_x, 'COST_POLICY_RATE_INVALID', true);
BEGIN
  IF pg_catalog.scale(v_n) > 6 OR v_n > 999999999 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_RATE_INVALID';
  END IF;
  RETURN v_n;
END
$fn$;

-- check_unallocated_exception_205. p_budgets: [{code, gl_account, cost_center, setup, amount}] in
-- order; p_owner: {budget code: pool} for every loaded budget.
CREATE FUNCTION wardah_internal.mfg_cost_policy_check_exception_205(p_exc jsonb, p_budgets jsonb, p_owner jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  c_bad CONSTANT text := 'COST_POLICY_UNALLOCATED_EXCEPTION_INVALID';
  v_listed text[];
  v_unowned text[];
  v_k text;
  v_c text;
  v_amount jsonb;
  v_n numeric;
BEGIN
  IF jsonb_typeof(p_exc) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_exc) k)
        IS DISTINCT FROM ARRAY['approved_by','budgets','policy','reason','treatment'] THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = c_bad || ': fields';
  END IF;
  IF p_exc->'policy' IS DISTINCT FROM to_jsonb('controlled_exception'::text) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = c_bad || ': policy';
  END IF;
  IF jsonb_typeof(p_exc->'budgets') = 'array' THEN
    SELECT COALESCE(array_agg(e #>> '{}' ORDER BY o), '{}') INTO v_listed
    FROM jsonb_array_elements(p_exc->'budgets') WITH ORDINALITY t(e, o);
  ELSIF jsonb_typeof(p_exc->'budgets') = 'null' THEN
    v_listed := '{}';
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = c_bad || ': budgets';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT b->>'code'), '{}') INTO v_unowned
  FROM jsonb_array_elements(p_budgets) b WHERE NOT (p_owner ? (b->>'code'));
  IF cardinality(v_listed) = 0
     OR cardinality(v_listed) <> (SELECT count(DISTINCT x) FROM unnest(v_listed) x)
     OR array_position(v_listed, NULL) IS NOT NULL
     OR NOT (v_listed @> v_unowned AND v_unowned @> v_listed) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = c_bad || ': budgets';
  END IF;
  FOREACH v_k IN ARRAY ARRAY['reason','treatment','approved_by'] LOOP
    IF jsonb_typeof(p_exc->v_k) IS DISTINCT FROM 'string' OR (p_exc->>v_k) ~ '^\s*$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = c_bad || ': ' || v_k;
    END IF;
  END LOOP;
  FOREACH v_c IN ARRAY v_listed LOOP
    SELECT b->'amount' INTO v_amount FROM jsonb_array_elements(p_budgets) b WHERE b->>'code' = v_c LIMIT 1;
    IF v_amount IS NULL OR v_amount = 'null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = c_bad || ': amount ' || v_c;
    END IF;
    v_n := wardah_internal.mfg_cost_policy_num_205(v_amount, c_bad || ': amount ' || v_c, false);
    IF v_n * 100 <> trunc(v_n * 100) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = c_bad || ': amount ' || v_c;
    END IF;
  END LOOP;
END
$fn$;

-- validate_205_version. p_v is the calculator's version in JSON, with budgets and setup_acks as
-- ordered arrays (the calculator iterates its dicts in insertion order):
--   {labor_cost_source, default_labor_rate, pools: [{code, basis, rate, activity, budgets}],
--    budgets: [{code, gl_account, cost_center, setup, amount}], setup_acks: [{pool, budgets}],
--    wc_rules: {wc: {labor_rate?, pools: {code: {applies?, rate?}}}}, unallocated_exception?}
-- Rules and refusal order are validate_205_version's, line for line.
CREATE FUNCTION wardah_internal.mfg_cost_policy_validate_205(p_v jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_pools jsonb := COALESCE(NULLIF(p_v->'pools', 'null'::jsonb), '[]'::jsonb);
  v_budgets jsonb := COALESCE(NULLIF(p_v->'budgets', 'null'::jsonb), '[]'::jsonb);
  v_acks jsonb := COALESCE(NULLIF(p_v->'setup_acks', 'null'::jsonb), '[]'::jsonb);
  v_exc jsonb := NULLIF(p_v->'unallocated_exception', 'null'::jsonb);
  v_p jsonb;
  v_r jsonb;
  v_pr jsonb;
  v_b jsonb;
  v_a jsonb;
  v_pool jsonb;
  v_code text;
  v_codes text[];
  v_seen jsonb := '[]'::jsonb;
  v_map jsonb := '{}'::jsonb;
  v_owner jsonb := '{}'::jsonb;
  v_excepted text[] := '{}';
BEGIN
  SELECT COALESCE(array_agg(e->>'code' ORDER BY o), '{}') INTO v_codes
  FROM jsonb_array_elements(v_pools) WITH ORDINALITY t(e, o);
  IF cardinality(v_codes) <> (SELECT count(DISTINCT x) FROM unnest(v_codes) x) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_POOL_CODE_DUPLICATE';
  END IF;
  IF p_v->>'labor_cost_source' = 'work_center_rate' THEN
    PERFORM wardah_internal.mfg_cost_policy_rate_205(p_v->'default_labor_rate');
  END IF;
  FOR v_p IN SELECT e FROM jsonb_array_elements(v_pools) WITH ORDINALITY t(e, o) ORDER BY o LOOP
    PERFORM wardah_internal.mfg_cost_policy_rate_205(v_p->'rate');
  END LOOP;
  FOR v_r IN SELECT value FROM jsonb_each(COALESCE(NULLIF(p_v->'wc_rules', 'null'::jsonb), '{}'::jsonb)) LOOP
    IF v_r ? 'labor_rate' THEN
      PERFORM wardah_internal.mfg_cost_policy_rate_205(v_r->'labor_rate');
    END IF;
    FOR v_pr IN SELECT value FROM jsonb_each(COALESCE(NULLIF(v_r->'pools', 'null'::jsonb), '{}'::jsonb)) LOOP
      IF v_pr ? 'rate' THEN
        PERFORM wardah_internal.mfg_cost_policy_rate_205(v_pr->'rate');
      END IF;
    END LOOP;
  END LOOP;

  -- Sources: account required (205-Q3); one code per (account, center); no account-wide scope
  -- beside the same account with a center.
  FOR v_b IN SELECT e FROM jsonb_array_elements(v_budgets) WITH ORDINALITY t(e, o) ORDER BY o LOOP
    v_code := v_b->>'code';
    IF COALESCE(v_b->>'gl_account', '') = '' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_BUDGET_ACCOUNT_REQUIRED: ' || COALESCE(v_code, '');
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_seen) s
               WHERE s->>'gl' = v_b->>'gl_account' AND (s->>'cc') IS NOT DISTINCT FROM (v_b->>'cost_center')) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_BUDGET_DUPLICATE_SOURCE';
    END IF;
    v_seen := v_seen || jsonb_build_array(jsonb_build_object('gl', v_b->>'gl_account', 'cc', v_b->>'cost_center'));
    v_map := v_map || jsonb_build_object(v_code, v_b);
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_seen) a JOIN jsonb_array_elements(v_seen) b ON a->>'gl' = b->>'gl'
             WHERE a->>'cc' IS NULL AND b->>'cc' IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_BUDGET_SOURCE_OVERLAP';
  END IF;

  FOR v_p IN SELECT e FROM jsonb_array_elements(v_pools) WITH ORDINALITY t(e, o) ORDER BY o LOOP
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_p) k WHERE k NOT IN ('code','basis','rate','activity','budgets'))
       OR jsonb_typeof(v_p->'activity') IS DISTINCT FROM 'string'
       OR (v_p->>'activity') NOT IN ('run','setup','both') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_POOL_ACTIVITY_UNSET';
    END IF;
    IF jsonb_typeof(v_p->'budgets') IS DISTINCT FROM 'array' OR jsonb_array_length(v_p->'budgets') = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_POOL_WITHOUT_BUDGET';
    END IF;
    FOR v_code IN SELECT e #>> '{}' FROM jsonb_array_elements(v_p->'budgets') WITH ORDINALITY t(e, o) ORDER BY o LOOP
      IF v_code IS NULL OR NOT (v_map ? v_code) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_BUDGET_UNKNOWN';
      END IF;
      IF v_owner ? v_code THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_BUDGET_DOUBLE_ALLOCATION';
      END IF;
      v_owner := v_owner || jsonb_build_object(v_code, v_p);
    END LOOP;
  END LOOP;

  FOR v_a IN SELECT e FROM jsonb_array_elements(v_acks) WITH ORDINALITY t(e, o) ORDER BY o LOOP
    SELECT e INTO v_pool FROM jsonb_array_elements(v_pools) WITH ORDINALITY t(e, o)
    WHERE e->>'code' = v_a->>'pool' ORDER BY o LIMIT 1;
    IF NOT FOUND THEN
      v_pool := NULL;
    END IF;
    FOR v_code IN SELECT e #>> '{}' FROM jsonb_array_elements(COALESCE(NULLIF(v_a->'budgets', 'null'::jsonb), '[]'::jsonb)) e LOOP
      IF v_pool IS NULL OR v_code IS NULL OR v_pool->>'activity' IS DISTINCT FROM 'run'
         OR NOT (v_pool->'budgets' @> to_jsonb(v_code))
         OR NOT COALESCE((v_map->v_code->>'setup')::boolean, false) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_SETUP_ACK_INVALID';
      END IF;
    END LOOP;
  END LOOP;

  IF jsonb_typeof(v_exc) = 'object' AND jsonb_typeof(v_exc->'budgets') = 'array' THEN
    SELECT COALESCE(array_agg(e #>> '{}'), '{}') INTO v_excepted FROM jsonb_array_elements(v_exc->'budgets') e;
  END IF;
  FOR v_b IN SELECT e FROM jsonb_array_elements(v_budgets) WITH ORDINALITY t(e, o) ORDER BY o LOOP
    v_code := v_b->>'code';
    IF NOT (v_owner ? v_code) THEN
      IF v_code = ANY (v_excepted) THEN
        CONTINUE;
      END IF;
      IF COALESCE((v_b->>'setup')::boolean, false) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_SETUP_TREATMENT_UNSET';
      END IF;
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_BUDGET_UNALLOCATED';
    END IF;
    IF COALESCE((v_b->>'setup')::boolean, false) AND v_owner->v_code->>'activity' = 'run'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_acks) a, jsonb_array_elements(
                         COALESCE(NULLIF(a->'budgets', 'null'::jsonb), '[]'::jsonb)) x
                       WHERE a->>'pool' = v_owner->v_code->>'code' AND x #>> '{}' = v_code) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_SETUP_TREATMENT_UNSET';
    END IF;
  END LOOP;
  IF v_exc IS NOT NULL THEN
    PERFORM wardah_internal.mfg_cost_policy_check_exception_205(v_exc, v_budgets, v_owner);
  END IF;
END
$fn$;

-- unallocated_205: {budget code: amount in cents} of the selected budgets no pool loads (shown
-- at approval and in the preview, never absorbed). Call after validation.
CREATE FUNCTION wardah_internal.mfg_cost_policy_unallocated_205(p_v jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT COALESCE(jsonb_object_agg(b->>'code', ((b->>'amount')::numeric * 100)::bigint), '{}'::jsonb)
  FROM jsonb_array_elements(COALESCE(NULLIF(p_v->'budgets', 'null'::jsonb), '[]'::jsonb)) b
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NULLIF(p_v->'pools', 'null'::jsonb), '[]'::jsonb)) p,
                                  jsonb_array_elements(COALESCE(NULLIF(p->'budgets', 'null'::jsonb), '[]'::jsonb)) x
                    WHERE x #>> '{}' = b->>'code');
$fn$;

-- approve_205_check: the company policy at approval, then every version rule.
CREATE FUNCTION wardah_internal.mfg_cost_policy_approve_check_205(p_v jsonb, p_policy text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_exc jsonb := NULLIF(p_v->'unallocated_exception', 'null'::jsonb);
BEGIN
  IF p_policy IS NULL OR p_policy NOT IN ('block','controlled_exception') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_UNALLOCATED_POLICY_INVALID';
  END IF;
  IF v_exc IS NOT NULL AND p_policy <> 'controlled_exception' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_UNALLOCATED_EXCEPTION_NOT_ALLOWED';
  END IF;
  PERFORM wardah_internal.mfg_cost_policy_validate_205(p_v);
  RETURN jsonb_build_object('unallocated', wardah_internal.mfg_cost_policy_unallocated_205(p_v),
                            'exception', v_exc IS NOT NULL);
END
$fn$;

-- compute_205 on a version in the calculator's JSON form. p_hours = {labor: {run, setup},
-- machine: {run, setup}}; p_legacy = a resolution for a version without 205 data, as the
-- calculator's legacy_resolution ({pools: {code: {activity, budgets}}, budgets, setup_acks,
-- unallocated_exception?}). Returns cents: {labor, pools: {code: cents}, total}.
CREATE FUNCTION wardah_internal.mfg_cost_policy_compute_205_v(
  p_v jsonb, p_wc text, p_hours jsonb, p_recorded jsonb, p_legacy jsonb
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v jsonb;
  v_legacy jsonb := NULLIF(p_legacy, 'null'::jsonb);
  v_pools jsonb := COALESCE(NULLIF(p_v->'pools', 'null'::jsonb), '[]'::jsonb);
  v_codes text[];
  v_rule jsonb;
  v_applying jsonb;
  v_needed text[] := '{}';
  v_h jsonb := '{}'::jsonb;
  v_need text;
  v_x jsonb;
  v_p jsonb;
  v_pr jsonb;
  v_res text;
  v_rate jsonb;
  v_driver numeric;
  v_labor numeric;
  v_n numeric;
  v_out jsonb := '{}'::jsonb;
  v_total numeric := 0;
BEGIN
  IF (p_v ? 'budgets') AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_pools) e WHERE NOT (e ? 'activity')) THEN
    IF v_legacy IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_LEGACY_NOT_APPLICABLE';
    END IF;
    v := p_v;
  ELSE
    IF v_legacy IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_LEGACY_UNRESOLVED';
    END IF;
    SELECT COALESCE(array_agg(e->>'code' ORDER BY o), '{}') INTO v_codes
    FROM jsonb_array_elements(v_pools) WITH ORDINALITY t(e, o);
    IF cardinality(v_codes) <> (SELECT count(DISTINCT x) FROM unnest(v_codes) x) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_POOL_CODE_DUPLICATE';
    END IF;
    IF NOT (v_codes @> ARRAY(SELECT jsonb_object_keys(COALESCE(v_legacy->'pools', '{}'::jsonb)))
            AND ARRAY(SELECT jsonb_object_keys(COALESCE(v_legacy->'pools', '{}'::jsonb))) @> v_codes) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_LEGACY_POOLS_MISMATCH';
    END IF;
    v := p_v || jsonb_build_object(
      'pools', (SELECT COALESCE(jsonb_agg(e || jsonb_build_object(
                         'activity', v_legacy->'pools'->(e->>'code')->'activity',
                         'budgets', v_legacy->'pools'->(e->>'code')->'budgets') ORDER BY o), '[]'::jsonb)
                FROM jsonb_array_elements(v_pools) WITH ORDINALITY t(e, o)),
      'budgets', v_legacy->'budgets',
      'setup_acks', COALESCE(v_legacy->'setup_acks', '[]'::jsonb));
    IF v_legacy ? 'unallocated_exception' THEN
      v := v || jsonb_build_object('unallocated_exception', v_legacy->'unallocated_exception');
    END IF;
    v_pools := v->'pools';
  END IF;
  PERFORM wardah_internal.mfg_cost_policy_validate_205(v);

  v_rule := COALESCE(NULLIF(v->'wc_rules'->p_wc, 'null'::jsonb), '{}'::jsonb);
  SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::jsonb) INTO v_applying
  FROM jsonb_array_elements(v_pools) WITH ORDINALITY t(e, o)
  WHERE (v_rule #> ARRAY['pools', e->>'code', 'applies']) IS DISTINCT FROM 'false'::jsonb;

  IF v->>'labor_cost_source' = 'work_center_rate' THEN
    v_needed := v_needed || ARRAY['labor.run','labor.setup'];
  END IF;
  FOR v_p IN SELECT e FROM jsonb_array_elements(v_applying) e LOOP
    v_res := CASE v_p->>'basis' WHEN 'labor_hours' THEN 'labor' WHEN 'machine_hours' THEN 'machine' END;
    IF v_p->>'activity' IN ('run','both') THEN v_needed := v_needed || (v_res || '.run'); END IF;
    IF v_p->>'activity' IN ('setup','both') THEN v_needed := v_needed || (v_res || '.setup'); END IF;
  END LOOP;
  FOR v_need IN SELECT DISTINCT x FROM unnest(v_needed) x ORDER BY x LOOP
    v_x := p_hours #> string_to_array(v_need, '.');
    IF v_x IS NULL OR v_x = 'null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRIVER_MISSING: ' || v_need;
    END IF;
    v_h := v_h || jsonb_build_object(v_need,
      wardah_internal.mfg_cost_policy_num_205(v_x, 'COST_POLICY_HOURS_INVALID: ' || v_need, false));
  END LOOP;

  IF v->>'labor_cost_source' = 'work_center_rate' THEN
    v_rate := CASE WHEN v_rule ? 'labor_rate' THEN v_rule->'labor_rate' ELSE v->'default_labor_rate' END;
    v_labor := floor(((v_h->>'labor.run')::numeric + (v_h->>'labor.setup')::numeric)
                     * (wardah_internal.mfg_cost_policy_rate_205(v_rate) * 100) + 0.5);
  ELSE
    IF p_recorded IS NULL OR p_recorded = 'null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRIVER_MISSING: recorded_labor_cost';
    END IF;
    v_n := wardah_internal.mfg_cost_policy_num_205(p_recorded, 'COST_POLICY_RECORDED_COST_INVALID', false);
    IF v_n * 100 <> trunc(v_n * 100) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_RECORDED_COST_INVALID';
    END IF;
    v_labor := v_n * 100;
  END IF;

  FOR v_p IN SELECT e FROM jsonb_array_elements(v_applying) e LOOP
    v_pr := COALESCE(v_rule #> ARRAY['pools', v_p->>'code'], '{}'::jsonb);
    v_rate := CASE WHEN v_pr ? 'rate' THEN v_pr->'rate' ELSE v_p->'rate' END;
    v_res := CASE v_p->>'basis' WHEN 'labor_hours' THEN 'labor' ELSE 'machine' END;
    v_driver := CASE WHEN v_p->>'activity' IN ('run','both') THEN (v_h->>(v_res || '.run'))::numeric ELSE 0 END
              + CASE WHEN v_p->>'activity' IN ('setup','both') THEN (v_h->>(v_res || '.setup'))::numeric ELSE 0 END;
    v_n := floor(v_driver * (wardah_internal.mfg_cost_policy_rate_205(v_rate) * 100) + 0.5);
    v_out := v_out || jsonb_build_object(v_p->>'code', v_n::bigint);
    v_total := v_total + v_n;
  END LOOP;
  RETURN jsonb_build_object('labor', v_labor::bigint, 'pools', v_out, 'total', (v_labor + v_total)::bigint);
END
$fn$;

-- The calculator's JSON form of a stored version: 204 rows plus its 205 side rows. A version
-- without 205 data comes out without 'budgets' and without pool activity, so compute refuses it
-- as legacy (COST_POLICY_LEGACY_UNRESOLVED); after a legacy resolution its data is in the same
-- side tables and it computes like any 205 version.
CREATE FUNCTION wardah_internal.mfg_cost_policy_version_v_205(p_version uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $fn$
  SELECT jsonb_strip_nulls(jsonb_build_object(
      'labor_cost_source', v.labor_cost_source,
      'default_labor_rate', to_jsonb(v.default_labor_rate_per_hour)))
    || jsonb_build_object(
      'pools', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('code', p.pool_code, 'basis', p.basis, 'rate', p.rate)
                         || CASE WHEN x.pool_code IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
                              'activity', x.activity,
                              'budgets', COALESCE((SELECT jsonb_agg(pb.budget_code ORDER BY pb.budget_code)
                                FROM wardah_internal.mfg_cost_policy_pool_budgets_205 pb
                                WHERE pb.policy_version_id = p.policy_version_id AND pb.pool_code = p.pool_code),
                                '[]'::jsonb)) END
                         ORDER BY p.pool_code)
        FROM wardah_internal.mfg_cost_policy_pools p
        LEFT JOIN wardah_internal.mfg_cost_policy_pool_ext_205 x
          ON x.policy_version_id = p.policy_version_id AND x.pool_code = p.pool_code
        WHERE p.policy_version_id = v.id), '[]'::jsonb),
      'wc_rules', COALESCE((
        SELECT jsonb_object_agg(r.work_center_id::text,
                 jsonb_strip_nulls(jsonb_build_object('labor_rate', to_jsonb(r.labor_rate_per_hour)))
                 || jsonb_build_object('pools', COALESCE((
                      SELECT jsonb_object_agg(pr.pool_code,
                               jsonb_build_object('applies', pr.applies)
                               || CASE WHEN pr.rate IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('rate', pr.rate) END)
                      FROM wardah_internal.mfg_cost_policy_wc_pool_rules pr
                      WHERE pr.policy_version_id = r.policy_version_id AND pr.work_center_id = r.work_center_id),
                      '{}'::jsonb)))
        FROM wardah_internal.mfg_cost_policy_wc_rules r WHERE r.policy_version_id = v.id), '{}'::jsonb))
    || CASE WHEN EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_pool_ext_205 x WHERE x.policy_version_id = v.id)
       THEN jsonb_build_object(
         'budgets', COALESCE((
           SELECT jsonb_agg(jsonb_build_object('code', b.budget_code, 'gl_account', b.gl_account_id,
                    'cost_center', b.cost_center_id, 'setup', b.setup_related, 'amount', b.amount)
                    ORDER BY b.budget_code)
           FROM wardah_internal.mfg_cost_policy_budgets_205 b WHERE b.policy_version_id = v.id), '[]'::jsonb),
         'setup_acks', COALESCE((
           SELECT jsonb_agg(jsonb_build_object('pool', a.pool_code, 'budgets', a.codes) ORDER BY a.pool_code)
           FROM (SELECT s.pool_code, jsonb_agg(s.budget_code ORDER BY s.budget_code) AS codes
                 FROM wardah_internal.mfg_cost_policy_setup_acks_205 s WHERE s.policy_version_id = v.id
                 GROUP BY s.pool_code) a), '[]'::jsonb))
         || COALESCE((
           SELECT jsonb_build_object('unallocated_exception', jsonb_build_object(
                    'policy', e.policy_at_approval,
                    'budgets', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(e.budgets) k),
                    'reason', e.reason, 'treatment', e.treatment, 'approved_by', e.approved_by::text))
           FROM wardah_internal.mfg_cost_policy_unallocated_exceptions_205 e WHERE e.policy_version_id = v.id),
           '{}'::jsonb)
       ELSE '{}'::jsonb END
  FROM wardah_internal.mfg_cost_policy_versions v
  WHERE v.id = p_version;
$fn$;

-- Absorption for one work center under a stored version: the engine's (#260 phase 4) single entry
-- point for 205. Amounts in currency (2 decimals) and in cents; the unloaded budgets of a version
-- approved with a controlled exception are listed with their amounts and never absorbed.
CREATE FUNCTION wardah_internal.mfg_cost_policy_compute_205(
  p_org uuid, p_version uuid, p_work_center uuid, p_hours jsonb, p_recorded_labor_cost numeric
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_version wardah_internal.mfg_cost_policy_versions%ROWTYPE;
  v_v jsonb;
  v_c jsonb;
BEGIN
  SELECT * INTO v_version FROM wardah_internal.mfg_cost_policy_versions
  WHERE id = p_version AND org_id = p_org AND withdrawn_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_VERSION_UNKNOWN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_centers WHERE id = p_work_center AND org_id = p_org) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_WORK_CENTER_UNKNOWN';
  END IF;
  v_v := wardah_internal.mfg_cost_policy_version_v_205(p_version);
  v_c := wardah_internal.mfg_cost_policy_compute_205_v(
    v_v, p_work_center::text, COALESCE(p_hours, '{}'::jsonb), to_jsonb(p_recorded_labor_cost), NULL);
  RETURN jsonb_build_object(
    'policy_version_id', v_version.id,
    'version_no', v_version.version_no,
    'work_center_id', p_work_center,
    'stage_costing_method', v_version.stage_costing_method,
    'labor', jsonb_build_object('source', v_version.labor_cost_source,
                                'amount', ((v_c->>'labor')::numeric / 100)::numeric(18,2)),
    'overhead', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('pool_code', p->>'code', 'basis', p->>'basis', 'activity', p->>'activity',
                         'amount', ((v_c->'pools'->>(p->>'code'))::numeric / 100)::numeric(18,2))
                       ORDER BY p->>'code')
      FROM jsonb_array_elements(v_v->'pools') p WHERE v_c->'pools' ? (p->>'code')), '[]'::jsonb),
    'excluded_pools', COALESCE((
      SELECT jsonb_agg(p->>'code' ORDER BY p->>'code')
      FROM jsonb_array_elements(v_v->'pools') p WHERE NOT (v_c->'pools' ? (p->>'code'))), '[]'::jsonb),
    'overhead_total', (((v_c->>'total')::numeric - (v_c->>'labor')::numeric) / 100)::numeric(18,2),
    'total', ((v_c->>'total')::numeric / 100)::numeric(18,2),
    'unallocated_budgets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('budget_code', u.key, 'amount', (u.value::numeric / 100)::numeric(18,2))
                       ORDER BY u.key)
      FROM jsonb_each_text(wardah_internal.mfg_cost_policy_unallocated_205(v_v)) u), '[]'::jsonb),
    'cents', v_c);
END
$fn$;

-- First identity key anywhere in a payload, or NULL. Identities come from the session only.
CREATE FUNCTION wardah_internal.mfg_cost_policy_identity_key_205(p jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT min(k)
  FROM jsonb_path_query(p, 'strict $.**') AS t(x),
       LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(x) = 'object' THEN x ELSE '{}'::jsonb END) AS k
  WHERE k IN ('approved_by','created_by','decided_by','changed_by','resolved_by','rejected_by',
              'withdrawn_by','updated_by','pinned_by','approver','approver_id','creator','creator_id','user_id');
$fn$;

-- The 205 part of a draft: budgets, setup acknowledgements, controlled-exception request, and
-- the activity and budgets of each pool. Shapes and ownership only (205-Q3); the version rules are
-- the validator's, at approval. p_pools: [{pool_code, activity?, budgets?}]. Returns the
-- calculator form: {pools: [{code, activity?, budgets?}], budgets: [...], setup_acks: [...],
-- exception: {budgets, reason, treatment} | null}.
CREATE FUNCTION wardah_internal.mfg_cost_policy_check_205_part_205(p_org uuid, p_payload jsonb, p_pools jsonb, p_where text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_item jsonb;
  v_idx bigint;
  v_unknown text;
  v_codes text[] := '{}';
  v_pairs text[] := '{}';
  v_gl uuid;
  v_cc uuid;
  v_pools jsonb := '[]'::jsonb;
  v_budgets jsonb := '[]'::jsonb;
  v_acks jsonb := '[]'::jsonb;
  v_exc jsonb;
  v_x jsonb;
  v_n numeric;
BEGIN
  FOR v_item, v_idx IN SELECT e, o FROM jsonb_array_elements(p_pools) WITH ORDINALITY t(e, o) LOOP
    IF v_item ? 'activity' AND jsonb_typeof(v_item->'activity') <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: %s[%s].activity', p_where, v_idx);
    END IF;
    IF v_item ? 'budgets' AND (jsonb_typeof(v_item->'budgets') <> 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'budgets') e WHERE jsonb_typeof(e) <> 'string')) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: %s[%s].budgets', p_where, v_idx);
    END IF;
    v_pools := v_pools || jsonb_build_array(jsonb_build_object('code', v_item->>'pool_code')
      || CASE WHEN v_item ? 'activity' THEN jsonb_build_object('activity', v_item->'activity') ELSE '{}'::jsonb END
      || CASE WHEN v_item ? 'budgets' THEN jsonb_build_object('budgets', v_item->'budgets') ELSE '{}'::jsonb END);
  END LOOP;

  IF jsonb_typeof(p_payload->'budgets') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: budgets';
  END IF;
  IF jsonb_array_length(p_payload->'budgets') > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: budgets';
  END IF;
  FOR v_item, v_idx IN SELECT e, o FROM jsonb_array_elements(p_payload->'budgets') WITH ORDINALITY t(e, o) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: budgets[%s]', v_idx);
    END IF;
    SELECT min(k) INTO v_unknown FROM jsonb_object_keys(v_item) k
    WHERE k NOT IN ('budget_code','gl_account_id','cost_center_id','setup_related','amount','planned_hours');
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_UNKNOWN_KEY: budgets[%s].%s', v_idx, v_unknown);
    END IF;
    IF jsonb_typeof(v_item->'budget_code') IS DISTINCT FROM 'string'
       OR (v_item->>'budget_code') !~ '^[A-Z][A-Z0-9_]{1,29}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: budgets[%s].budget_code', v_idx);
    END IF;
    IF (v_item->>'budget_code') = ANY (v_codes) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_BUDGET_CODE_DUPLICATE: ' || (v_item->>'budget_code');
    END IF;
    v_codes := v_codes || (v_item->>'budget_code');
    v_gl := NULL;
    IF COALESCE(jsonb_typeof(v_item->'gl_account_id'), 'null') <> 'null' THEN
      BEGIN
        v_gl := (v_item->>'gl_account_id')::uuid;
      EXCEPTION WHEN others THEN
        v_gl := NULL;
      END;
      IF jsonb_typeof(v_item->'gl_account_id') <> 'string' OR v_gl IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: budgets[%s].gl_account_id', v_idx);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.gl_accounts WHERE id = v_gl AND org_id = p_org) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_GL_ACCOUNT_FOREIGN: budgets[%s]', v_idx);
      END IF;
    END IF;
    v_cc := NULL;
    IF COALESCE(jsonb_typeof(v_item->'cost_center_id'), 'null') <> 'null' THEN
      BEGIN
        v_cc := (v_item->>'cost_center_id')::uuid;
      EXCEPTION WHEN others THEN
        v_cc := NULL;
      END;
      IF jsonb_typeof(v_item->'cost_center_id') <> 'string' OR v_cc IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: budgets[%s].cost_center_id', v_idx);
      END IF;
      -- No center can be proven to belong to the organization (header); refused, not guessed.
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_COST_CENTER_FOREIGN: budgets[%s]', v_idx);
    END IF;
    IF jsonb_typeof(v_item->'setup_related') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: budgets[%s].setup_related', v_idx);
    END IF;
    IF COALESCE(jsonb_typeof(v_item->'amount'), 'null') NOT IN ('null','number','string') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: budgets[%s].amount', v_idx);
    END IF;
    IF COALESCE(jsonb_typeof(v_item->'planned_hours'), 'null') <> 'null' THEN
      v_n := wardah_internal.mfg_cost_policy_num_205(v_item->'planned_hours',
               format('COST_POLICY_INVALID: budgets[%s].planned_hours', v_idx), false);
      IF scale(v_n) > 6 OR v_n > 999999999 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: budgets[%s].planned_hours', v_idx);
      END IF;
    END IF;
    v_budgets := v_budgets || jsonb_build_array(jsonb_build_object(
      'code', v_item->>'budget_code', 'gl_account', v_gl, 'cost_center', v_cc,
      'setup', v_item->'setup_related', 'amount', COALESCE(v_item->'amount', 'null'::jsonb)));
  END LOOP;

  IF COALESCE(jsonb_typeof(p_payload->'setup_acks'), 'null') NOT IN ('null','array')
     OR jsonb_array_length(COALESCE(NULLIF(p_payload->'setup_acks', 'null'::jsonb), '[]'::jsonb)) > 400 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: setup_acks';
  END IF;
  FOR v_item, v_idx IN
    SELECT e, o FROM jsonb_array_elements(COALESCE(NULLIF(p_payload->'setup_acks', 'null'::jsonb), '[]'::jsonb))
    WITH ORDINALITY t(e, o)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k NOT IN ('pool_code','budget_code'))
       OR jsonb_typeof(v_item->'pool_code') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'budget_code') IS DISTINCT FROM 'string'
       OR ((v_item->>'pool_code') || '/' || (v_item->>'budget_code')) = ANY (v_pairs) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: setup_acks[%s]', v_idx);
    END IF;
    v_pairs := v_pairs || ((v_item->>'pool_code') || '/' || (v_item->>'budget_code'));
  END LOOP;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('pool', a.pool_code, 'budgets', a.codes) ORDER BY a.first_o), '[]'::jsonb)
  INTO v_acks
  FROM (SELECT e->>'pool_code' AS pool_code, min(o) AS first_o, jsonb_agg(e->'budget_code' ORDER BY o) AS codes
        FROM jsonb_array_elements(COALESCE(NULLIF(p_payload->'setup_acks', 'null'::jsonb), '[]'::jsonb))
             WITH ORDINALITY t(e, o)
        GROUP BY e->>'pool_code') a;

  v_x := NULLIF(p_payload->'unallocated_exception', 'null'::jsonb);
  IF v_x IS NOT NULL THEN
    IF jsonb_typeof(v_x) <> 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: unallocated_exception';
    END IF;
    SELECT min(k) INTO v_unknown FROM jsonb_object_keys(v_x) k WHERE k NOT IN ('budgets','reason','treatment');
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_UNKNOWN_KEY: unallocated_exception.' || v_unknown;
    END IF;
    IF (v_x ? 'reason' AND length(v_x->>'reason') > 500) OR (v_x ? 'treatment' AND length(v_x->>'treatment') > 500) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: unallocated_exception';
    END IF;
    v_exc := jsonb_build_object('budgets', COALESCE(v_x->'budgets', 'null'::jsonb),
                                'reason', COALESCE(v_x->'reason', 'null'::jsonb),
                                'treatment', COALESCE(v_x->'treatment', 'null'::jsonb));
  END IF;
  RETURN jsonb_build_object('pools', v_pools, 'budgets', v_budgets, 'setup_acks', v_acks,
                            'exception', COALESCE(v_exc, 'null'::jsonb));
END
$fn$;

-- The 204 fields of a version draft, checked exactly as rpc_create_mfg_cost_policy_version checks
-- them (same codes), with three differences: the 205 keys are allowed (budgets, setup_acks,
-- unallocated_exception; activity and budgets on each pool), a repeated pool code is
-- COST_POLICY_POOL_CODE_DUPLICATE (plan §3) and is checked before any pool, and the date checks run
-- here so that approval re-runs them (today in the org timezone, after every live version).
CREATE FUNCTION wardah_internal.mfg_cost_policy_check_204_part_205(p_org uuid, p_policy jsonb)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $fn$
DECLARE
  C_MAX_RATE CONSTANT numeric := 999999999;
  v_latest_start date;
  v_today date;
  v_unknown text;
  v_effective date;
  v_source text;
  v_default_labor numeric;
  v_item jsonb;
  v_sub jsonb;
  v_idx bigint;
  v_sub_idx bigint;
  v_rate numeric;
  v_wc uuid;
  v_pool_codes text[] := ARRAY[]::text[];
  v_wcs uuid[] := ARRAY[]::uuid[];
  v_rule_pools text[];
  v_has_labor boolean;
BEGIN
  IF jsonb_typeof(p_policy) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID';
  END IF;
  SELECT min(k) INTO v_unknown FROM jsonb_object_keys(p_policy) k
  WHERE k NOT IN ('effective_from','labor_cost_source','default_labor_rate_per_hour',
                  'stage_costing_method','pin_event','note','overhead_pools','work_center_rules',
                  'budgets','setup_acks','unallocated_exception');
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_UNKNOWN_KEY: ' || v_unknown;
  END IF;

  IF jsonb_typeof(p_policy->'effective_from') IS DISTINCT FROM 'string'
     OR (p_policy->>'effective_from') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: effective_from';
  END IF;
  BEGIN
    v_effective := (p_policy->>'effective_from')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: effective_from';
  END;
  v_today := wardah_internal.mfg_cost_policy_org_today_204(p_org, true);
  IF v_effective < v_today THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_EFFECTIVE_DATE_IN_PAST';
  END IF;
  SELECT max(effective_from) INTO v_latest_start
  FROM wardah_internal.mfg_cost_policy_versions
  WHERE org_id = p_org AND withdrawn_at IS NULL;
  IF v_latest_start IS NOT NULL AND v_effective <= v_latest_start THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'COST_POLICY_EFFECTIVE_DATE_NOT_AFTER_LATEST: latest=' || v_latest_start;
  END IF;

  v_source := p_policy->>'labor_cost_source';
  IF jsonb_typeof(p_policy->'labor_cost_source') IS DISTINCT FROM 'string'
     OR v_source NOT IN ('work_center_rate','recorded_entry_rate') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_LABOR_SOURCE_UNSUPPORTED';
  END IF;
  IF v_source = 'work_center_rate' THEN
    IF jsonb_typeof(p_policy->'default_labor_rate_per_hour') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_LABOR_RATE_MISSING';
    END IF;
    v_default_labor := (p_policy->>'default_labor_rate_per_hour')::numeric;
    IF v_default_labor <= 0 OR v_default_labor > C_MAX_RATE OR scale(v_default_labor) > 6 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'COST_POLICY_RATE_INVALID: default_labor_rate_per_hour';
    END IF;
  ELSIF COALESCE(jsonb_typeof(p_policy->'default_labor_rate_per_hour'), 'null') <> 'null' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'COST_POLICY_LABOR_RATE_NOT_APPLICABLE: default_labor_rate_per_hour';
  END IF;

  IF COALESCE(jsonb_typeof(p_policy->'stage_costing_method'), 'null') <> 'null'
     AND (jsonb_typeof(p_policy->'stage_costing_method') <> 'string'
          OR p_policy->>'stage_costing_method' <> 'weighted_average') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_STAGE_METHOD_UNSUPPORTED';
  END IF;

  IF jsonb_typeof(p_policy->'pin_event') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: pin_event';
  END IF;
  IF p_policy->>'pin_event' NOT IN ('mo_created','production_started') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_PIN_EVENT_UNSUPPORTED';
  END IF;

  IF COALESCE(jsonb_typeof(p_policy->'note'), 'null') NOT IN ('null','string')
     OR length(p_policy->>'note') > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: note';
  END IF;

  IF jsonb_typeof(p_policy->'overhead_pools') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_policy->'overhead_pools') = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_POOLS_REQUIRED';
  END IF;
  IF jsonb_array_length(p_policy->'overhead_pools') > 20 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: overhead_pools';
  END IF;
  -- 205: a repeated pool code is refused by its own code before any pool is checked.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_policy->'overhead_pools') e
             WHERE jsonb_typeof(e) = 'object' AND jsonb_typeof(e->'pool_code') = 'string'
             GROUP BY e->>'pool_code' HAVING count(*) > 1) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_POOL_CODE_DUPLICATE';
  END IF;
  FOR v_item, v_idx IN SELECT e, o FROM jsonb_array_elements(p_policy->'overhead_pools') WITH ORDINALITY AS t(e, o) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: overhead_pools[%s]', v_idx);
    END IF;
    SELECT min(k) INTO v_unknown FROM jsonb_object_keys(v_item) k
    WHERE k NOT IN ('pool_code','name','name_ar','basis','rate','activity','budgets');
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_UNKNOWN_KEY: overhead_pools[%s].%s', v_idx, v_unknown);
    END IF;
    IF jsonb_typeof(v_item->'pool_code') IS DISTINCT FROM 'string'
       OR (v_item->>'pool_code') !~ '^[A-Z][A-Z0-9_]{1,29}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_INVALID: overhead_pools[%s].pool_code', v_idx);
    END IF;
    v_pool_codes := v_pool_codes || (v_item->>'pool_code');
    IF jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
       OR length(btrim(v_item->>'name')) NOT BETWEEN 1 AND 120
       OR COALESCE(jsonb_typeof(v_item->'name_ar'), 'null') NOT IN ('null','string')
       OR (jsonb_typeof(v_item->'name_ar') = 'string'
           AND length(btrim(v_item->>'name_ar')) NOT BETWEEN 1 AND 120) THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_INVALID: overhead_pools[%s].name', v_idx);
    END IF;
    IF jsonb_typeof(v_item->'basis') IS DISTINCT FROM 'string'
       OR (v_item->>'basis') NOT IN ('labor_hours','machine_hours') THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_POOL_BASIS_UNSUPPORTED: overhead_pools[%s]', v_idx);
    END IF;
    IF jsonb_typeof(v_item->'rate') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_RATE_INVALID: overhead_pools[%s].rate', v_idx);
    END IF;
    v_rate := (v_item->>'rate')::numeric;
    IF v_rate <= 0 OR v_rate > C_MAX_RATE OR scale(v_rate) > 6 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_RATE_INVALID: overhead_pools[%s].rate', v_idx);
    END IF;
  END LOOP;

  IF COALESCE(jsonb_typeof(p_policy->'work_center_rules'), 'null') NOT IN ('null','array') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: work_center_rules';
  END IF;
  IF jsonb_array_length(COALESCE(NULLIF(p_policy->'work_center_rules', 'null'::jsonb), '[]'::jsonb)) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: work_center_rules';
  END IF;
  FOR v_item, v_idx IN
    SELECT e, o FROM jsonb_array_elements(COALESCE(NULLIF(p_policy->'work_center_rules', 'null'::jsonb), '[]'::jsonb))
    WITH ORDINALITY AS t(e, o)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: work_center_rules[%s]', v_idx);
    END IF;
    SELECT min(k) INTO v_unknown FROM jsonb_object_keys(v_item) k
    WHERE k NOT IN ('work_center_id','labor_rate_per_hour','pools');
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_UNKNOWN_KEY: work_center_rules[%s].%s', v_idx, v_unknown);
    END IF;
    BEGIN
      v_wc := (v_item->>'work_center_id')::uuid;
    EXCEPTION WHEN others THEN
      v_wc := NULL;
    END;
    IF jsonb_typeof(v_item->'work_center_id') IS DISTINCT FROM 'string' OR v_wc IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.work_centers
                      WHERE id = v_wc AND org_id = p_org AND is_active IS TRUE) THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_WORK_CENTER_UNKNOWN: work_center_rules[%s]', v_idx);
    END IF;
    IF v_wc = ANY (v_wcs) THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_WORK_CENTER_DUPLICATE: work_center_rules[%s]', v_idx);
    END IF;
    v_wcs := v_wcs || v_wc;
    v_has_labor := COALESCE(jsonb_typeof(v_item->'labor_rate_per_hour'), 'null') <> 'null';
    IF v_has_labor THEN
      IF v_source <> 'work_center_rate' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_LABOR_RATE_NOT_APPLICABLE: work_center_rules[%s]', v_idx);
      END IF;
      IF jsonb_typeof(v_item->'labor_rate_per_hour') <> 'number' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_RATE_INVALID: work_center_rules[%s].labor_rate_per_hour', v_idx);
      END IF;
      v_rate := (v_item->>'labor_rate_per_hour')::numeric;
      IF v_rate <= 0 OR v_rate > C_MAX_RATE OR scale(v_rate) > 6 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_RATE_INVALID: work_center_rules[%s].labor_rate_per_hour', v_idx);
      END IF;
    END IF;
    IF COALESCE(jsonb_typeof(v_item->'pools'), 'null') NOT IN ('null','array') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: work_center_rules[%s].pools', v_idx);
    END IF;
    IF NOT v_has_labor
       AND jsonb_array_length(COALESCE(NULLIF(v_item->'pools', 'null'::jsonb), '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_WC_RULE_EMPTY: work_center_rules[%s]', v_idx);
    END IF;
    v_rule_pools := ARRAY[]::text[];
    FOR v_sub, v_sub_idx IN
      SELECT e, o FROM jsonb_array_elements(COALESCE(NULLIF(v_item->'pools', 'null'::jsonb), '[]'::jsonb))
      WITH ORDINALITY AS t(e, o)
    LOOP
      IF jsonb_typeof(v_sub) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_INVALID: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
      END IF;
      SELECT min(k) INTO v_unknown FROM jsonb_object_keys(v_sub) k
      WHERE k NOT IN ('pool_code','applies','rate');
      IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_UNKNOWN_KEY: work_center_rules[%s].pools[%s].%s', v_idx, v_sub_idx, v_unknown);
      END IF;
      IF jsonb_typeof(v_sub->'pool_code') IS DISTINCT FROM 'string'
         OR NOT ((v_sub->>'pool_code') = ANY (v_pool_codes)) THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_WC_POOL_UNKNOWN: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
      END IF;
      IF (v_sub->>'pool_code') = ANY (v_rule_pools) THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_WC_POOL_DUPLICATE: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
      END IF;
      v_rule_pools := v_rule_pools || (v_sub->>'pool_code');
      IF jsonb_typeof(v_sub->'applies') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_INVALID: work_center_rules[%s].pools[%s].applies', v_idx, v_sub_idx);
      END IF;
      IF (v_sub->>'applies')::boolean THEN
        IF jsonb_typeof(v_sub->'rate') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = format('COST_POLICY_WC_POOL_RATE_INVALID: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
        END IF;
        v_rate := (v_sub->>'rate')::numeric;
        IF v_rate <= 0 OR v_rate > C_MAX_RATE OR scale(v_rate) > 6 THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = format('COST_POLICY_WC_POOL_RATE_INVALID: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
        END IF;
      ELSIF COALESCE(jsonb_typeof(v_sub->'rate'), 'null') <> 'null' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_WC_POOL_RATE_INVALID: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
      END IF;
    END LOOP;
  END LOOP;
END
$fn$;

-- A version draft as the calculator's version (for the validator), after every shape, ownership
-- and 204 field check. The exception request becomes the recorded exception only at approval
-- (policy from the company setting, approver from the session).
CREATE FUNCTION wardah_internal.mfg_cost_policy_draft_v_205(p_org uuid, p_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_key text;
  v_part jsonb;
BEGIN
  IF jsonb_typeof(p_draft) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID';
  END IF;
  v_key := wardah_internal.mfg_cost_policy_identity_key_205(p_draft);
  IF v_key IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRAFT_IDENTITY_FIELD: ' || v_key;
  END IF;
  PERFORM wardah_internal.mfg_cost_policy_check_204_part_205(p_org, p_draft);
  v_part := wardah_internal.mfg_cost_policy_check_205_part_205(p_org, p_draft, p_draft->'overhead_pools', 'overhead_pools');
  RETURN jsonb_build_object(
    'labor_cost_source', p_draft->'labor_cost_source',
    'pools', (SELECT jsonb_agg(jsonb_build_object('code', e->>'pool_code', 'basis', e->>'basis', 'rate', e->'rate')
                               || ((v_part->'pools'->((o - 1)::int)) - 'code') ORDER BY o)
              FROM jsonb_array_elements(p_draft->'overhead_pools') WITH ORDINALITY t(e, o)),
    'budgets', v_part->'budgets',
    'setup_acks', v_part->'setup_acks',
    'wc_rules', COALESCE((
      SELECT jsonb_object_agg(r->>'work_center_id',
               CASE WHEN COALESCE(jsonb_typeof(r->'labor_rate_per_hour'), 'null') <> 'null'
                    THEN jsonb_build_object('labor_rate', r->'labor_rate_per_hour') ELSE '{}'::jsonb END
               || jsonb_build_object('pools', COALESCE((
                    SELECT jsonb_object_agg(pr->>'pool_code', jsonb_build_object('applies', pr->'applies')
                             || CASE WHEN (pr->>'applies')::boolean THEN jsonb_build_object('rate', pr->'rate') ELSE '{}'::jsonb END)
                    FROM jsonb_array_elements(COALESCE(NULLIF(r->'pools', 'null'::jsonb), '[]'::jsonb)) pr), '{}'::jsonb)))
      FROM jsonb_array_elements(COALESCE(NULLIF(p_draft->'work_center_rules', 'null'::jsonb), '[]'::jsonb)) r),
      '{}'::jsonb))
    || CASE WHEN p_draft->>'labor_cost_source' = 'work_center_rate'
            THEN jsonb_build_object('default_labor_rate', p_draft->'default_labor_rate_per_hour') ELSE '{}'::jsonb END
    || jsonb_build_object('exception_request', v_part->'exception');
END
$fn$;

-- A legacy-resolution draft as the calculator's legacy_resolution, after shape and ownership
-- checks. Payload: {pools: [{pool_code, activity, budgets}], budgets, setup_acks,
-- unallocated_exception?}.
CREATE FUNCTION wardah_internal.mfg_cost_policy_resolution_v_205(p_org uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_key text;
  v_unknown text;
  v_item jsonb;
  v_idx bigint;
  v_part jsonb;
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID';
  END IF;
  v_key := wardah_internal.mfg_cost_policy_identity_key_205(p_payload);
  IF v_key IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRAFT_IDENTITY_FIELD: ' || v_key;
  END IF;
  SELECT min(k) INTO v_unknown FROM jsonb_object_keys(p_payload) k
  WHERE k NOT IN ('pools','budgets','setup_acks','unallocated_exception');
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_UNKNOWN_KEY: ' || v_unknown;
  END IF;
  IF jsonb_typeof(p_payload->'pools') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'pools') > 20 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: pools';
  END IF;
  FOR v_item, v_idx IN SELECT e, o FROM jsonb_array_elements(p_payload->'pools') WITH ORDINALITY t(e, o) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item->'pool_code') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: pools[%s]', v_idx);
    END IF;
    SELECT min(k) INTO v_unknown FROM jsonb_object_keys(v_item) k WHERE k NOT IN ('pool_code','activity','budgets');
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_UNKNOWN_KEY: pools[%s].%s', v_idx, v_unknown);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'pools') e GROUP BY e->>'pool_code' HAVING count(*) > 1) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_POOL_CODE_DUPLICATE';
  END IF;
  v_part := wardah_internal.mfg_cost_policy_check_205_part_205(p_org, p_payload, p_payload->'pools', 'pools');
  RETURN jsonb_build_object(
    'pools', COALESCE((SELECT jsonb_object_agg(e->>'code', e - 'code') FROM jsonb_array_elements(v_part->'pools') e), '{}'::jsonb),
    'budgets', v_part->'budgets',
    'setup_acks', v_part->'setup_acks',
    'exception_request', v_part->'exception');
END
$fn$;

CREATE FUNCTION wardah_internal.mfg_cost_policy_drafts_json_205(p_org uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', d.id, 'kind', d.kind, 'status', d.status, 'revision', d.revision, 'legacy_version_id', d.legacy_version_id,
           'payload', d.payload, 'expected_latest_version_no', d.expected_latest_version_no,
           'reason', d.reason, 'created_by', d.created_by, 'created_at', d.created_at, 'updated_at', d.updated_at,
           'decided_by', d.decided_by, 'decided_at', d.decided_at, 'decision_reason', d.decision_reason,
           'result_version_id', d.result_version_id,
           -- The selected budgets no pool of the draft loads, with their amounts as entered: what the
           -- approval screen shows (205-Q4). Informational; approval re-checks everything.
           'unallocated_budgets', COALESCE((
             SELECT jsonb_agg(jsonb_build_object('budget_code', b->>'budget_code', 'amount', b->'amount')
                              ORDER BY b->>'budget_code')
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.payload->'budgets') = 'array'
                                            THEN d.payload->'budgets' ELSE '[]'::jsonb END) b
             WHERE NOT EXISTS (
               SELECT 1
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.payload->CASE d.kind WHEN 'version' THEN 'overhead_pools' ELSE 'pools' END) = 'array'
                                              THEN d.payload->CASE d.kind WHEN 'version' THEN 'overhead_pools' ELSE 'pools' END
                                              ELSE '[]'::jsonb END) p,
                    jsonb_array_elements(CASE WHEN jsonb_typeof(p->'budgets') = 'array' THEN p->'budgets' ELSE '[]'::jsonb END) x
               WHERE x #>> '{}' = b->>'budget_code')), '[]'::jsonb))
         ORDER BY d.created_at DESC, d.id), '[]'::jsonb)
  FROM wardah_internal.mfg_cost_policy_drafts_205 d
  WHERE d.org_id = p_org;
$fn$;

REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_lock_org_205(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_has_assigned_205(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_settings_205(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_num_205(jsonb, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_rate_205(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_check_exception_205(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_validate_205(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_unallocated_205(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_approve_check_205(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_compute_205_v(jsonb, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_version_v_205(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_compute_205(uuid, uuid, uuid, jsonb, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_identity_key_205(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_check_205_part_205(uuid, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_check_204_part_205(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_draft_v_205(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_resolution_v_205(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_drafts_json_205(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Client RPCs (authenticated only). Every identity is auth.uid(); no RPC takes a user.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.rpc_get_mfg_cost_policy_205(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_today date;
  v_settings jsonb;
  v_can_approve boolean;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  v_can_approve := COALESCE(public.has_permission(auth.uid(), p_org_id, 'manufacturing.cost_policy.approve'), false);
  IF NOT (wardah_internal.mfg_cost_policy_can_read_204(p_org_id) OR v_can_approve) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_READ_DENIED';
  END IF;
  v_today := wardah_internal.mfg_cost_policy_org_today_204(p_org_id, false);
  v_settings := wardah_internal.mfg_cost_policy_settings_205(p_org_id);
  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'today', v_today,
    'current_version_id', wardah_internal.mfg_cost_policy_version_at_204(p_org_id, v_today),
    'latest_version_no', COALESCE((SELECT max(version_no)
      FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = p_org_id), 0),
    'versions', COALESCE((
      SELECT jsonb_agg(wardah_internal.mfg_cost_policy_version_json_204(v.id, v_today)
               || jsonb_build_object(
                    'policy_205', CASE
                      WHEN EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_legacy_resolutions_205 l
                                   WHERE l.policy_version_id = v.id) THEN 'legacy_resolved'
                      WHEN EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approvals_205 a
                                   WHERE a.policy_version_id = v.id) THEN 'approved_205'
                      ELSE 'legacy_unresolved' END,
                    'data_205', wardah_internal.mfg_cost_policy_version_v_205(v.id),
                    'approval', (SELECT to_jsonb(a) - 'org_id' FROM wardah_internal.mfg_cost_policy_approvals_205 a
                                 WHERE a.policy_version_id = v.id),
                    'legacy_resolution', (SELECT to_jsonb(l) - 'org_id'
                                          FROM wardah_internal.mfg_cost_policy_legacy_resolutions_205 l
                                          WHERE l.policy_version_id = v.id),
                    'unallocated_exception', (SELECT to_jsonb(e) - 'org_id'
                                              FROM wardah_internal.mfg_cost_policy_unallocated_exceptions_205 e
                                              WHERE e.policy_version_id = v.id))
               ORDER BY v.version_no DESC)
      FROM wardah_internal.mfg_cost_policy_versions v WHERE v.org_id = p_org_id), '[]'::jsonb),
    'drafts', wardah_internal.mfg_cost_policy_drafts_json_205(p_org_id),
    'settings', v_settings,
    'settings_audit', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) - 'org_id' ORDER BY s.id DESC)
      FROM wardah_internal.mfg_cost_policy_approval_settings_audit_205 s WHERE s.org_id = p_org_id), '[]'::jsonb),
    'supported', jsonb_build_object(
      'labor_cost_sources', jsonb_build_array('work_center_rate','recorded_entry_rate'),
      'overhead_bases', jsonb_build_array('labor_hours','machine_hours'),
      'pool_activities', jsonb_build_array('run','setup','both'),
      'stage_costing_methods', jsonb_build_array('weighted_average'),
      'pin_events', jsonb_build_array('mo_created','production_started'),
      'unallocated_budget_policies', jsonb_build_array('block','controlled_exception'),
      'cost_centers_accepted', false),
    'capabilities', jsonb_build_object(
      'can_create', wardah_internal.manufacturing_settings_can_update_201(p_org_id),
      'can_approve', v_can_approve,
      'can_self_approve', v_can_approve AND (v_settings->>'self_approval_enabled')::boolean
        AND wardah_internal.mfg_cost_policy_has_assigned_205(p_org_id, 'manufacturing.cost_policy.self_approve'),
      'can_manage_approval_settings',
        wardah_internal.mfg_cost_policy_has_assigned_205(p_org_id, 'manufacturing.cost_policy.approval_settings.manage'),
      'can_manage_unallocated_policy', public.wardah_is_org_admin(p_org_id)
        AND wardah_internal.mfg_cost_policy_has_assigned_205(p_org_id, 'manufacturing.cost_policy.unallocated_policy.manage')));
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_get_mfg_cost_policy_205(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_mfg_cost_policy_205(uuid) TO authenticated;

CREATE FUNCTION public.rpc_create_mfg_cost_policy_draft_205(
  p_org_id uuid, p_draft jsonb, p_expected_latest_version_no integer, p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_hash text;
  v_existing wardah_internal.mfg_cost_policy_drafts_205%ROWTYPE;
  v_latest_no integer;
  v_id uuid;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.manufacturing_settings_can_update_201(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  IF jsonb_typeof(p_draft) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID';
  END IF;
  v_hash := md5(jsonb_build_array(p_draft, p_expected_latest_version_no)::text);
  SELECT * INTO v_existing FROM wardah_internal.mfg_cost_policy_drafts_205
  WHERE org_id = p_org_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash OR v_existing.kind <> 'version' OR v_existing.created_by <> auth.uid() THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object('draft_id', v_existing.id, 'status', v_existing.status, 'revision', v_existing.revision, 'replayed', true);
  END IF;
  SELECT COALESCE(max(version_no), 0) INTO v_latest_no
  FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = p_org_id;
  IF p_expected_latest_version_no IS NULL OR p_expected_latest_version_no <> v_latest_no THEN
    RAISE EXCEPTION 'COST_POLICY_VERSION_CONFLICT: latest=%', v_latest_no;
  END IF;
  PERFORM wardah_internal.mfg_cost_policy_draft_v_205(p_org_id, p_draft);
  INSERT INTO wardah_internal.mfg_cost_policy_drafts_205
    (org_id, kind, payload, payload_hash, expected_latest_version_no, idempotency_key, created_by)
  VALUES (p_org_id, 'version', p_draft, v_hash, p_expected_latest_version_no, p_idempotency_key, auth.uid())
  ON CONFLICT (org_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    -- A concurrent call with the same key committed first (the insert waited for it): a replay if it
    -- is the same request, a conflict otherwise.
    SELECT * INTO v_existing FROM wardah_internal.mfg_cost_policy_drafts_205
    WHERE org_id = p_org_id AND idempotency_key = p_idempotency_key;
    IF NOT FOUND OR v_existing.payload_hash <> v_hash OR v_existing.kind <> 'version' OR v_existing.created_by <> auth.uid() THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object('draft_id', v_existing.id, 'status', v_existing.status, 'revision', v_existing.revision, 'replayed', true);
  END IF;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.cost_policy.draft_create', 'mfg_cost_policy_draft', v_id::text,
          NULL, p_draft, jsonb_build_object('source', 'rpc_create_mfg_cost_policy_draft_205', 'migration', 205,
                                            'idempotency_key', p_idempotency_key));
  RETURN jsonb_build_object('draft_id', v_id, 'status', 'draft', 'revision', 1, 'replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_create_mfg_cost_policy_draft_205(uuid, jsonb, integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_mfg_cost_policy_draft_205(uuid, jsonb, integer, uuid) TO authenticated;

CREATE FUNCTION public.rpc_create_legacy_resolution_draft_205(
  p_org_id uuid, p_policy_version_id uuid, p_resolution jsonb, p_reason text, p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_hash text;
  v_existing wardah_internal.mfg_cost_policy_drafts_205%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.manufacturing_settings_can_update_201(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_LEGACY_REASON_REQUIRED';
  END IF;
  IF jsonb_typeof(p_resolution) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID';
  END IF;
  v_hash := md5(jsonb_build_array(p_policy_version_id, p_resolution, btrim(p_reason))::text);
  SELECT * INTO v_existing FROM wardah_internal.mfg_cost_policy_drafts_205
  WHERE org_id = p_org_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash OR v_existing.kind <> 'legacy_resolution' OR v_existing.created_by <> auth.uid() THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object('draft_id', v_existing.id, 'status', v_existing.status, 'revision', v_existing.revision, 'replayed', true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_versions
                 WHERE id = p_policy_version_id AND org_id = p_org_id AND withdrawn_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_VERSION_UNKNOWN';
  END IF;
  IF EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_pool_ext_205 WHERE policy_version_id = p_policy_version_id)
     OR EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approvals_205 WHERE policy_version_id = p_policy_version_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_LEGACY_NOT_APPLICABLE';
  END IF;
  PERFORM wardah_internal.mfg_cost_policy_resolution_v_205(p_org_id, p_resolution);
  INSERT INTO wardah_internal.mfg_cost_policy_drafts_205
    (org_id, kind, legacy_version_id, payload, payload_hash, reason, idempotency_key, created_by)
  VALUES (p_org_id, 'legacy_resolution', p_policy_version_id, p_resolution, v_hash, btrim(p_reason),
          p_idempotency_key, auth.uid())
  ON CONFLICT (org_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT * INTO v_existing FROM wardah_internal.mfg_cost_policy_drafts_205
    WHERE org_id = p_org_id AND idempotency_key = p_idempotency_key;
    IF NOT FOUND OR v_existing.payload_hash <> v_hash OR v_existing.kind <> 'legacy_resolution' OR v_existing.created_by <> auth.uid() THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object('draft_id', v_existing.id, 'status', v_existing.status, 'revision', v_existing.revision, 'replayed', true);
  END IF;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.cost_policy.legacy_draft_create', 'mfg_cost_policy_draft', v_id::text,
          NULL, p_resolution, jsonb_build_object('source', 'rpc_create_legacy_resolution_draft_205', 'migration', 205,
                                                 'policy_version_id', p_policy_version_id, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('draft_id', v_id, 'status', 'draft', 'revision', 1, 'replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_create_legacy_resolution_draft_205(uuid, uuid, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_legacy_resolution_draft_205(uuid, uuid, jsonb, text, uuid) TO authenticated;

-- The creator edits a pending version draft (another user creates their own draft).
CREATE FUNCTION public.rpc_update_mfg_cost_policy_draft_205(
  p_org_id uuid, p_draft_id uuid, p_draft jsonb, p_expected_latest_version_no integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d wardah_internal.mfg_cost_policy_drafts_205%ROWTYPE;
  v_latest_no integer;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.manufacturing_settings_can_update_201(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;
  SELECT * INTO v_d FROM wardah_internal.mfg_cost_policy_drafts_205
  WHERE id = p_draft_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRAFT_UNKNOWN';
  END IF;
  IF v_d.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRAFT_NOT_PENDING';
  END IF;
  IF v_d.kind <> 'version' OR v_d.created_by <> auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'COST_POLICY_DRAFT_EDIT_DENIED';
  END IF;
  SELECT COALESCE(max(version_no), 0) INTO v_latest_no
  FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = p_org_id;
  IF p_expected_latest_version_no IS NULL OR p_expected_latest_version_no <> v_latest_no THEN
    RAISE EXCEPTION 'COST_POLICY_VERSION_CONFLICT: latest=%', v_latest_no;
  END IF;
  PERFORM wardah_internal.mfg_cost_policy_draft_v_205(p_org_id, p_draft);
  -- Saving the same content changes nothing: success, same revision, no row update, no audit row.
  IF v_d.payload = p_draft AND v_d.expected_latest_version_no = p_expected_latest_version_no THEN
    RETURN jsonb_build_object('draft_id', p_draft_id, 'status', 'draft', 'revision', v_d.revision, 'unchanged', true);
  END IF;
  UPDATE wardah_internal.mfg_cost_policy_drafts_205
  SET payload = p_draft, payload_hash = md5(jsonb_build_array(p_draft, p_expected_latest_version_no)::text),
      expected_latest_version_no = p_expected_latest_version_no, revision = v_d.revision + 1, updated_at = now()
  WHERE id = p_draft_id;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.cost_policy.draft_update', 'mfg_cost_policy_draft', p_draft_id::text,
          v_d.payload, p_draft, jsonb_build_object('source', 'rpc_update_mfg_cost_policy_draft_205', 'migration', 205,
                                                   'revision', v_d.revision + 1));
  RETURN jsonb_build_object('draft_id', p_draft_id, 'status', 'draft', 'revision', v_d.revision + 1, 'unchanged', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_update_mfg_cost_policy_draft_205(uuid, uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_update_mfg_cost_policy_draft_205(uuid, uuid, jsonb, integer) TO authenticated;

CREATE FUNCTION public.rpc_withdraw_mfg_cost_policy_draft_205(p_org_id uuid, p_draft_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d wardah_internal.mfg_cost_policy_drafts_205%ROWTYPE;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DECISION_REASON_REQUIRED';
  END IF;
  SELECT * INTO v_d FROM wardah_internal.mfg_cost_policy_drafts_205
  WHERE id = p_draft_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRAFT_UNKNOWN';
  END IF;
  IF v_d.created_by <> auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'COST_POLICY_DRAFT_EDIT_DENIED';
  END IF;
  IF v_d.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRAFT_NOT_PENDING';
  END IF;
  UPDATE wardah_internal.mfg_cost_policy_drafts_205
  SET status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(p_reason)
  WHERE id = p_draft_id;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.cost_policy.draft_withdraw', 'mfg_cost_policy_draft', p_draft_id::text,
          NULL, NULL, jsonb_build_object('source', 'rpc_withdraw_mfg_cost_policy_draft_205', 'migration', 205,
                                         'reason', btrim(p_reason)));
  RETURN jsonb_build_object('draft_id', p_draft_id, 'status', 'withdrawn');
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_withdraw_mfg_cost_policy_draft_205(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_withdraw_mfg_cost_policy_draft_205(uuid, uuid, text) TO authenticated;

CREATE FUNCTION public.rpc_reject_mfg_cost_policy_draft_205(p_org_id uuid, p_draft_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d wardah_internal.mfg_cost_policy_drafts_205%ROWTYPE;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT COALESCE(public.has_permission(auth.uid(), p_org_id, 'manufacturing.cost_policy.approve'), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'COST_POLICY_APPROVE_DENIED';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DECISION_REASON_REQUIRED';
  END IF;
  SELECT * INTO v_d FROM wardah_internal.mfg_cost_policy_drafts_205
  WHERE id = p_draft_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRAFT_UNKNOWN';
  END IF;
  IF v_d.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRAFT_NOT_PENDING';
  END IF;
  UPDATE wardah_internal.mfg_cost_policy_drafts_205
  SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(p_reason)
  WHERE id = p_draft_id;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.cost_policy.draft_reject', 'mfg_cost_policy_draft', p_draft_id::text,
          NULL, NULL, jsonb_build_object('source', 'rpc_reject_mfg_cost_policy_draft_205', 'migration', 205,
                                         'reason', btrim(p_reason)));
  RETURN jsonb_build_object('draft_id', p_draft_id, 'status', 'rejected');
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_reject_mfg_cost_policy_draft_205(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reject_mfg_cost_policy_draft_205(uuid, uuid, text) TO authenticated;

-- Approval of a version draft or a legacy-resolution draft. Under the org lock (205) and then
-- the 204 writer lock, in this order everywhere, so the 204 pin triggers (shared 204 lock) wait
-- for the new version and two approvals of one org never run together. p_expected_revision is the
-- draft revision the approver reviewed; it is compared under the draft row lock, so an edit that
-- committed after the approver read the draft makes the approval refuse instead of approving
-- content the approver has not seen.
CREATE FUNCTION public.rpc_approve_mfg_cost_policy_draft_205(p_org_id uuid, p_draft_id uuid, p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_d wardah_internal.mfg_cost_policy_drafts_205%ROWTYPE;
  v_settings jsonb;
  v_policy text;
  v_self boolean;
  v_latest_no integer;
  v_v jsonb;
  v_req jsonb;
  v_check jsonb;
  v_version_id uuid;
  v_version wardah_internal.mfg_cost_policy_versions%ROWTYPE;
  v_resources jsonb;
  v_b jsonb;
  v_n numeric;
  v_pools_src jsonb;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  v_uid := auth.uid();
  IF NOT COALESCE(public.has_permission(v_uid, p_org_id, 'manufacturing.cost_policy.approve'), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'COST_POLICY_APPROVE_DENIED';
  END IF;

  PERFORM wardah_internal.mfg_cost_policy_lock_org_205(p_org_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('wardah.mfg_cost_policy:' || p_org_id::text, 204));

  SELECT * INTO v_d FROM wardah_internal.mfg_cost_policy_drafts_205
  WHERE id = p_draft_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRAFT_UNKNOWN';
  END IF;
  IF v_d.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRAFT_NOT_PENDING';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision <> v_d.revision THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_DRAFT_REVISION_CONFLICT: current=%s', v_d.revision);
  END IF;

  -- Read after the lock: no settings change can run in between.
  v_settings := wardah_internal.mfg_cost_policy_settings_205(p_org_id);
  v_policy := v_settings->>'unallocated_budget_policy';
  v_self := v_d.created_by = v_uid;
  IF v_self AND NOT ((v_settings->>'self_approval_enabled')::boolean
       AND wardah_internal.mfg_cost_policy_has_assigned_205(p_org_id, 'manufacturing.cost_policy.self_approve')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'COST_POLICY_SELF_APPROVAL_NOT_ALLOWED';
  END IF;

  IF v_d.kind = 'version' THEN
    SELECT COALESCE(max(version_no), 0) INTO v_latest_no
    FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = p_org_id;
    IF v_d.expected_latest_version_no <> v_latest_no THEN
      RAISE EXCEPTION 'COST_POLICY_VERSION_CONFLICT: latest=%', v_latest_no;
    END IF;
    v_v := wardah_internal.mfg_cost_policy_draft_v_205(p_org_id, v_d.payload);
    v_pools_src := v_d.payload->'overhead_pools';
  ELSE
    SELECT * INTO v_version FROM wardah_internal.mfg_cost_policy_versions
    WHERE id = v_d.legacy_version_id AND org_id = p_org_id AND withdrawn_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_VERSION_UNKNOWN';
    END IF;
    IF EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_pool_ext_205 WHERE policy_version_id = v_version.id)
       OR EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approvals_205 WHERE policy_version_id = v_version.id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_LEGACY_NOT_APPLICABLE';
    END IF;
    v_req := wardah_internal.mfg_cost_policy_resolution_v_205(p_org_id, v_d.payload);
    -- The stored 204 version merged with the resolution, as compute_205 merges a legacy_resolution;
    -- the version rows themselves are never changed.
    v_v := wardah_internal.mfg_cost_policy_version_v_205(v_version.id);
    IF NOT (ARRAY(SELECT e->>'code' FROM jsonb_array_elements(v_v->'pools') e)
              @> ARRAY(SELECT jsonb_object_keys(v_req->'pools'))
            AND ARRAY(SELECT jsonb_object_keys(v_req->'pools'))
              @> ARRAY(SELECT e->>'code' FROM jsonb_array_elements(v_v->'pools') e)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_LEGACY_POOLS_MISMATCH';
    END IF;
    v_v := v_v || jsonb_build_object(
      'pools', (SELECT jsonb_agg(e || (v_req->'pools'->(e->>'code')) ORDER BY o)
                FROM jsonb_array_elements(v_v->'pools') WITH ORDINALITY t(e, o)),
      'budgets', v_req->'budgets', 'setup_acks', v_req->'setup_acks', 'exception_request', v_req->'exception_request');
    v_pools_src := v_d.payload->'pools';
  END IF;

  -- The exception request becomes the recorded exception: policy = the company setting now,
  -- approver = the session user (205-Q4). Then approve_205_check.
  v_req := NULLIF(v_v->'exception_request', 'null'::jsonb);
  v_v := v_v - 'exception_request';
  IF v_req IS NOT NULL THEN
    v_v := v_v || jsonb_build_object('unallocated_exception', v_req || jsonb_build_object(
      'policy', v_policy, 'approved_by', v_uid::text));
  END IF;
  v_check := wardah_internal.mfg_cost_policy_approve_check_205(v_v, v_policy);
  -- Every stored amount is a valid amount (the exception check covers excepted budgets only).
  FOR v_b IN SELECT e FROM jsonb_array_elements(v_v->'budgets') e LOOP
    IF COALESCE(jsonb_typeof(v_b->'amount'), 'null') <> 'null' THEN
      v_n := wardah_internal.mfg_cost_policy_num_205(v_b->'amount', 'COST_POLICY_BUDGET_AMOUNT_INVALID: ' || (v_b->>'code'), false);
      IF v_n * 100 <> trunc(v_n * 100) OR v_n > 9999999999999999 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_BUDGET_AMOUNT_INVALID: ' || (v_b->>'code');
      END IF;
    END IF;
  END LOOP;

  IF v_d.kind = 'version' THEN
    INSERT INTO wardah_internal.mfg_cost_policy_versions
      (org_id, version_no, effective_from, labor_cost_source, default_labor_rate_per_hour,
       stage_costing_method, pin_event, note, idempotency_key, payload_hash, created_by)
    VALUES (p_org_id, v_latest_no + 1, (v_d.payload->>'effective_from')::date, v_d.payload->>'labor_cost_source',
            CASE WHEN v_d.payload->>'labor_cost_source' = 'work_center_rate'
                 THEN (v_d.payload->>'default_labor_rate_per_hour')::numeric END,
            'weighted_average', v_d.payload->>'pin_event', NULLIF(btrim(v_d.payload->>'note'), ''),
            v_d.id, v_d.payload_hash, v_d.created_by)
    RETURNING id INTO v_version_id;
    INSERT INTO wardah_internal.mfg_cost_policy_pools
      (policy_version_id, org_id, pool_code, name, name_ar, basis, rate)
    SELECT v_version_id, p_org_id, e->>'pool_code', btrim(e->>'name'),
           NULLIF(btrim(e->>'name_ar'), ''), e->>'basis', (e->>'rate')::numeric
    FROM jsonb_array_elements(v_d.payload->'overhead_pools') e;
    INSERT INTO wardah_internal.mfg_cost_policy_wc_rules
      (policy_version_id, org_id, work_center_id, labor_rate_per_hour)
    SELECT v_version_id, p_org_id, (e->>'work_center_id')::uuid,
           CASE WHEN COALESCE(jsonb_typeof(e->'labor_rate_per_hour'), 'null') = 'null' THEN NULL
                ELSE (e->>'labor_rate_per_hour')::numeric END
    FROM jsonb_array_elements(COALESCE(NULLIF(v_d.payload->'work_center_rules', 'null'::jsonb), '[]'::jsonb)) e;
    INSERT INTO wardah_internal.mfg_cost_policy_wc_pool_rules
      (policy_version_id, org_id, work_center_id, pool_code, applies, rate)
    SELECT v_version_id, p_org_id, (e->>'work_center_id')::uuid, pr->>'pool_code',
           (pr->>'applies')::boolean,
           CASE WHEN (pr->>'applies')::boolean THEN (pr->>'rate')::numeric ELSE NULL END
    FROM jsonb_array_elements(COALESCE(NULLIF(v_d.payload->'work_center_rules', 'null'::jsonb), '[]'::jsonb)) e
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(e->'pools', 'null'::jsonb), '[]'::jsonb)) pr;
  ELSE
    v_version_id := v_version.id;
  END IF;

  INSERT INTO wardah_internal.mfg_cost_policy_budgets_205
    (policy_version_id, org_id, budget_code, gl_account_id, cost_center_id, setup_related, amount, planned_hours)
  SELECT v_version_id, p_org_id, b->>'budget_code', (b->>'gl_account_id')::uuid,
         (NULLIF(b->'cost_center_id', 'null'::jsonb) #>> '{}')::uuid, (b->>'setup_related')::boolean,
         CASE WHEN COALESCE(jsonb_typeof(b->'amount'), 'null') = 'null' THEN NULL ELSE (b->>'amount')::numeric END,
         CASE WHEN COALESCE(jsonb_typeof(b->'planned_hours'), 'null') = 'null' THEN NULL ELSE (b->>'planned_hours')::numeric END
  FROM jsonb_array_elements(v_d.payload->'budgets') b;
  INSERT INTO wardah_internal.mfg_cost_policy_pool_ext_205 (policy_version_id, org_id, pool_code, activity)
  SELECT v_version_id, p_org_id, e->>'pool_code', e->>'activity' FROM jsonb_array_elements(v_pools_src) e;
  INSERT INTO wardah_internal.mfg_cost_policy_pool_budgets_205 (policy_version_id, org_id, pool_code, budget_code)
  SELECT v_version_id, p_org_id, e->>'pool_code', x #>> '{}'
  FROM jsonb_array_elements(v_pools_src) e CROSS JOIN LATERAL jsonb_array_elements(e->'budgets') x;
  INSERT INTO wardah_internal.mfg_cost_policy_setup_acks_205 (policy_version_id, org_id, pool_code, budget_code)
  SELECT v_version_id, p_org_id, a->>'pool_code', a->>'budget_code'
  FROM jsonb_array_elements(COALESCE(NULLIF(v_d.payload->'setup_acks', 'null'::jsonb), '[]'::jsonb)) a;
  IF v_req IS NOT NULL THEN
    INSERT INTO wardah_internal.mfg_cost_policy_unallocated_exceptions_205
      (policy_version_id, org_id, draft_id, budgets, reason, treatment, approved_by, policy_at_approval)
    VALUES (v_version_id, p_org_id, v_d.id,
            (SELECT jsonb_object_agg(u.key, (u.value::numeric / 100)::numeric(18,2))
             FROM jsonb_each_text(v_check->'unallocated') u),
            btrim(v_req->>'reason'), btrim(v_req->>'treatment'), v_uid, v_policy);
  END IF;
  IF v_d.kind = 'legacy_resolution' THEN
    INSERT INTO wardah_internal.mfg_cost_policy_legacy_resolutions_205
      (policy_version_id, org_id, draft_id, reason, created_by, approved_by)
    VALUES (v_version_id, p_org_id, v_d.id, v_d.reason, v_d.created_by, v_uid);
  END IF;
  INSERT INTO wardah_internal.mfg_cost_policy_approvals_205
    (org_id, draft_id, kind, policy_version_id, created_by, approved_by, draft_revision, self_approved,
     self_approval_enabled_at_approval, unallocated_policy_at_approval)
  VALUES (p_org_id, v_d.id, v_d.kind, v_version_id, v_d.created_by, v_uid, v_d.revision, v_self,
          (v_settings->>'self_approval_enabled')::boolean, v_policy);
  UPDATE wardah_internal.mfg_cost_policy_drafts_205
  SET status = 'approved', decided_by = v_uid, decided_at = now(), result_version_id = v_version_id
  WHERE id = v_d.id;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, v_uid, 'manufacturing.cost_policy.approve', 'mfg_cost_policy_version', v_version_id::text,
          NULL, wardah_internal.mfg_cost_policy_version_v_205(v_version_id),
          jsonb_build_object('source', 'rpc_approve_mfg_cost_policy_draft_205', 'migration', 205,
                             'draft_id', v_d.id, 'kind', v_d.kind, 'draft_revision', v_d.revision, 'self_approved', v_self,
                             'settings_at_approval', v_settings, 'unallocated', v_check->'unallocated'));
  RETURN jsonb_build_object('draft_id', v_d.id, 'status', 'approved', 'policy_version_id', v_version_id,
                            'self_approved', v_self, 'unallocated', v_check->'unallocated',
                            'exception', v_check->'exception');
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_approve_mfg_cost_policy_draft_205(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_approve_mfg_cost_policy_draft_205(uuid, uuid, integer) TO authenticated;

-- 205-Q1: self-approval on or off, by an explicit assigned key, with a reason; audited.
CREATE FUNCTION public.rpc_set_cost_policy_self_approval_205(p_org_id uuid, p_enabled boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_old jsonb;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.mfg_cost_policy_has_assigned_205(p_org_id, 'manufacturing.cost_policy.approval_settings.manage') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'COST_POLICY_APPROVAL_SETTINGS_DENIED';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: enabled';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_SETTING_REASON_REQUIRED';
  END IF;
  PERFORM wardah_internal.mfg_cost_policy_lock_org_205(p_org_id);
  v_old := wardah_internal.mfg_cost_policy_settings_205(p_org_id);
  IF (v_old->>'self_approval_enabled')::boolean = p_enabled THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_SETTING_UNCHANGED';
  END IF;
  INSERT INTO wardah_internal.mfg_cost_policy_approval_settings_205 (org_id, self_approval_enabled, updated_at, updated_by)
  VALUES (p_org_id, p_enabled, now(), auth.uid())
  ON CONFLICT (org_id) DO UPDATE
    SET self_approval_enabled = EXCLUDED.self_approval_enabled, updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;
  INSERT INTO wardah_internal.mfg_cost_policy_approval_settings_audit_205
    (org_id, setting, old_value, new_value, changed_by, reason)
  VALUES (p_org_id, 'self_approval_enabled', v_old->>'self_approval_enabled', p_enabled::text, auth.uid(), btrim(p_reason));
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.cost_policy.settings', 'mfg_cost_policy_approval_settings', p_org_id::text,
          v_old, wardah_internal.mfg_cost_policy_settings_205(p_org_id),
          jsonb_build_object('source', 'rpc_set_cost_policy_self_approval_205', 'migration', 205, 'reason', btrim(p_reason)));
  RETURN wardah_internal.mfg_cost_policy_settings_205(p_org_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_set_cost_policy_self_approval_205(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_set_cost_policy_self_approval_205(uuid, boolean, text) TO authenticated;

-- 205-Q4: block or controlled exception. Only the org admin of this company who also holds the
-- explicit key; no platform override. Later approvals only: an approved version is never reopened.
CREATE FUNCTION public.rpc_set_cost_policy_unallocated_policy_205(p_org_id uuid, p_policy text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_old jsonb;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT (public.wardah_is_org_admin(p_org_id)
          AND wardah_internal.mfg_cost_policy_has_assigned_205(p_org_id, 'manufacturing.cost_policy.unallocated_policy.manage')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'COST_POLICY_UNALLOCATED_POLICY_DENIED';
  END IF;
  IF p_policy IS NULL OR p_policy NOT IN ('block','controlled_exception') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_UNALLOCATED_POLICY_INVALID';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_SETTING_REASON_REQUIRED';
  END IF;
  PERFORM wardah_internal.mfg_cost_policy_lock_org_205(p_org_id);
  v_old := wardah_internal.mfg_cost_policy_settings_205(p_org_id);
  IF v_old->>'unallocated_budget_policy' = p_policy THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_SETTING_UNCHANGED';
  END IF;
  INSERT INTO wardah_internal.mfg_cost_policy_approval_settings_205 (org_id, unallocated_budget_policy, updated_at, updated_by)
  VALUES (p_org_id, p_policy, now(), auth.uid())
  ON CONFLICT (org_id) DO UPDATE
    SET unallocated_budget_policy = EXCLUDED.unallocated_budget_policy, updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;
  INSERT INTO wardah_internal.mfg_cost_policy_approval_settings_audit_205
    (org_id, setting, old_value, new_value, changed_by, reason)
  VALUES (p_org_id, 'unallocated_budget_policy', v_old->>'unallocated_budget_policy', p_policy, auth.uid(), btrim(p_reason));
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.cost_policy.settings', 'mfg_cost_policy_approval_settings', p_org_id::text,
          v_old, wardah_internal.mfg_cost_policy_settings_205(p_org_id),
          jsonb_build_object('source', 'rpc_set_cost_policy_unallocated_policy_205', 'migration', 205, 'reason', btrim(p_reason)));
  RETURN wardah_internal.mfg_cost_policy_settings_205(p_org_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_set_cost_policy_unallocated_policy_205(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_set_cost_policy_unallocated_policy_205(uuid, text, text) TO authenticated;

-- Read-only worked example under a stored version, through the computation the engine will use.
-- A legacy version without a resolution is refused (COST_POLICY_LEGACY_UNRESOLVED).
CREATE FUNCTION public.rpc_preview_mfg_cost_absorption_205(
  p_org_id uuid, p_policy_version_id uuid, p_work_center_id uuid, p_hours jsonb,
  p_recorded_labor_cost numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT (wardah_internal.mfg_cost_policy_can_read_204(p_org_id)
          OR COALESCE(public.has_permission(auth.uid(), p_org_id, 'manufacturing.cost_policy.approve'), false)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_READ_DENIED';
  END IF;
  RETURN wardah_internal.mfg_cost_policy_compute_205(
    p_org_id, p_policy_version_id, p_work_center_id, p_hours, p_recorded_labor_cost);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_preview_mfg_cost_absorption_205(uuid, uuid, uuid, jsonb, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_preview_mfg_cost_absorption_205(uuid, uuid, uuid, jsonb, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Postflight.
-- ---------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_sig text;
BEGIN
  IF (SELECT count(*) FROM public.permissions WHERE permission_key LIKE 'manufacturing.cost_policy.%') <> 4
     OR EXISTS (SELECT 1 FROM public.permissions WHERE permission_key LIKE 'manufacturing.cost_policy.%'
                AND COALESCE(public.wardah_is_sensitive_permission(permission_key), false)) THEN
    RAISE EXCEPTION 'M205_POSTFLIGHT_PERMISSIONS';
  END IF;
  FOR v_sig IN
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wardah_internal' AND p.proname LIKE '%\_205%' ESCAPE '\'
  LOOP
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE') OR has_function_privilege('anon', v_sig, 'EXECUTE')
       OR has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'M205_POSTFLIGHT_INTERNAL_EXPOSED: %', v_sig;
    END IF;
  END LOOP;
  FOR v_sig IN
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'rpc\_%\_205' ESCAPE '\'
  LOOP
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') OR has_function_privilege('anon', v_sig, 'EXECUTE')
       OR has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'M205_POSTFLIGHT_RPC_ACL: %', v_sig;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'rpc\_%\_205' ESCAPE '\') <> 10 THEN
    RAISE EXCEPTION 'M205_POSTFLIGHT_RPC_COUNT';
  END IF;
END
$postflight$;
