# M202 / F1 — evidence-backed dispositions of the remaining review points

**Scope:** PR #316 (Draft), repository only. Base `main@af8c91ccfe2947cf8e799e46f71d65280092452c`.
Assessed on top of frozen head `8babdd6f8de45d023dde722b01e24fc4383d6f21`; the listing change and test additions
described in §E6 are in the commit that adds this document.
**Not in scope / not claimed:** Production, Staging, hosted Supabase, the G05 pause fence, any application of
195–202, merge or Ready. All timings are *measured characterization on a disposable local cluster*, not a service
level objective.

**Provenance.** Executor-run, disposable PostgreSQL 17.11 (PGDG packages) on a local cluster. Raw logs and raw
timing samples are under [`evidence-f1-assessment/`](evidence-f1-assessment/). Logs of runs that were found to be
invalid (a mislabeled variant, an unquoted-argument harness error, an aborted worker restart) are kept in
`evidence-f1-assessment/superseded/` with a header saying why they are superseded; they are not cited as evidence.

## Summary of dispositions

| # | Review point | Real repository-acceptance blocker? | Disposition | Smallest proof / fix |
|---|---|---|---|---|
| E1 | SELECT policies / `FORCE RLS` / owner boundary | **No** | Owner-boundary and hosted-attribute question; operational gate | Read-only catalog readback in the local-clone rehearsal (§E1) |
| E2 | Unpinned `wardah_assert_org_member` body; closed effective execution graph | **No** | Graph measured closed for the entry-role identity; shared helper is apply-time pinned by design | Same readback for helper owner/ACL/`search_path` (§E2) |
| E3 | List status under corrupt authority links / NULL or prior QC cycle | **No** — the gate refuses; a documented informational limitation of a read RPC, not a merge blocker | Documented limitation; an additive `authority_corrupt` field is an optional owner decision | Additive field + acceptance, only if chosen (§E3) |
| E4 | Internal FK-trigger scope of the structural fingerprint | **No** | Test-scope limit; superuser-only; the write guard still blocks writes | Optional test-only extension (§E4) |
| E5 | Counters / audit / full-restore scope | **No** | INSERT-only restore of the QC family proven gate- and list-identical; full `pg_dump`/`pg_restore` is a local-clone rehearsal | Rehearsal on Mojahed's local clone (§E5) |
| E6 | Insert/list performance | **Yes — a measured defect in the listing (fixed here)**; assertion cost is a characterized, accepted cost | Listing rewritten (narrow ranking → bounded page → enrichment); exact equivalence to the frozen listing proven | §E6 |
| — | Codacy `action_required` | Yes (trivial lint) — fixed | Unused assignment `P=` removed from `type_shadow_regression.sh` | §Codacy |
| — | 57 Sonar "new issues" | **No** | All 57 are `plsql:S1192` (duplicated string literal) code smells; Quality Gate passed | §Sonar |

## E1 — SELECT policies, `FORCE ROW LEVEL SECURITY`, owner boundary

**Threat / contract.** A SELECT policy predicate that calls a function would run for any reader that is subject to
RLS. If such a reader were a *postgres-owned* `SECURITY DEFINER` function (prepare helper, evaluator, listing)
under `FORCE ROW LEVEL SECURITY` and a table owner that does not bypass RLS, the predicate would run with owner
rights before any INSERT reaches the write guard. The M202 contract pins the INSERT policy shape, not SELECT
policies or the FORCE flag.

**Evidence** (`evidence-f1-assessment/E1_owner_rls.log`, PG 17.11):
- `quality_inspections`: owner `postgres`, `relrowsecurity = true`, `relforcerowsecurity = false`. Policies:
  the pinned entry INSERT policy and `quality_inspections_select_policy` (TO PUBLIC, org-membership predicate).
- `postgres` is `rolsuper = true`, `rolbypassrls = true` on the disposable cluster; `anon`, `authenticated`,
  `wardah_qc_entry_202` do not bypass RLS; `service_role` has `BYPASSRLS` but no table privilege.
- None of `anon`/`authenticated`/`service_role`/the entry role holds SELECT on the table, none is the owner or a
  member of the owner role: policy DDL (which needs ownership or superuser) is not available to them.
- Mechanism probe (scratch DB, the pre-existing SELECT policy dropped only to isolate the probe): a definer
  function owned by a non-superuser owner reads the table. **Predicate ran: no** with FORCE off (owner exempt);
  **yes** with FORCE on and owner `NOBYPASSRLS`; **no** with FORCE on and owner `BYPASSRLS`.

