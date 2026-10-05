# F1 assessment evidence (disposable local PostgreSQL 17.11)

Logs are executor output, kept verbatim. Nothing here touches Production, Staging or hosted Supabase.
`superseded/` holds runs that were found invalid or uncontrolled; they are **not cited as evidence** and are kept only
so the history of the measurement work is visible (each file's reason is in its name or first line).

| File | What it is |
|---|---|
| E1_owner_rls.log | Owner / SELECT policy / FORCE RLS facts and the three-variant mechanism probe |
| E2_exec_graph.log | Entry-role execution graph, helper body, non-owner replacement/shadow controls |
| E3_list_vs_gate.log | Listing vs gate on NULL cycle, prior cycle, corrupt authority links |
| E4_internal_triggers.log | Fingerprint blind spot for internal FK triggers (superuser only) |
| E5_family_restore.log | INSERT-only restore of inspections + authority + supersessions: gate/list JSON parity, counters, audit |
| E6ab_*.log | Assertion cost vs role count; uncontrolled RPC latency (informational) |
| E6k_paired_before_after_FINAL.log, E6k_table.md, E6k_raw_samples/ | Controlled paired before/after (installed-function readback before timing), raw samples as JSON |
| E6l_plans_extract.txt, E6l_plans_raw/ | EXPLAIN ANALYZE (BUFFERS) with the full JIT block for M199, frozen old M202 and the optimized M202 |
| RUN6_full_runner_final.log | Full disposable-PG17 runner on the final tree |
| STATIC_checks.log | shellcheck, bash -n, py_compile, pglast, DEFINER check, diff check |
| sonar_issues_summary.txt, codacy_issue.json | Public-API readbacks of the Sonar and Codacy findings |

Git hygiene: trailing whitespace and trailing blank lines were stripped from these files (whitespace only; no content change) so
that `git diff --check` is clean. The raw `auto_explain` captures are the unmodified server-log excerpts apart from that.

Packaging note: the repository's global `.gitignore` ignores `*.log`; the reviewed `.log` files in this folder were force-added
individually (`git add -f`). The global ignore rule was not changed, and no other ignored file was added. Each superseded or
informational log carries a `NOTE:` header (added at commit time) saying why it is superseded, invalid or uncontrolled.
