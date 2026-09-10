# M191 Slice 12 — preserved acceptance evidence

Evidence-only. This directory adds **no** candidate change: it records the Slice 12
deterministic GREEN acceptance run and preserves the harness that produced it, so the
result can be re-derived instead of trusted.

## Frozen identifiers (§1)

| Field | Value |
|---|---|
| Candidate SHA (PR #241 head) | `6aa93b083a68bd47c90ea47aaeb3df6a147095d6` |
| Assembly source head (candidate file header) | `e5f2908ab27ebf0077a503682f63d81d49870c17` |
| Candidate artifact | `docs/db/M191_CANDIDATE_ASSEMBLED.sql` |
| Candidate sha256 | `7654adf2d24eb10f0dd611dd6896e5a21b066bbbe1ac6c42aeab3b425e1932a4` |
| PostgreSQL | **17.11** (`17.11-1.pgdg24.04+2`) |
| `standard_conforming_strings` | `on` |
| `default_transaction_isolation` | **`read committed`** — asserted live before Drift A, B and C |
| Baseline pair | `000_schema_baseline_20260905_184634.sql` + `001_system_reference_data_20260905_184634.sql` (cutoff 189) |
| Highest prerequisite migration | `190_material_consumption_authorization_boundary.sql` (chain `PASS=1 FAIL=0`) |
| Production advisory gate in candidate | none, verified across all 13 objects |

Per-slice sha256 values are recorded at the top of `M191_SLICE12_EVIDENCE.txt`.

**PostgreSQL 17.x is the reference platform.** The cutoff-189 baseline is a PG 17 dump
that sets `transaction_timeout`; on PostgreSQL 16.13 it fails at line 23 before any M191
byte is parsed. That is a PG17-baseline incompatibility, not an M191 finding.

## Run order and exit codes

Verdict for the two gates is the psql exit code under `\set ON_ERROR_STOP on`.

1. `12_acceptance_gate_selftest.sql` → **exit 0** (`positive=7 mutants=15`)
2. `12_acceptance_static_gates.sql` → **exit 0**
   (`objects=13/closed s1_regex=positive+pattern_regression fks=2
   helper=ordered_no_key_update prefix_order=11 bodies fix_g=captured_exact
   m190_guard=present`)
3. `default_transaction_isolation = read committed` asserted, else `HARNESS_FAIL`
4. Aggregate runtime battery §4–§10 on the assembled candidate
5. §12 reconciliation after every stock-mutating GREEN scenario

Both gates were re-run **after** the whole battery and again returned exit 0.

## Rebuilding the environment

```
createdb wardah_m191
psql -v ON_ERROR_STOP=1 -f scripts/ci/fresh-db/supabase_shim.sql
psql -v ON_ERROR_STOP=1 -f sql/baseline/000_schema_baseline_20260905_184634.sql
psql -v ON_ERROR_STOP=1 -f sql/baseline/001_system_reference_data_20260905_184634.sql
python3 scripts/ci/fresh-db/build_apply_order.py sql/migrations 189 > /tmp/order.txt
REPORT=/tmp/chain.txt bash scripts/ci/fresh-db/run_chain.sh sql/migrations /tmp/order.txt
psql -v ON_ERROR_STOP=1 -f docs/db/M191_CANDIDATE_ASSEMBLED.sql
```

`wardah_pre191` is an identical database that stops at migration 190. It is the
**control** used for predecessor comparison and for the RED proofs; its results are
never mixed into the GREEN candidate results.

## Running the harness

Every script needs `SCRATCH` (directory holding these scripts) and the usual `PG*`
variables, and each is run against `wardah_m191` unless marked as a control.

```
export SCRATCH=docs/db/m191-evidence/harness
export PGDATABASE=wardah_m191
bash $SCRATCH/s4_core.sh        # §4  G-A G-B G-C1 G-C2 G-FB
bash $SCRATCH/s5_valuation.sh   # §5  FIFO + LIFO forced concurrency
bash $SCRATCH/s6_prefix.sh      # §6  RED unordered mutant + real helper GREEN
bash $SCRATCH/s7_fixcd.sh       # §7  six Fix C / Fix D whole-call controls
bash $SCRATCH/s8_fixe.sh        # §8.1a GR[A,B] vs DN[B,A]
bash $SCRATCH/s8b_fixe.sh       # §8.1b Stock Adjustment vs Consumption
bash $SCRATCH/s82_superset.sh   # §8.2 (3) real superset GREEN, (1) guard catches narrowing
bash $SCRATCH/s82b.sh           # §8.2 (2) narrowed + unguarded => 40P01
bash $SCRATCH/s82c1.sh          # §8.2 C1 unresolvable-reservation fixture
bash $SCRATCH/s9_fixf.sh        # §9  Fix F RED + both business serializations
bash $SCRATCH/s10_fixg.sh       # §10.1 Control A/B
bash $SCRATCH/s10_2probe.sh     # §10.2 lock-mode probe
bash $SCRATCH/s10_drift.sh      # §10.3-10.6 drift A/B/C + invariants

PGDATABASE=wardah_pre191 bash $SCRATCH/s8_red.sh    # §8.1a RED control
PGDATABASE=wardah_pre191 bash $SCRATCH/s10_red.sh   # §10.1 RED control
PGDATABASE=wardah_pre191 bash scripts/ci/fresh-db/acceptance_f2_stock_bin_race_red.sh
```

Harness discipline: every forced overlap is proved from observed backend state
(`pg_stat_activity`, `pg_blocking_pids`, `pg_locks`) or an advisory barrier. A sleep is
never used as evidence that a lock edge was reached. A scenario that cannot establish its
overlap aborts as `HARNESS_FAIL` rather than reporting a pass.

Test-only mutants are created and dropped inside the scripts that use them and never
enter the candidate. Mutant builders derive from the **live** body via
`pg_get_functiondef` and fail closed if an anchor does not match exactly once.

## Result

§4–§10 all GREEN on candidate `6aa93b08`. After the full battery all 263 function bodies
were byte-identical to the post-apply snapshot, 714 RLS policies showed no drift, and the
only difference from the pre-M191 control remained the single new helper
`wardah_lock_products_for_stock_write(uuid,uuid[])`
(`SECURITY INVOKER`, `search_path=public, pg_temp`, ACL `postgres`/`service_role` only).

Slice 11/A + 11/B evidence is the candidate transaction's own output: the transaction is
`BEGIN → preflight → 11/A → helper → slices 01–10 → 11/B → COMMIT`, Slice 11 is
fail-closed (`RAISE EXCEPTION` only, no success NOTICE), and the apply returned exit 0
with empty stderr and reached `COMMIT`.

## Documented evidence deviations

These are deviations of the *evidence artifacts* from the letter of
`12_DETERMINISTIC_GREEN_ACCEPTANCE_RECONCILIATION.md`. Neither is a candidate finding.

1. **§6.1 advisory gate barrier.** The document refers to a "previously verified advisory
   gate barrier". No such barrier existed in the repository, so one was built here
   (`s6_prefix.sh`). It is shown to discriminate: the ordering-removed mutant deadlocks
   with a genuine symmetric `40P01`, the real helper does not.
2. **§8.1 GR-vs-DN RED control.** The document asks to retain a deterministic RED *mutant*
   with an external B blocker taking `FOR NO KEY UPDATE`. Instead the RED was reproduced
   on the **genuine pre-M191 bodies** in `wardah_pre191`, with an external blocker on the
   contended bin (`FOR UPDATE`, matching what those predecessor bodies themselves take on
   `bins`), yielding a real `40P01` on `bins`. This is stronger evidence than a mutant of
   the M191 body, but it is not the artifact the document names.

All RED controls in this bundle were produced fresh during this run; none is a prose claim
that a mutant "was tested earlier".

## Re-runnability contract

Several RPCs derive a deterministic GL idempotency key from document identity (for
example `rpc_submit_stock_adjustment` uses `'stock-adjustment:' || adjustment_id`), and
posted GL entries are immutable by contract (`POSTED_ENTRY_IMMUTABLE`). A fixture
therefore may **not** delete ledger rows in order to repeat itself. Instead:

- `lib.sh` defines `RUN_NONCE` (unique per invocation) and `new_uuid`; every
  `idempotency_key` carries the nonce and every stock-adjustment id is generated per run;
- `purge_org_documents` deletes only **non-ledger** documents for a fixture org
  (`goods_receipts` / `delivery_notes` and their lines) — `gl_entries` and
  `gl_entry_lines` are never touched.

The rollback rehearsal exercised this: the first version of this harness passed on a
clean database but failed on a second run with `IDEMPOTENCY_KEY_CONFLICT`, which was
Migration 179's guard working as designed rather than a candidate defect. See
`M191_ROLLBACK_REHEARSAL_EVIDENCE.txt`.

## Rollback rehearsal

`harness/rollback_rehearsal.sh` restores the twelve predecessors from the live
`wardah_pre191` oracle (not from historical migration files), drops the helper, proves
the rolled-back catalog matches the oracle exactly, re-observes the frozen F2 RED proof,
then reapplies M191 and re-runs the gates and the full GREEN battery. Result and the
three harness defects it exposed are recorded in
`M191_ROLLBACK_REHEARSAL_EVIDENCE.txt`.

## Out of scope

M191 does **not** close the direct-client write surfaces on `products`,
`material_reservations`, or `stock_adjustment_items`. Those remain separate, pre-existing
debt and nothing in this evidence should be read as claiming otherwise.

## Next step

Slice 12 closes here. The next implementation step is the **rollback rehearsal**. Do not
promote the candidate to `sql/migrations/191_f2_stock_write_concurrency_closure.sql` and do
not request final Codex/Astra review before rollback and final assembly are complete.

## Final-review remediation (later than everything above)

Everything above this heading is the historical record for the SHAs it names and is left
exactly as it was written. It is **not** retro-fitted to describe tests that did not exist
then.

Astra/Codex reviewed head `fa1de77f07077af97623c34c0a743b5d00000785` and found three
acceptance/CI defects — a SECURITY DEFINER scanner false green, a Fix F acquisition-order
gap that let a `ORDER BY mr.id DESC` mutation of the real function stay GREEN, and a
missing UUID parser-parity matrix for Fix E. Their reproduction, fix, RED mutant proof and
GREEN proof are in `M191_FINAL_REVIEW_REMEDIATION.md`. Migration 191's production body was
not changed.