**Disposition.** Not a repository blocker. The condition needs an owner/DDL administrator (already the documented
boundary of the guard) *and* an owner without BYPASSRLS *and* FORCE RLS. Whether the hosted `postgres` role
bypasses RLS is **unverified** — a fact about the hosted platform, not a defect in the SQL.
**Smallest proof:** during the local-clone rehearsal, read back `rolsuper`, `rolbypassrls` for `postgres`, `relforcerowsecurity`
and the policy list of `quality_inspections`; no new code. Pinning FORCE/SELECT policies in the runtime assertion
was considered and rejected for this round: it would change pinned function bodies for a threat that already
requires the owner.

## E2 — `wardah_assert_org_member` body and the effective execution graph

**Threat / contract.** The entry-role RPC executes with the entry role's rights. Any function it calls that runs
*as the entry role* (SECURITY INVOKER or built-in) is part of the entry-role graph; definers it calls run as their own
owners. The closed-graph assertion body-pins the RPC, prepare helper, evaluator and guard, and only ACL-allowlists
`wardah_assert_org_member`.

**Evidence** (`E2_exec_graph.log`):
- RPC: owner = entry role, `SECURITY DEFINER`, `search_path = pg_catalog, pg_temp`.
- Callee identifiers in the RPC body: three `pg_catalog` built-ins (`jsonb_build_object`, `pg_backend_pid`,
  `pg_current_xact_id`) and schema-qualified references only — `public.wardah_assert_org_member`,
  `wardah_internal.evaluate_quality_release_199`, `wardah_internal.qc_prepare_inspection_202` and the three guarded tables.
  Nothing is resolved through an unqualified, non-catalog name.
- Entry-role EXECUTE grants: exactly the helper, prepare, evaluator, the assertion and the RPC; owners are `postgres` except the RPC.
- `wardah_assert_org_member`: owner `postgres`, `SECURITY DEFINER`, `search_path = public, pg_temp`; its body (printed in the log)
  checks `auth.uid()` and `user_organizations` only. Apply-time preflight pins its digest (`33c67e93…`).
- Negative controls run: a non-owner `CREATE OR REPLACE` of the helper is refused (`must be owner of function`);
  `authenticated` cannot replace the RPC (`permission denied for schema public`); a same-named `pg_temp` function is
  harmless because the helper's `search_path` resolves `public` first.

**Disposition.** Not a blocker. The helper is a *shared* function that later migrations may legitimately change;
runtime body-pinning would turn any such change into a QC write outage. Replacing it needs ownership of the function
(the owner boundary). **Smallest proof:** in the local-clone rehearsal read back the helper's owner, ACL, `prosecdef`
and `search_path` (read-only).

## E3 — listing status under corrupt links, NULL cycle and prior cycle

**Contract.** The release **gate** (`evaluate_quality_release_199`) is authoritative; the listing is informational and
partition-relative. **Evidence** (`E3_list_vs_gate.log`, measured on the 202 chain):

| Scenario | Gate | Listing |
|---|---|---|
| FINAL with `qc_cycle` NULL (cycle 1 current) | `QUALITY_RELEASE_REQUIRED` (row ignored) | row `CURRENT` |
| Cycle 1 superseded without replacement, then cycle 2 passes | `ready = true` | cycle-1 row `SUPERSEDED_AWAITING_REPLACEMENT` |
| Authority revision 5 on a partition that never passed 0 | `QUALITY_AUTHORITY_CORRUPT` (blocked) | corrupt row `CURRENT`, listed first |
| Authority link with another org | `QUALITY_AUTHORITY_CORRUPT` | `CURRENT` |
| IN_PROCESS link beyond its partition, scope `final_only` | `ready = true` (stages not evaluated) | `CURRENT` |

Corrupt links can only be created by an owner/superuser who disables the guard (or by a mistaken restore); the
gate is fail-closed on them. **Client scope:** the web client does not call `rpc_list_quality_inspections` (only the
generated type mentions it); `src/services/manufacturing/mesService.ts` reads/inserts `quality_inspections`
directly, which M199 already closed to `authenticated` — a consumer misalignment for the G07 UI step, not this PR.
**Disposition.** A documented informational limitation of the read RPC, not a merge blocker (the gate is fail-closed). An additive
`authority_corrupt` row field computed with the evaluator's predicates would remove it; it is an optional owner decision, easiest
before first application because the listing shape is client-visible.

