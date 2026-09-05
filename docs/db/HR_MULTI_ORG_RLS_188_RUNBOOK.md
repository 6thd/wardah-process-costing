# HR multi-organization RLS — Migration 188

## Status

- Issue: #222.
- Repository migration: `sql/migrations/188_hr_multi_org_rls.sql`.
- Base contract: Production/Baseline cutoff 187.
- Repository-only until a dedicated PR is reviewed and merged.
- No Production apply is authorized by the existence or merge of the PR.

## Confirmed defect

The cutoff-187 HR foundation contains three incompatible tenant-selection
patterns across all 19 HR tables:

| Family | Tables | Policies | Failure mode |
|---|---:|---:|---|
| Scalar membership without `LIMIT` | 3 | 11 | Two active memberships raise SQLSTATE `21000` |
| Unordered membership `LIMIT 1` | 8 | 32 | A valid second organization is hidden nondeterministically |
| `wardah_org_id(NULL)` fallback | 8 | 32 | Explicit client `org_id` is intersected with the fallback organization |

The first family is `employees`, `departments`, and `positions`. The second is
the eight P12 foundation tables (`hr_alerts`, `hr_attendance_monthly`,
`hr_payroll_account_mappings`, `hr_payroll_adjustments`, `hr_payroll_locks`,
`hr_policies`, `hr_settlement_lines`, and `hr_settlements`). The third is the
eight P13 tables rebuilt by Migration 101.

There is no partial unique constraint that limits a user to one active
membership. The UI intentionally loads and displays multiple active
memberships, so this is a reachable operating state.

## Chosen boundary

Migration 188 authorizes each row against its own `org_id`:

- ordinary active members retain read access to employee/definition rows via
  a correlated membership `EXISTS` check (`is_active IS TRUE`);
- the legacy `admin`/`manager` mutation gate remains byte-for-byte equivalent
  in meaning for the P12 tables;
- P13 confidential reads and all P13 mutations remain behind
  `wardah_is_org_admin(org_id)`;
- every policy is explicitly `TO authenticated`;
- a forged JWT organization cannot create membership.

This removes reliance on selecting one membership row. A client may filter on
Org A or Org B, while RLS independently proves that the caller is an active
member/admin of that exact row organization.

## Deliberate exclusions

- Migration 188 does not change `get_current_tenant_id()` or write a selected
  organization into JWT metadata. FU-6 remains relevant to RPCs and tables that
  still use the implicit effective-org resolver.
- It does not convert legacy HR roles to exact permission keys. That separate
  authorization redesign remains tracked in #156.
- It does not modify table data, memberships, grants, functions, or PR #221.

## Red/Green evidence contract

The dedicated workflow builds cutoff 187, inserts one user with two active
memberships, and proves the current `employees` policy raises the PostgreSQL
cardinality error. It then applies Migration 188 and verifies:

1. the same user reads explicitly selected Org A and Org B;
2. a non-member organization remains invisible, including with a forged claim;
3. inactive membership remains denied;
4. ordinary members cannot read confidential payroll or mutate manager rows;
5. an administrator can read confidential rows and mutate both member orgs;
6. `WITH CHECK` blocks reassignment to a non-member organization;
7. all 75 policies are authenticated-only and contain no scalar selector,
   unordered `LIMIT 1`, or `wardah_org_id` fallback.

Files:

- `.github/workflows/hr-multi-org-rls-188-acceptance.yml`
- `scripts/ci/fresh-db/setup_188_hr_multi_org_rls.sql`
- `scripts/ci/fresh-db/acceptance_188_hr_multi_org_rls_red.sql`
- `scripts/ci/fresh-db/acceptance_188_hr_multi_org_rls.sql`

## Production procedure — requires separate authorization

1. Confirm the merged repository migration and Production ledger still end at
   the expected predecessor, 187.
2. Run the catalog preflight read-only and compare the 75 expected policies.
3. Obtain a separate explicit Production-apply authorization.
4. Apply Migration 188 transactionally.
5. Run the Green acceptance against an isolated rollback fixture or equivalent
   authenticated smoke identities; do not inspect real employee payloads.
6. Run Supabase security/performance advisors and retain their raw output.
7. Generate and review the next Baseline only after Production verification.

## Rollback principle

Do not edit migration history. If a regression is found after application,
ship a new additive migration that restores the exact cutoff-187 policy bodies
captured in the preceding Baseline, then verify tenant isolation again.
