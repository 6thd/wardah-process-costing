# Checkpoint — PR #317, O1 apply-path work (2026-10-06)

Review text and state record. It authorizes nothing: no Production application, no restore, no acceptance of the G11 risk, no merge.

## 1. Branch state
- Branch `claude/clever-turing-ur1q95` (PR #317, Draft). Base `eb67705098c0bd14c22700296fffc8001011a435`.
- Commits added in this stretch, in order: `5294b5f` (drift test via psycopg, CRLF md5 server-side), `2982d57` (pylint E0601 fix in `run_mutant`), `1357c02` (27 documentation files: O1 evidence and decision request), `2c774f1` (hardening of the psql call in the CRLF test: one validated local target, allowlisted environment, per-line `nosec B404`/`nosec B603`). This checkpoint is committed on top of `2c774f1`.
- No migration, ops SQL, Codacy configuration or workflow file was changed by any of these commits.

## 2. Checks recorded
- Local, PG 17.11 on a disposable cluster, full runner `scripts/ci/fresh-db/run_m203_local.sh`: `PASS=12 FAIL=0`, 241 acceptance notices, 2292 probe identities, both orders (restored and alternate). Re-run after each code change, last time with the final code.
- `bandit`: no findings with `nosec` honoured; with `--ignore-nosec` exactly B404 and B603 remain (the two Codacy findings). `pylint`, `ruff` and `git diff --check` clean for the changed files.
- Target guard: 15 refused inputs and 3 accepted inputs (`selftest_target_guard`), plus a mock proof that `PGHOST=/tmp,remote.example` is refused before any `subprocess.run` or `psycopg.connect`. Windows was **not** exercised.
- Documentation package: `sha256sum -c` 25/25, sanitizer 0 hits (the only IPv4-shaped string is the Postgres version `17.11.0.003`), `git diff --check` clean, staged list exactly the intended files.
- **Codacy and CI on `2c774f1`: pending at the time of writing** (CI mostly in progress, Codacy had not analysed the head). `nosec` is not evidence that the rule disappeared; only Codacy's own result on the new head counts. On `2982d57` Codacy listed exactly two findings: `Bandit_B404` (Info, line 99) and `Bandit_B603` (Warning, line 100) in `pre_m202_crlf_compatibility_tests.py`.

## 3. Results on the throwaway project O1 (not Production)
P1–P5, E3/E4 and E1/E2 are recorded in `../APPLY_PATH_O1_RESULTS_AND_DECISION_20261006.md` and `raw/`. In short: `apply_migration` ran as the non-superuser `postgres`; transport was byte-exact for ASCII, multibyte text and an 84 KB file; a file's own `COMMIT` can separate the catalog change from the ledger row (P2); when the ledger `INSERT` raised an error, a file with its own `COMMIT` kept its catalog change with no row (E1) and a plain file kept nothing (E2) — consistent with a mechanism, not a proof of one implementation. G11 stays open.

## 4. State left on O1
- Present: schema `o1_probe` with tables `identity`, `fail_after_commit_a`, `commit_ok_d`, `utf8_large`, `e1_after_own_commit`; functions `owner_probe()` and `ledger_refuse_e1e2()`; the trigger `o1_probe_ledger_refuse_e1e2` on `supabase_migrations.schema_migrations` (raises only for `o1_probe_07_e1_ledger_fail_after_own_commit` and `o1_probe_08_e2_ledger_fail_plain`); three ledger rows (`o1_probe_01_identity`, `o1_probe_05_own_commit_success`, `o1_probe_06_utf8_large_success`). Ledger fingerprint `d3b23eb8002394884fd3e3e592b04d09` (3 rows) before, during and after E1/E2.
- The E1/E2 removal (`sent/e1e2/F_cleanup_txn.sql`, one transaction, two named objects, no `CASCADE`) was **not executed**: the tool call stopped at `MCP tool call requires approval` (execute_sql on project `kfzwgldukqmcvzhzysrx`, statements `DROP TRIGGER`/`DROP FUNCTION`) and was not retried. No blanket permission for Supabase tools was requested. To finish: run `F_cleanup_txn.sql`, then `G_cleanup_verify.sql` (expects 0 ledger triggers, no function, no trigger) and the fingerprint query (expects 3 rows and the fingerprint above).

## 5. Decisions that remain with the owner
1. **D1 (G8).** Whether O1 plus the read-only Production identity supplement is a conditional basis for G8, valid only with the in-window owner check after step 1 (plan §1.1).
2. **D2 (G11 mechanism).** Option A with the reconciliation plan (§7.1 of the analysis), a changed mechanism (B1 or C, each needing its own rule change or review), or stop.
3. **D3 (hole policy).** What follows *ledger absent / catalog changed* (restore from B0/B1, a reviewed documented exception, other). Nothing here chooses a restore or accepts the risk.
4. **D4/D5.** Who removes the E1/E2 trigger and function from O1, and whether `o1_probe` stays.
5. Still gating any Production action: plan gates G1–G7, G9, G10; repository-first merge with hashes read from `main`; B0/B1 with restore rehearsal; a maintenance window; the step-8 `psql` operator; an independent read-only verifier. Durations of 196 and 199 under the 2 min default are unmeasured.

## 6. Follow-up limits
Follow-up on this PR is event-driven only (a subscription to PR events delivers CI, Codacy and review activity); there is no periodic polling, and no continuous monitoring is claimed.