## E4 — internal FK-trigger scope of the fingerprint

**Evidence** (`E4_internal_triggers.log`): `DISABLE TRIGGER ALL` changes the fingerprint (it also disables the guard).
Disabling *only* the internal `RI_ConstraintTrigger_*` triggers (superuser required — a non-superuser owner gets
`is a system trigger`) leaves the fingerprint **unchanged**. In that state an orphan insert is still refused — but by the
**provenance guard** (`QC_WRITE_PROVENANCE_REQUIRED_202`), which shows the guard does not depend on the FK; it is *not* a
demonstration of FK enforcement. FK enforcement is proven by the dedicated test in the INSERT-only rehearsal
(`history_rehearsal.sql`, window check *"an authority link without its inspection violates the foreign key"*, expecting
`violates foreign key constraint`, with the guard disabled and the FK triggers enabled); FK validity (`convalidated`) is in
the fingerprint and re-checked after the commit. **Disposition.** Test-scope limit, not a blocker: the guard, not the FK,
is the write-path protection. An optional test-only extension (enabled state of internal triggers) is possible if reviewers want it.

## E5 — counters, audit history and full-restore scope

**Evidence** (`E5_family_restore.log`): a source with FINAL PASS → admin supersession → genuine FAIL at revision 1, and
a second MO superseded and left awaiting, was restored INSERT-only into an empty target (inspections + authority
under the documented two-trigger procedure; supersessions by plain INSERT — they have no write guard). Gate JSON
and list JSON from the restored target are **identical** to the source, with and without restoring
`quality_inspection_counters`; the next number assigned after restore is `QI-000004` in all cases (M199 skips held
numbers). `audit_logs` rows are *not* carried by this subset (source 9 quality-related rows, target 5).
**Disposition.** Not a blocker. What an INSERT-only load does not prove — table bodies from a real dump, sequences,
audit history, `mo_quality_cycles`/policy rows, ownership after `pg_restore` — belongs to the local-clone rehearsal
using the practice recorded in the M191/M192/M194 application records.

## E6 — performance

### Characterization before the change (controlled, identical clones)

Fixture shapes: 10,000 MOs × 5 rows (50,000), 1,000 × 5 (5,000), 200 × 250 (50,000). Each base database was loaded once and
`VACUUM ANALYZE`d; every A (M199) / B (variant) clone made from it then ran a plain `ANALYZE` (no `VACUUM`) before timing, so A and B have
identical row counts (logged per run). B is the migration under test applied to the clone; before any timing the *installed*
`public.rpc_list_quality_inspections` is read back from `pg_proc` for both A and B and the run aborts unless B's
`md5(prosrc)` equals the expected digest (old = frozen `bb2432f528a97ebb7f4d75a3e5b2f585`; new = `3ef747d991d0f1efe10c67c292697037`,
the digest of the optimized source), `prosecdef = true`, `proconfig = {"search_path=public, pg_temp"}`, three arguments, and A ≠ B.
Measurement: 5 alternating A/B sessions × 5 warm timed calls (first call of each fresh session discarded, one global warm-up)
= 25 samples per variant/query; all raw samples are in `evidence-f1-assessment/E6k_raw_samples/`, the full log and this table in
`E6k_paired_before_after_FINAL.log` / `E6k_table.md`.

A first `OLD`-labelled attempt (E6i) was invalid because a harness bug applied the *new* migration to every variant; an earlier
run (E6g) was controlled but did not read back the installed function; E6j read back only the digest. All are kept under
`superseded/` and none is cited.

