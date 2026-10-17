# B2 candidate: runner-owned transactions for M195–M203

Status: Draft for independent review. Hosted proof on these bytes is NOT RUN.
Production application is NOT AUTHORIZED. This PR does not close G8, G11 or W0.

## Source change

The source is `d022ba3484d1737c693bab9e2724fab396499a72`. For each of the nine
migration files, delete its unique LF `BEGIN;` line and its unique LF `COMMIT;`
line only (15 bytes total). Preserve every other byte, including comments,
function bodies, preflights, postflights, ACLs and `SET LOCAL` commands.
`SOURCE_TRANSFORM.json` records full old/new hashes and sizes. The original
commit and prior evidence remain the provenance for the old bytes; prior PASS
results are not claimed as acceptance of the new bytes.

## Execution contract

Each file must run in one transaction owned by its runner. Direct applications:

```sh
psql -X -v ON_ERROR_STOP=1 --single-transaction -f sql/migrations/<file>.sql
```

Python drivers must use an explicit transaction context. Bare `psql -f`, split
statements or autocommit-per-statement applications are prohibited for 195–203.
No `SET LOCAL` protection is credited outside that transaction. Do not add this
wrapper to acceptance scripts with their own transaction/rollback or to
`scripts/ops/pre_m202_validate_mo_transition_crlf.sql`. The CRLF file is unchanged
and remains a named catalog-only, no-ledger operational exception.

The Management API must couple the migration body and its ledger insert in one
transaction. R214 supports this for a small sentinel without an internal COMMIT;
R215 demonstrated a catalog-without-ledger outcome with an internal COMMIT.
Local T7 supports catalog equivalence, not hosted API atomicity. These observations
are owner-supplied external evidence and are not included in this PR as raw logs.
No production safety guarantee is inferred from the API schema or a local test.

## Active caller inventory

| Caller | B2 applications | Transaction owner |
|---|---|---|
| `scripts/ci/fresh-db/run_chain.sh` | 195–203; shared by Fresh DB/workflows and canonical/QC/pause runners | `--single-transaction` only for 195–203; older files retain their own behavior |
| `docs/db/quality-control-199/run_local.sh` | direct 199 | `--single-transaction` |
| `docs/db/quality-control-199/test_prerequisites.py` | successful setup 197/198 and refusal 199 | `conn.transaction()` for setup; existing explicit BEGIN/rollback for refusal |
| `scripts/ci/fresh-db/acceptance_201_layer_order.sh` | negative 201 applications | `--single-transaction` |
| `docs/db/qc-privileged-write-closure-202/run_local.sh` | positive/negative 202 | `--single-transaction` |
| `scripts/ci/fresh-db/run_m203_local.sh` | direct 202 and checked 203 applications | `--single-transaction`; 203 acceptance follows successful client exit, not a printed COMMIT tag |

Workflows delegate canonical applications to these callers. SQL acceptance,
fixture, historical candidate, source-only scanner and frozen harness calls are
not applications of the changed canonical bytes. Private/off-repository local
agents must update their own callers under the same contract before any rehearsal.

Active hashes are updated in the canonical package/verifier, DEFINER delegation
pins, root-verifying SOURCE_LOCK manifests and rollout byte table. The source
identities in those locks still identify frozen harness/client/baseline provenance;
their changed current-root hashes identify this B2 revision. Historical API result
documents and the owner-disposition inventory remain unchanged historical evidence.

Pre-existing source-lock issue: the pause-199 lock's `_helpers.sql` hash already
differs from that file at `d022ba34`. B2 does not re-pin that unrelated helper or
claim the full historical pause package passes against current main. The B2 gate
checks only its changed canonical inputs and `run_chain.sh` in those two locks;
the qc-material-199 full database-source lock matches current files. Any reuse of
the historical pause package needs its own source review.

## Next hosted proof (separate authorization required)

Use a dedicated disposable project bootstrapped from the legal cutoff-189 baseline
and reference-data pair, then 190–194, with synthetic data only. Prove prerequisites
locally first. Do not copy B0 production data to another hosted project.
For each exact candidate file and its exact predecessor state:

1. A: deliberately refuse its ledger insert with a sentinel-scoped diagnostic
   trigger; require no catalog, row, ACL or cluster-role residue.
2. B: normal success; require one row by exact migration name, exact stored SQL
   bytes/hash, and expected catalog state.
3. C: induce a documented preflight refusal; require complete rollback.
4. D: measure the file's configured lock/statement timeout values in its execution
   transaction, without editing the candidate. Record session defaults for files
   that do not set a timeout; do not claim a configured value they lack.

Audit/clean diagnostic objects only under an approved scoped cleanup plan. Keep
probe ledger rows as evidence. Avoid automatic retries and repeated submissions.
If catalog changes without the matching ledger row, stop: the B2 hypothesis failed.

Before production, repeat full acceptance/concurrency on final source bytes,
independently review this PR, merge only under a separate owner instruction, and
close the operational gates using a fresh target readback and B0/B1 evidence.
Read both exact-name ledger state and catalog after each application, including
after an ambiguous response. A database-only restore does not dispose of the
cluster-scoped `wardah_qc_entry_202` role; hosted recovery and that role's disposition
need their own approved runbook. No manual ledger repair or R-B continuation is
authorized by this PR.
