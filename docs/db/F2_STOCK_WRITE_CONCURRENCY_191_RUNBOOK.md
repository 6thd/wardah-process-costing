# Migration 191 — F2 stock write concurrency closure (runbook)

One page. Design rationale lives in merged PR #236; the acceptance evidence lives in
`docs/db/m191-evidence/`. Neither is repeated here.

**Status: not applied to Production or Staging. No Production apply without separate
authorization.**

## What it does

Thirteen objects: the twelve stock-write predecessors now acquire a deterministic,
ascending product prefix through one new internal helper,
`wardah_lock_products_for_stock_write(uuid, uuid[])`.

The helper locks the requested products in ascending `products.id` order with
`FOR NO KEY UPDATE`, deduplicating and failing closed on a partial match. Ascending
order removes the crossed acquisition paths that produced real `40P01` deadlocks
between concurrent documents; `FOR NO KEY UPDATE` rather than `FOR UPDATE` keeps
foreign-key `FOR KEY SHARE` readers unblocked, so an unrelated child insert
referencing a locked product still proceeds.

The helper is `SECURITY INVOKER` on purpose: it must run with the privileges of the
`SECURITY DEFINER` RPC that calls it, and it is closed to `PUBLIC`, `anon` and
`authenticated`.

Business semantics, error text and error ordering of all twelve predecessors are
unchanged. `rpc_create_mo_with_reservation` additionally captures each line's resolved
product once and fails closed with `ITEM_PRODUCT_MAPPING_DRIFT` if the persisted
identity differs from the captured one.

## Prerequisites

| | |
|---|---|
| Baseline | cutoff **189** pair: `000_schema_baseline_20260905_184634.sql` + `001_system_reference_data_20260905_184634.sql` |
| Predecessor | **190** `material_consumption_authorization_boundary` — its permission contract is checked by 191's own preflight |
| Engine | **PostgreSQL 17.x**. The cutoff-189 baseline is a PG 17 dump that sets `transaction_timeout`; on PostgreSQL 16 it fails before any M191 byte is parsed |

191 opens with a preflight that fails closed if any required relation, any of the twelve
predecessor signatures, any canonical helper, or Migration 190's
`manufacturing.material_consumption.consume` contract is missing.

## Migration path

Single file, self-contained, applied in one transaction:

```
sql/migrations/191_f2_stock_write_concurrency_closure.sql
```

Order inside that transaction, which must not be rearranged:

```
BEGIN → preflight → Slice 11/A (pre-replace security capture)
      → helper → the twelve bodies with their ACL statements
      → Slice 11/B (security/ACL/S1 postflight) → COMMIT
```

Slice 11/A and 11/B are part of the transaction, not a postflight script. 11/A captures
the pre-replace catalog and 11/B compares against it; running the pair after the
migration has committed proves nothing, because 11/A's temp tables are `ON COMMIT DROP`
and a re-capture would compare the post-migration state with itself.

Apply order is simply `190 → 191`. Nothing else is required, and the name passed to
`apply_migration` is the file stem, `191_f2_stock_write_concurrency_closure`.

## Acceptance

Workflow: `.github/workflows/f2-stock-write-concurrency-191-acceptance.yml`
(PostgreSQL 17, two jobs; the second runs the rollback rehearsal).

Job 1 reproduces locally as:

```bash
createdb wardah_191
psql -v ON_ERROR_STOP=1 -d wardah_191 -f scripts/ci/fresh-db/supabase_shim.sql
psql -v ON_ERROR_STOP=1 -d wardah_191 -f sql/baseline/000_schema_baseline_20260905_184634.sql
psql -v ON_ERROR_STOP=1 -d wardah_191 -f sql/baseline/001_system_reference_data_20260905_184634.sql
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations 189 > /tmp/order.txt
REPORT=/tmp/chain.txt PGDATABASE=wardah_191 \
  bash scripts/ci/fresh-db/run_chain.sh sql/migrations /tmp/order.txt

python3 scripts/ci/test_check_definer_guards.py
python3 scripts/ci/check_definer_guards.py

psql -v ON_ERROR_STOP=1 -d wardah_191 -f scripts/ci/fresh-db/acceptance_191_f2_stock_write_concurrency.sql
psql -v ON_ERROR_STOP=1 -d wardah_191 -f docs/db/m191-slices/12_acceptance_gate_selftest.sql
psql -v ON_ERROR_STOP=1 -d wardah_191 -f docs/db/m191-slices/12_acceptance_static_gates.sql

export SCRATCH=docs/db/m191-evidence/harness PGDATABASE=wardah_191
for s in s4_core s5_valuation s6_prefix s7_fixcd s8_fixe s8c_uuid_parity \
         s8b_fixe s82_superset s82b s82c1 s9_fixf s10_fixg s10_2probe \
         s10_drift; do
  bash "$SCRATCH/$s.sh" || exit 1
done

psql -v ON_ERROR_STOP=1 -d wardah_191 -f scripts/ci/fresh-db/acceptance_191_reconciliation.sql
```