| Variant (B) | Fixture | Query | n | M199 p50 / p90 / max (ms) | B p50 / p90 / max (ms) | B/M199 p50 |
|---|---|---|---|---|---|---|
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 393.8 / 421.0 / 428.9 | 1568.9 / 1643.2 / 1666.0 | 3.98x |
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 5/MO | org-wide limit 500 | 25 | 399.5 / 444.0 / 451.5 | 1559.3 / 1637.4 / 1718.1 | 3.90x |
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.2 / 1.6 / 1.7 | 2.1 / 3.7 / 4.6 | 1.73x |
| OLD M202 (frozen 8babdd6f), default JIT | 5,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 41.0 / 44.4 / 46.5 | 111.1 / 116.0 / 122.0 | 2.71x |
| OLD M202 (frozen 8babdd6f), default JIT | 5,000 rows, 5/MO | org-wide limit 500 | 25 | 42.9 / 47.4 / 75.2 | 112.1 / 118.9 / 134.4 | 2.61x |
| OLD M202 (frozen 8babdd6f), default JIT | 5,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.3 / 1.7 / 2.1 | 2.0 / 3.4 / 3.9 | 1.60x |
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 250/MO | org-wide limit 100 (default call) | 25 | 379.5 / 401.4 / 410.3 | 1571.0 / 1651.8 / 1723.6 | 4.14x |
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 250/MO | org-wide limit 500 | 25 | 388.4 / 434.7 / 467.0 | 1610.4 / 1718.9 / 1776.4 | 4.15x |
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 250/MO | MO-scoped limit 100 | 25 | 3.9 / 4.4 / 4.5 | 58.1 / 60.5 / 65.7 | 14.83x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 393.5 / 432.1 / 451.6 | 591.8 / 626.0 / 649.0 | 1.50x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 5/MO | org-wide limit 500 | 25 | 380.9 / 402.7 / 408.8 | 586.9 / 631.4 / 648.8 | 1.54x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.2 / 1.6 / 1.7 | 2.0 / 3.7 / 3.8 | 1.72x |
| OLD M202, jit=off (diagnostic only) | 5,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 41.4 / 43.8 / 49.7 | 64.3 / 70.1 / 94.2 | 1.55x |
| OLD M202, jit=off (diagnostic only) | 5,000 rows, 5/MO | org-wide limit 500 | 25 | 43.1 / 46.4 / 47.1 | 63.5 / 66.7 / 68.6 | 1.47x |
| OLD M202, jit=off (diagnostic only) | 5,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.1 / 1.5 / 1.7 | 2.0 / 3.4 / 3.5 | 1.77x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 250/MO | org-wide limit 100 (default call) | 25 | 392.4 / 420.7 / 439.2 | 617.7 / 634.5 / 679.6 | 1.57x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 250/MO | org-wide limit 500 | 25 | 387.5 / 408.3 / 451.3 | 621.3 / 661.4 / 670.3 | 1.60x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 250/MO | MO-scoped limit 100 | 25 | 3.7 / 3.9 / 4.4 | 6.0 / 7.6 / 8.0 | 1.63x |
| NEW M202 (optimized), default JIT | 50,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 397.7 / 437.9 / 479.4 | 82.1 / 87.8 / 94.2 | 0.21x |
| NEW M202 (optimized), default JIT | 50,000 rows, 5/MO | org-wide limit 500 | 25 | 398.5 / 430.2 / 449.6 | 92.7 / 101.5 / 104.6 | 0.23x |
| NEW M202 (optimized), default JIT | 50,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.1 / 1.5 / 1.6 | 2.4 / 3.4 / 3.6 | 2.20x |
| NEW M202 (optimized), default JIT | 5,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 40.3 / 46.6 / 50.5 | 12.4 / 14.1 / 15.2 | 0.31x |
| NEW M202 (optimized), default JIT | 5,000 rows, 5/MO | org-wide limit 500 | 25 | 46.5 / 51.0 / 72.2 | 21.1 / 25.1 / 31.9 | 0.45x |
| NEW M202 (optimized), default JIT | 5,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.3 / 1.7 / 1.9 | 2.4 / 4.0 / 4.7 | 1.86x |
| NEW M202 (optimized), default JIT | 50,000 rows, 250/MO | org-wide limit 100 (default call) | 25 | 378.9 / 394.2 / 400.9 | 105.9 / 115.6 / 127.2 | 0.28x |
| NEW M202 (optimized), default JIT | 50,000 rows, 250/MO | org-wide limit 500 | 25 | 388.2 / 428.0 / 466.8 | 181.5 / 196.6 / 202.1 | 0.47x |
| NEW M202 (optimized), default JIT | 50,000 rows, 250/MO | MO-scoped limit 100 | 25 | 4.0 / 4.4 / 4.8 | 5.1 / 10.6 / 16.9 | 1.29x |

