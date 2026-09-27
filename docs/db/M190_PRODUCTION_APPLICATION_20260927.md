# M190 — Production application and readback (2026-09-27)

**Project ref:** `uutfztmqvajmsxnrqeiv` (Manufacturing Process, PostgreSQL 17.6).  
**Repository source:** `main@dd04bc30a3ec1409d99a5cafe511ed1d79e65a9c`.  
**Canonical file:** `sql/migrations/190_material_consumption_authorization_boundary.sql`, SHA-256 `0fa0134569b09d88bc91aafc2bc6424947c498626f9b2726e6e706d1bf38ba2f`.  
**Live ledger version:** `20260927082227` (2026-09-27 11:22:27 Asia/Riyadh), name `190_material_consumption_authorization_boundary`.  
**Boundary:** M191 was **not** applied. Staging was **not** changed.

## Recovery point and preflight

The owner reported a private local `pg_dump` archive named
`wardah-production-uutfztmqvajmsxnrqeiv-before-m190.dump`.
The local agent reported a successful disposable PostgreSQL 17.11 restore with 133
`public` tables, ledger cutoff `189_hr_read_rbac_alignment`, and no migration
numbered 190 or higher. This is **owner/agent-reported recovery evidence**: the
archive, its checksum, and restore log were not transferred to or independently
inspected in this repository session. Keep the pre-M190 archive private and unchanged.

A fresh read-only Production query immediately before application showed cutoff
`189_hr_read_rbac_alignment`; neither 190 nor 191 was present. All six required
function signatures and the manufacturing module existed; the new exact permission
did not. The old `trigger_auto_backflush` was active. The existing
`material_consumption` INSERT/UPDATE/DELETE policies still had the old
`public` role scope. Product quantity/value versus same-org bin aggregates
returned zero mismatches, including nonzero value without a bin; cross-org bin
links, active stock ledger rows, and `validate_stock_balance` mismatches were
also zero. An independent earlier read-only review validated the full canonical ledger
through 189 and reported the runbook's pre-apply conditions. Its report did not
provide evidence of an ordinary-user grant rollout plan or a live Org Admin
behavioral test. Before apply, Production had one active Org Admin and no
material-consumption rows; after apply, zero roles hold the new permission.
Ordinary users therefore cannot consume materials until an explicit same-org
role grant is reviewed and assigned. The runbook's intended Org Admin bypass
remains a catalog/contract inference, not a Production user-session exercise.

## Application

The exact file above was submitted to Supabase `apply_migration` under its
canonical stem `190_material_consumption_authorization_boundary`. The tool
returned `success=true`. No M191 SQL was submitted. M190 itself wraps its
preflight, permission/policy/function changes, and in-transaction postflight
in one transaction, ending in `COMMIT`.

## Live post-commit readback

Executor-run read-only Production queries on 2026-09-27 and `list_migrations`
reported the following; an external reviewer later independently repeated
read-only catalog and stock checks:

| Gate | Production result |
|---|---|
| Ledger | Exactly one M190 row, version `20260927082227`; 83 total ledger rows; M191 absent |
| Exact permission | One `manufacturing.material_consumption.consume` with module `manufacturing`, resource `material_consumption`, action `consume` |
| Canonical v2 | Definition contains the exact permission; the three invalid UUID `min(...)` selectors are absent |
| Legacy backflush | Definition contains the exact permission and the retired-path exception; no direct material-consumption INSERT |
| Automatic trigger | `trigger_auto_backflush` absent |
| Direct table | One INSERT policy scoped to `authenticated` and exact permission; SELECT policy retained; UPDATE/DELETE policies absent |
| Grants | `authenticated` retains SELECT/INSERT, not UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER; `anon` has no mutation grant |
| New key rollout | Zero roles currently hold the new permission; no ordinary-user rollout grant was made |
| Wrapper RPCs | Four authenticated RPC EXECUTE checks passed; both compatibility wrappers delegate to v2 and showed no direct DML |
| Stock invariant | Zero active SLE rows and zero `validate_stock_balance` mismatches; with no active ledger movements, this is a limited baseline check |

These are catalog and data readbacks, **not** a live ordinary-user consumption
exercise. No Production fixture was created for behavioral acceptance.

## Next gate

M190 closes only the material-consumption authorization slice; retry/lifecycle
(#229), canonical backflush (#234), and manufacturing completion (#230) remain
open. M191 still requires a fresh live preflight, confirmation of this single
M190 ledger row and its postflight, a decision on the measured hot-SKU throughput
tradeoff (about -31.4%), and separate owner authorization. Staging's ledger and
catalog drift remain unresolved; the read-only review described in
[`MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md`](../architecture/MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md)
records Staging's noncanonical migration history. Its reported earlier
M190/M191 application is not an acceptance rehearsal for this Production chain. The generated `CLAUDE.md`
`DATABASE_STATE` block remains the historical cutoff-189 snapshot until the
baseline generator updates it; do not edit that block by hand.