Every verdict is a psql or shell exit code. The gate selftest runs before the gate on
purpose: a static gate that cannot fail proves nothing, so the selftest first shows it
rejects fifteen known-bad shapes and accepts seven good ones, then emits a second verdict
(`M191_GATE_SELFTEST_REMEDIATION_PASS`) for the two assertions added by the final-review
remediation — the Fix F ordered reservation lock and the Fix E UUID parser parity.

The final-review remediation also added `s8c_uuid_parity.sh` (the Fix E brace-wrapped /
32-hex-hyphenless 2x2 matrix and its canonical-regex discriminator), sections 9.4 and 9.5
of `s9_fixf.sh` (the acquisition-order probe against the deployed
`release_expired_reservations` plus a DESC mutant derived from it), and
`scripts/ci/test_check_definer_guards.py`. Reproduction, RED mutant proof and GREEN proof
are in `docs/db/m191-evidence/M191_FINAL_REVIEW_REMEDIATION.md`. Migration 191's
production body was not changed by that work.

Run the reconciliation only on a database where the GREEN harness ran. The frozen F2 RED
proof deliberately leaves a product aggregate diverging from its bins — that is the
defect it demonstrates — so a database that also ran the RED proof will fail
reconciliation by design.

## Rollback rehearsal

`docs/db/m191-evidence/harness/rollback_rehearsal.sh`, result recorded in
`docs/db/m191-evidence/M191_ROLLBACK_REHEARSAL_EVIDENCE.txt`.

It restores the twelve predecessors from a live pre-191 database rather than from
historical migration files, drops the helper, proves the rolled-back catalog matches
that oracle exactly on definition, owner, security mode, `proconfig` and normalized ACL,
re-observes the frozen RED proof, then reapplies 191 and proves the thirteen-object
catalog returns byte-for-byte to its pre-rollback state. Rollback is therefore a
verified path, not an assumption.

## Out of scope

Migration 191 does **not** close the direct-client write surfaces on `products`,
`material_reservations` or `stock_adjustment_items`. Those are separate, pre-existing
debts and nothing in this migration or its evidence should be read as addressing them.

It also does not change `release_expired_reservations`'s broad historical EXECUTE
surface. That surface is carried forward unchanged and asserted as such, so any future
change to it is a deliberate decision rather than an accident.

### Declared scanner limitations and follow-up

The strict scanner contract for migrations numbered 191 onward is frozen for M191
acceptance at executable head `a5977e31c00b1f85bb909b144f06d3587065145a` with three
known false negatives tracked in [Issue #243](https://github.com/6thd/wardah-process-costing/issues/243).
The issue includes executable text-only reproductions and correction acceptance criteria.

- **Default client grants:** the closure model does not account for the baseline's
  direct default function grants to `anon` and `authenticated` for objects created
  by `postgres` or `supabase_admin`. Revoking only `PUBLIC` can therefore falsely
  pass. This is a priority follow-up because those defaults exist in this repository.
- **Schema-wide privileges:** `GRANT`/`REVOKE` on `ALL FUNCTIONS/ROUTINES IN SCHEMA`
  are not replayed against function identities; a later schema-wide grant can
  reopen a function that the scanner considers closed.
- **Custom denial SQLSTATE:** boolean membership deny branches are checked for
  swallowed P0001 exceptions, not their actual overridden SQLSTATE. A custom
  `ERRCODE` can be caught by a handler that the scanner treats as unrelated.

These are acceptance-tool limitations, not waived requirements for future migrations.
Until #243 closes, review affected ACLs and exception behavior explicitly and prove
them in an isolated PostgreSQL acceptance test; a scanner pass alone is insufficient.
The catalog contract covers its enumerated objects, not all future functions.

M191 does not activate these cases: its five internal helper signatures explicitly
revoke `PUBLIC`, `anon` and `authenticated` before granting `service_role`; the file
contains neither schema-wide privilege statements nor an `ERRCODE` override.
This does not claim that every M191 function is client-closed: callable RPCs retain
their reviewed authorization boundaries. M191 SHA256 remains
`637a81caeaebea60693476222611b373dc1e738cd6b10c634bf4c236227f3f40`.
Freezing this implementation does not settle the separate Codacy/CodeFactor gates
or authorize merging #241 to main or applying M191 to Production/Staging.

## Post-apply verification

After a Production apply — which requires separate authorization — confirm the ledger
row and the live contract:

```sql
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '191_f2_stock_write_concurrency_closure';

SELECT p.oid::regprocedure::text, p.prosecdef, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'wardah_lock_products_for_stock_write';
```

The helper must be present, `prosecdef = false`, with a hardened `search_path`, and must
not be executable by `PUBLIC`, `anon` or `authenticated`. Update the Baseline only after
191 appears in the Production ledger, through the dedicated workflow and a separate PR.