`jit=off` rows are a **diagnostic only** to separate JIT compilation from execution work; JIT is *not* disabled by the fix.
At 50,000 rows the default org-wide call (limit 100) took a median 1,569 ms on the old M202 listing, 592 ms with JIT off, 394 ms on M199 and 82 ms on the
optimized listing. So about 980 ms (≈ 83%) of the ≈ 1,175 ms regression was JIT compilation; the remaining ≈ 200 ms (1.5× M199) was execution.

### Where the time went (EXPLAIN ANALYZE, BUFFERS, full JIT lines)

`auto_explain` (ANALYZE, BUFFERS, nested statements, `jit` at its default) on the 50,000-row fixture, two calls of each, the heavier call shown (`jit_above_cost` 100000,
`jit_inline_above_cost`/`jit_optimize_above_cost` 500000, `work_mem` 4 MB); full plan text, including every JIT line, is in
`evidence-f1-assessment/E6l_plans_extract.txt` and the raw logs in `E6l_plans_raw/`.

| Org-wide call, limit 100 | Estimated cost | Statement | JIT | Buffers |
|---|---|---|---|---|
| M199 listing | 5,813 | 392.5 ms | none | 1,393 hit |
| **Old M202 (frozen)** | **1,626,722** | **1,741.4 ms** (Aggregate node 703 ms) | **93 functions; Inlining, Optimization, Expressions, Deforming; Generation 5.0 ms, Inlining 16.7 ms, Optimization 607.3 ms, Emission 414.0 ms, Total 1,043.1 ms** | 50,794 hit |
| **Optimized M202** | **16,809** | **109.9 ms** | none (cost below `jit_above_cost`) | 1,746 hit, temp read 448 / written 449 (3.6 MB external merge in the narrow ranking sort) |

The old plan's cost estimate — inflated by per-row lateral lookups and wide tuples carried through the window — was far above the JIT
thresholds, so the statement paid ≈ 1.04 s of JIT on top of ≈ 0.70 s of execution. The
optimized plan ranks narrow rows, applies the bounded page, and only then enriches ≤ 100–500 rows, which also brings the estimated cost under
the JIT threshold. MO-scoped calls: M199 0.2 ms, old M202 0.3 ms, optimized 0.6 ms under instrumentation (the benchmark table above has the
non-instrumented medians). The old plan's wide-tuple sort was only one of the contributors; JIT compilation was the largest single one.

### The change

`rpc_list_quality_inspections` now ranks **narrow** keys first (id, partition keys, authority revision, sequence)
with the same authority-aware window, takes the bounded page *after* the ranking, and only then builds the JSON,
joins MO/stage/profile and computes the partition status for at most 500 rows. Partition keys, ordering, status
semantics, clamps and error behaviour are unchanged. The `LIMIT` is applied after the authority-aware ranking.

**Equivalence proof** (`acceptance.sql` section F): the verbatim frozen `8babdd6f` body (digest
`bb2432f528a97ebb7f4d75a3e5b2f585`, installed under another name) is compared with the new function through the
same authenticated entry point for 117 org-wide / MO-scoped / unknown-MO / other-org × limit combinations
(`NULL, 0, -5, 1…500, 501, 100000`) on a dataset with >640 rows, NULL and 999 sequences, equal-sequence ties,
cross-partition head ties, interleaved stage/final partitions, superseded/awaiting rows and corrupt links.
Result: 0 mismatches (exact JSON, order and error text). Eight wrong-order / wrong-limit variants of the new function
(authority revision removed from the order; LIMIT before ranking; oldest-head-first; lower clamp removed; upper clamp
removed; QC cycle dropped from the partition key; rank collapsed; page cut ignoring in-partition rank) are each caught.

### Closed-graph assertion cost (characterized, not changed)

`qc_assert_closed_graph_202()` runs for each guarded INSERT (the inspection and its authority link): 2.28 ms with 22
roles, 3.67 ms with 122, 5.07 ms with 222 on this machine (grows with the role count over the three points measured, `E6ab_perf.log`; no complexity claim). A recording
RPC call measured 2.7 ms on the M199 chain and 11.1 ms on the M202 chain with 62 roles (not an identical-data comparison;
informational). This is the price of the fail-closed design; no change proposed.

## Codacy

Check `Codacy Static Code Analysis` = `action_required`; output title *"1 new issue (0 max.) of at least minor
severity."*. Codacy's public API for the PR returns the single issue: **ShellCheck SC2034, warning,
`docs/db/qc-privileged-write-closure-202/type_shadow_regression.sh` line 18, "P appears unused"** (`P="${PGDATABASE:-}"`).
Reproduced locally with ShellCheck 0.11.0. The assignment was genuinely unused and was removed; no suppression,
no analyzer change. After the change `shellcheck` is clean for all scripts in this directory.

