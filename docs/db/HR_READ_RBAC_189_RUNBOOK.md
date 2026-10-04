# HR exact read RBAC — Migration 189

## Status

- Parent tracking: Issue #156.
- Dependency exposed by: OQ-10 in the AI Simulation Lab review for PR #221.
- Repository migration: `sql/migrations/189_hr_read_rbac_alignment.sql`.
- Base contract: Production/Baseline cutoff 188.
- Production: **not applied**. Applying it requires a separate explicit approval
  after the migration PR is reviewed, merged, and verified on `main`.

## Confirmed mismatch

Migration 188 intentionally preserved the previous confidentiality boundary
while repairing multi-organization RLS. Five `SELECT` policies therefore remain
admin-only even though the RBAC catalog, route guards, service consumers, and UI
tests all recognize exact read permissions:

| Tables | Exact permission |
|---|---|
| `payroll_runs`, `payroll_details`, `employee_salary_structures` | `hr.payroll.read` |
| `attendance_records` | `hr.attendance.read` |
| `employee_leaves` | `hr.leaves.read` |

The failure is fail-closed but misleading: `has_permission(...)` returns true,
the application issues the read, and RLS returns zero rows because the caller is
not an organization administrator. That can present real data as an empty HR
dashboard/report.

## Chosen boundary

Migration 189 replaces only those five `SELECT` policy expressions with the
existing central helper:

```sql
public.has_permission((SELECT auth.uid()), org_id, '<exact-read-key>')
```

This preserves the helper's established behavior:

- caller identity must equal `auth.uid()`;
- ordinary grants require an active organization membership, active role,
  unexpired assignment, and exact permission-key match;
- ordinary read keys retain the existing org-admin and super-admin overrides;
- a membership in a second organization does not transfer a role grant there.

All 15 `INSERT`/`UPDATE`/`DELETE` policies remain byte-equivalent in authority:
they continue to use `wardah_is_org_admin(org_id)`. The migration changes no
table rows, functions, grants, permission records, or application code.

## Deliberate exclusions

- Attendance write RPCs and HR write RLS remain in the broader #156 program.
- Payroll posting, settlements, SoD/self-approval, and dedicated settlement
  permission design remain in #156.
- FU-6 (transporting the UI-selected organization to implicit server consumers)
  is not changed; these policies authorize the `org_id` of each row directly.
- PR #221 remains separate and must not merge until 189 is applied and a real
  non-admin smoke confirms the Red/Green behavior.

## Red/Green evidence

The dedicated PostgreSQL 17 workflow builds cutoff 188 and creates only
synthetic fixtures. Before 189 it proves an ordinary active member has all three
exact permissions while all five protected reads return zero. After 189 it
proves:

1. the same reader sees one row from every mapped table in the granted org;
2. active membership alone in a second org exposes no confidential row;
3. `hr.attendance.read` does not unlock payroll or leave data;
4. a role with revoked permission rows exposes nothing;
5. an inactive membership invalidates a still-present role grant;
6. the existing org-admin override still works;
7. five read policies use `has_permission`, while all 15 mutation policies stay
   admin-only.

Evidence files:

- `.github/workflows/hr-read-rbac-189-acceptance.yml`
- `scripts/ci/fresh-db/setup_189_hr_read_rbac.sql`
- `scripts/ci/fresh-db/acceptance_189_hr_read_rbac_red.sql`
- `scripts/ci/fresh-db/acceptance_189_hr_read_rbac.sql`

## Production procedure — separate authorization required

1. Confirm the migration PR is merged and both repository and Production ledger
   end at the expected predecessor, 188.
2. Run the catalog preflight read-only and verify the five old admin-only SELECT
   policies plus the 15 unchanged admin-only mutation policies.
3. Obtain separate explicit Production-apply authorization.
4. Apply the exact merged migration transactionally.
5. Verify the catalog postflight and migration ledger row.
6. Run the Green suite inside a transaction ending in `ROLLBACK`, or use
   equivalent isolated non-Production identities.
7. Run Supabase security/performance advisors and retain raw evidence.
8. Generate the next Baseline only after Production verification.

## Rollback principle

Do not edit migration history. If a regression is found after application,
create a new additive migration restoring the five cutoff-188 SELECT policy
bodies from the published Baseline, then re-run tenant and RBAC acceptance.
