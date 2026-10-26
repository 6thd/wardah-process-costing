# M204 Production application — 2026-10-26

**Status: applied once to Production `uutfztmqvajmsxnrqeiv` on 2026-10-26 (window 07:30–07:54 UTC; the single `apply_migration` call 07:50:05–07:50:13 UTC).**
Every pre-registered check passed and the owner closed the application phase after an independent read-only review. This record states what was
applied and checked, and what it does **not** establish. It contains no connection data, no business data and no raw evidence; the sealed evidence
is kept outside the repository and is referenced below by name and SHA-256 only.

## What was applied

Source bytes: `sql/migrations/204_manufacturing_cost_policies.sql` of `main@59744709d673f4699cab2c81dc3c758dd7e86ac4` (PR #325 merged), blob
`851fe056b9668530c376ee81b0c20e653e05a42d`, re-read from `main` and compared at the start of the window. Sent once through `apply_migration`
(no retry); the client checked size, SHA-256, strict UTF-8, final LF, no CR, and that the serialized request decodes back to the file before sending.

| File | Bytes | SHA-256 | Ledger version | `statements` / bytes / SHA-256 of `statements[1]` | Catalog signature after | Answer |
|---|---|---|---|---|---|---|
| `sql/migrations/204_manufacturing_cost_policies.sql` | 53841 | `b2d6a063a1bbc8f3f0cea58e12e3cf680f5dedd9a7a44c04cab019fd1b45e7a2` | `20261026075012` | 1 / 53841 / matches file | `1e7fdee3d130bc90…` = expected E_11 | HTTP 200, `{"success":true}` |

Ledger after the window: **97 rows** (96 before; 204 once, no other change). Signature before: `0ff30477a6dd662e…` = E_10.

| Phase | Checks / failed |
|---|---|
| Opening (w2: tools and project) | 3/0 |
| W-4 (ledger = the read after 203, no row 204; E_10; quiet sessions; 195 containment) | 11/0 |
| B204 (backup taken in the window, local restore gate) | 3/0 |
| pre 11 | 44/0 |
| post 11 (one new ledger row by name, size and SHA-256; earlier rows unchanged; E_11; F204 objects, owners, ACL and triggers; containment) | 50/0 |
| final | 3/0 |

Window state: no HALT, no driver stop.

## B204

`pg_dump` of Production after W-4 and before step 11, roles without passwords, and TOC, kept in an owner-only local vault. Restored into a
local disposable PostgreSQL 17 database: restore without error or warning; compared sections equal; the six B204 state assertions (whole earlier
ledger kept, distinct rows, no row 204, role 202 present, `validate_mo_transition` and maintenance version as after 203) held. Gate:
PASS at 2026-10-26T07:49:16.114597Z.

## What this does not establish

- **Restore to Production.** B204 was restored only locally; a restore of the hosted project was never tried. B204 is the state before 204.
- **The cost engine or completion.** 204 is the per-company policy layer and one compute function. It does not compute stage costs, write
  `stage_costs` or post journals: #260 (stage costing) and #230 (atomic completion) remain open, separate and blocking.
- **Client readiness and E2E.** Database deployment is independent of the Vercel deployment of the web client. No writer or user was resumed;
  the 195 containment is in force. The cost-policy UI (#327) and any E2E evidence are separate.
- **Older descriptions.** Statements written before 2026-10-26 that 204 is "repository only / not applied" (including the PR #325 description
  and the weekly brief of 2026-10-26) describe the state at the time they were written; this record supersedes them for current Production status.

## Evidence (outside the repository)

| Item | SHA-256 of its `SHA256SUMS` |
|---|---|
| Window run `evidence_window_204_20261026T073028Z` | `d9ab601d55f48c5b91ed28822da98487e64b8e194840c9f23f57c8a6e0db70fc` |
| Window package r2 `window_package_204_r2` | `a6563ed8ef09c616d208029b665cd203fed73b51b2f36d98efc26f9a5d5f18a1` |
| Approvals and pre-window checks `work_phase_t10_w204_window_20261024T143756Z` | `ea260b41b4c186101ecd533a22d5571d4a611752e0d93564923245a5bd76ea72` |
| Evidence register v39 | `e04ad0b8b3a8409f5814aede4fe7b7e7a0d9fe601292d557a9e36c5535de82c1` |