## Sonar

Quality Gate passed. All 57 "new issues" are `plsql:S1192` (*Define a constant instead of duplicating this
literal*), `CRITICAL`, type `CODE_SMELL`, all in `sql/migrations/202_qc_privileged_write_closure.sql`
(`evidence-f1-assessment/sonar_issues_summary.txt`); 0 bugs, 0 vulnerabilities, 0 security hotspots. The duplicated
literals are SQL strings (role names, privilege names, `'FINAL'`, signatures). Replacing them with constants would
rewrite md5-pinned function bodies and the runbook digests for no behavioural gain, so they are left as is. The
listing rewrite reduces some duplicates; the exact count is re-evaluated by Sonar on push.

## Local-agent / backup procedure references (read; nothing obtained or transmitted)

`CLAUDE.md` contains no step-by-step procedure; its notes (M190…M194 "Live Production update" paragraphs) state that
backup/restore/rehearsal was performed by the **owner/local agent** and that the private archive/logs were *not
inspected* by the executor. The concrete practice is recorded in:
- `docs/db/M191_PRODUCTION_APPLICATION_20260928.md` ("Recovery point: owner/local-agent report"): custom-format
  `pg_dump -Fc` archive named `wardah-production-<ref>-after-mNNN-before-mMMM.dump`, size and SHA-256 recorded,
  `pg_restore --list` entry count, restore into a **fresh database created from `template0` on
  `supabase/postgres:17.6.1.175`** with `pg_restore --exit-on-error`; a first restore on plain `postgres:17`
  was incomplete (missing `pg_net`/`supabase_vault`), so Supabase-flavoured image and extensions are required. The
  archive contains `vault.secrets` and must stay private.
- `docs/db/M192_PRODUCTION_APPLICATION_20260928.md` ("Recovery evidence and rehearsal") and
  `docs/db/M194_PRODUCTION_APPLICATION_20260930.md` ("Recovery evidence reported by the owner/local agent"):
  the migration is rehearsed *as role `postgres`* on a **separate restored copy**, the reference restore stays
  pre-migration, postflight and invariants are read on the copy; a direct `psql` rehearsal does not insert a ledger row;
  database owner aligned to `postgres`, `PUBLIC`/`authenticated` not granted schema CREATE.
- `docs/db/qc-material-199-closure/NEXT_PHASE_20261003.md` gates G05 (tested pause) and G06 (hashes, ledger,
  backup/rehearsal, before/after invariants, independent acceptance) and the "Pause and recovery rehearsal specification".
- `docs/deployment/BACKUP_RESTORE.md` and `scripts/backup/*.sh` are a generic, older procedure (SQL dump to `./backups`);
  they are **not** the practice used for M190–M194.

## Readiness verdict and remaining work

**Repository acceptance of F1 (M202 as SQL + tests):** with the listing fix and equivalence proof, the measured
defect is closed, the three earlier blockers and the INSERT-only rehearsal were already passed, and the remaining
review points are dispositioned above without a further repository blocker. This is a statement about repository
evidence only; independent acceptance is Codex's/Mojahed's call.

| Class | Item |
|---|---|
| **Repository acceptance** | Independent review of the listing rewrite + section F; CI at the final head; Codacy re-run clean |
| **Owner decisions** | Optional `authority_corrupt` list field (E3); optional test-only internal-trigger fingerprint (E4); whether to fold hosted-attribute readbacks into the rehearsal checklist (E1/E2) |
| **Local-clone rehearsal (Mojahed + local agent)** | Fresh `pg_dump -Fc` of the then-current state; restore into `supabase/postgres` on a `template0` database; if and only if M202 has first been accepted and merged to canonical `main`, apply the then-pending canonical migrations in ledger order (202 last) as `postgres` on the clone — the rehearsal itself implies no application to any target; read back E1/E2 attributes, ownership/ACL of the QC family, fingerprint, gate/list parity, genuine RPC; full-restore scope of E5 |
| **Future pause gates (not started)** | G05 tested pause fence, G01/G02 caller and permission inventory, G06 target ledger/hash sign-off, G07 UI alignment (`mesService` direct table access), G08 baseline regeneration |
