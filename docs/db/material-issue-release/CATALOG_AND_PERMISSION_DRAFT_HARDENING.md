# Preparation catalog and permission draft hardening

Scope: two previously disclosed follow-ups after the inventory-monitor closure at
`7df30c00ea1e96c678b17e241f6308ec70fdfce4`. No frozen writer/client contract,
SQL, migration package, workflow, generated types or release hold changes.

## Catalog reads

All seven existing org-scoped SELECTs use ascending UUID keyset pagination:
`id > last_id`, requested limit 500, stop only on an empty page. A server cap below
500 cannot be mistaken for the final page. Removing an already-read row cannot
shift an unread row behind an offset. Invalid IDs, foreign-org rows, duplicates,
unordered pages and a cursor that does not advance fail closed; identity is still
verified before and after the catalog read.

This is not a transactional snapshot across pages/tables. Concurrent insertion
behind the cursor, deletion or updates can still make a displayed catalog stale.
Displayed versions and the existing server checks remain authoritative; refresh
is required to pick up later catalog changes.

## Permission-bound unsent drafts

Both page branches key the preparation component by user/org and the effective
six preparation operation grants (prepare/reserve/release/order-create/order-update/
stage-create). A background snapshot can keep `loading=false`; changing any of
these grants nevertheless unmounts the unsent draft, closes its form and requires
explicit reopening and selection. Reordered/duplicate grants and unrelated keys
do not reset a valid draft. Release-only preparation remains reachable.

Durable pending events are not dismissed, rewritten or acknowledged. Recovery
keeps the existing identity/event rules. The consumption form, policy contract,
permission hook and all gateway persistence/reconciliation logic are unchanged.

## Reproduction and evidence

At the parent implementation, the catalog tests reproduce truncation at a 100-row
server cap and loss of an unread order after deletion between pages. The new
empty-page termination assertion also fails. With `loading=false` throughout,
three draft-reset tests fail before the fix (both consume branches and reserve
revocation with release remaining); the unrelated-grant preservation case passes.
After the correction, the five focused suites pass 109 tests. Type-check and
production-source ESLint pass; Python/JavaScript fixture syntax and diff checks
pass. Dependencies reuse the unchanged lockfile install; no timeout, assertion,
coverage threshold or suppression is weakened.

The loopback adapter uses the same cursor with allowlisted literal parameterized
SQL. The existing real-Auth fixture uses the genuine Supabase query builder. Both
browser modes now assert the closed preparation form and empty quantity after a
permission change, then explicitly reopen/reselect before the existing release
and denied-operation assertions. Existing database/state reconciliation checks
are retained. Fresh PG17/native-browser/vendor-Auth execution must be taken from
the exact-head Combined CI log; it was not rerun locally for this delta. The
100-row cap and concurrent deletion cases are unit simulations, not hosted tests.

Run locally:

```bash
npx vitest run src/services/manufacturing/__tests__/materialIssuePreparation.test.ts src/features/manufacturing/__tests__/material-issue-permission-draft.test.tsx src/features/manufacturing/__tests__/material-issue-preparation-ui.test.tsx src/features/manufacturing/__tests__/material-issue-ui.test.tsx src/features/manufacturing/__tests__/material-issue-operator-compatibility.test.tsx --coverage.enabled=false
npm run type-check
```

NO-GO remains: owner grant/device decisions, proposed 198 disposition, canonical
allocation/sign-off/application plan, target #278/compatibility/readback record,
deployment-specific identities/operator acceptance/reconciliation, monitoring
coverage and separate release approval. No Production/Staging or live DB access.
