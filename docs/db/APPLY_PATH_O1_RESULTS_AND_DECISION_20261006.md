# O1 apply-path results and decision request — 2026-10-06 (review text; authorizes nothing)

Addendum to `ROLLOUT_OPERATOR_PLAN_195_203.md` and `APPLY_PATH_EVIDENCE_20261006.md`; none of the existing files is changed. No Production or Staging write, no ledger row written outside the throwaway project. Evidence package: `o1-apply-path-probe-20261006/` (see its `README.md`).

**Labels.** **[O1]** observed on the owner-authorized throwaway project `kfzwgldukqmcvzhzysrx` (PG 17.11, 2026-10-06) through the real MCP tools, raw responses saved; evidence about that project's platform on that date, **not Production**. **[PROD-RO]** a read-only identity query run on Production through `execute_sql` under the owner's authorization (§3). **[SRC]** derived from the repository files by parsing them. **[REPORTED]** reported by the owner's reviewer (Codex), not re-executed here. **[INF]** inference. **[UNVERIFIED]** not established.

## 1. What was run
**On O1 only** (`get_project` checked name and ACTIVE_HEALTHY first): P0 (`execute_sql`, read-only) → P1–P5 (`apply_migration`, one call each) → E3/E4 (`apply_migration`, one call) with a raw readback after every step. Every write probe starts with a guard that refuses (`RAISE`) unless `public` is empty, no `manufacturing_orders`/`stage_wip_log`/`wardah_internal` exists and every ledger row is named `o1_probe_%` (a `NULL` name is refused too); P1 also refuses a pre-existing `o1_probe` schema. No grant, role or extension was created and no ledger row was written or edited by hand. Method notes: `execute_sql` returns only the last non-empty result set, so each readback statement is its own call; the stored-SQL comparison is a server-side SHA-256 of the ledger text against the SHA-256 computed locally before sending. The cleanup (`DROP SCHEMA o1_probe`) was **cancelled by the tool layer and not repeated**; `o1_probe` and three ledger rows stay on O1 by the owner's instruction.

**On Production:** one read-only `SELECT` of identity and settings through `execute_sql` (no table, no business data, no write).

## 2. Results on O1
| # | Observation [O1] | Raw |
|---|---|---|
| G8-1 | `apply_migration` ran as `current_user = session_user = postgres`; `rolsuper=false`, `rolcreaterole=true`, `rolbypassrls=true`; `application_name = mgmt-api` (same identity and application name as `execute_sql`, P0). | raw/01, 03 |
| G8-2 | Objects created by `apply_migration` (a table, a `SECURITY DEFINER` function) are owned by `postgres`. | raw/03 |
| G8-3 | In-file `SET LOCAL ROLE postgres` succeeded (`current_user` inside = `postgres`); `SET LOCAL ROLE supabase_admin` was denied (`42501`). The result was written after `RESET ROLE`, so the denial is not an INSERT artifact. | raw/03 |
| G8-4 | `read committed`; `statement_timeout = 2min`; `lock_timeout = 0`; `search_path = "$user", public, extensions`. | raw/03 |
| G8-5 | `same_xid_for_sampled_statements = true` (xid 1219 for both). **Limit:** only the two sampled statements shared a transaction; this does not show that the whole file is one transaction and says nothing about catalog+ledger atomicity. | raw/03 |
| G11-1 (P2) | Own `BEGIN … COMMIT`, then an intended failure: the tool returned the intended error; the **catalog change persisted** and **no ledger row** exists for the name. | raw/04 |
| G11-2 (P3) | Own `BEGIN`, a CREATE, an intended failure **before** the file's `COMMIT`: the watched table `fail_before_commit_b` is absent and no ledger row exists. **Scope:** only these two observations; no other system object was inspected, so this is not a proof of a complete rollback of everything the file touched. | raw/05 |
| G11-3 (P4) | No transaction statements, an intended failure after a CREATE: the watched table `plain_fail_c` is absent and no ledger row exists (same scope limit as P3). | raw/06 |
| G11-4 (P5) | Own `BEGIN … COMMIT`, success: one ledger row; `statements` has **one element** equal to the file sent (913 bytes, SHA-256 `2254a827…4a9`), `BEGIN`/`COMMIT` retained; P1 likewise (4,066 bytes, `f28c5e33…edd`). Row columns: `version`, `name`, `statements`, `rollback`, `idempotency_key` (plus `created_by`, never read). | raw/07, 03 |
| E3 | Multibyte transport: Arabic text, U+2014, U+00A7 and a 4-byte character in string literals were stored **byte-exactly** (UTF-8 MD5 of all six values equals the value computed locally before sending). | raw/11 |
| E4 | A **84,278-byte** file (more than 202's 79,953 bytes; 84,221 characters, so multibyte text is in it) with its own `BEGIN … COMMIT` was transported, executed and stored byte-exactly: one ledger element, SHA-256 `090dcecd…9668` equal to the local value. | raw/11 |

All intended failures returned only the intended tag (`P0001`); no other error occurred. [REPORTED] The reviewer re-read O1: `postgres` is not a superuser, `statement_timeout = 2min`, `fail_after_commit_a` exists, `fail_before_commit_b` and `plain_fail_c` are absent, and the ledger held the P1 and P5 rows only, each with one `statements` element.

## 3. Production identity, read-only [PROD-RO] (raw/10)
`current_user = session_user = postgres`; `rolsuper = false`, `rolcreaterole = true`, `rolbypassrls = true`; `application_name = mgmt-api`; `statement_timeout = 2min`; `lock_timeout = 0`; `idle_in_transaction_session_timeout = 0`; `read committed`; PG **17.6** (O1 is 17.11). Everything but the server version equals what O1 showed for `execute_sql` and for `apply_migration`. **This is evidence about the `execute_sql` endpoint on Production only. It does not establish the role of `apply_migration` on Production**, and it is not a Production application test. At most it removes one difference between O1 and Production (the identity of the sibling endpoint). It can serve only as a **conditional basis** for G8, valid together with the in-window owner check after step 1 (plan §1.1), which stays necessary; it is not prior proof of the role of `apply_migration` on Production.

## 4. What this does and does not establish
- **G8 (role) on O1:** established for that project and date: the `apply_migration` path ran as the non-superuser `postgres`. Whether O1 plus the Production read-only identity is enough to close G8 for Production is the owner's and the reviewer's decision (D1).
- **G11 is not closed.** P2 is a **bounded counterexample**: a file's own `COMMIT` can separate the catalog change from the ledger registration when something fails later in the same request. It does not prove every failure after a `COMMIT` leaves a hole; in P3 and P4 (a failure before the file's `COMMIT`, and a file without its own transaction) neither the watched table nor a ledger row remained. Only those two things were observed, so this does not show a complete rollback of everything the file touched.
- **A file that ends with `COMMIT` does not make a hole impossible.** Nothing follows the `COMMIT` in 195–203 [SRC, §5], so the P2 mechanism (a later statement in the file) cannot arise from file content; but a failure of the ledger `INSERT`, a lost connection, a timeout or a lost response **after** that `COMMIT` is outside the file text and remains possible. P1–P5 and E3/E4 did not exercise that mode.
- **[INF]** P1–P5 are consistent with a service that sends one request of the shape `begin; <query>; insert into supabase_migrations.schema_migrations …; commit;` (the Studio self-hosted design in `APPLY_PATH_EVIDENCE_20261006.md` §1 row 6). Not shown to be the hosted handler; other designs would fit too.
- **Transport (new):** for ASCII and for the multibyte characters used (E3) and for a file of 84 KB (E4) the stored `statements` equals the bytes sent. This answers the plan's "byte exactness: UNVERIFIED" row **for O1, for these inputs**; the real files differ in content, and the plan's own check (stored hash equals file hash, one element) stays mandatory after every step.
- Single run, one project, one date. Concurrency, a ledger-side failure (E1/E2) and a timeout after `COMMIT` are not tested; a statement timeout was not exercised (E5 is not needed now).

## 5. Static scan of 195–203 [SRC] (parsed with `pglast`, independent of the plan's text)
| File | Bytes | SHA-256 (prefix) | Top-level stmts | `BEGIN` | `COMMIT` | After `COMMIT` | Non-ASCII | `SET LOCAL` timeouts |
|---|---|---|---|---|---|---|---|---|
| 195 | 8859 | `d906c72a9646` | 11 | 1 | 1 (last) | 0 | 1 line (em dash, in code) | lock 10s |
| 196 | 31796 | `cf61b346c56b` | 29 | 1 | 1 (last) | 0 | **Arabic text in 3 code lines** | lock 10s |
| 197 | 20170 | `e7eb602688c2` | 7 | 1 | 1 (last) | 0 | none | **none** |
| 198 | 21998 | `2cf867dfa5c9` | 7 | 1 | 1 (last) | 0 | none | **none** |
| 199 | 52429 | `a02a5831c458` | 78 | 1 | 1 (last) | 0 | **Arabic text in 11 code lines** | lock 10s |
| 200 | 11845 | `90b63836be37` | 12 | 1 | 1 (last) | 0 | 2 comment lines | lock 30s, stmt 5min |
| 201 | 28918 | `7207173740a2` | 16 | 1 | 1 (last) | 0 | **Arabic text in 5 code lines** | lock 30s, stmt 5min |
| 202 | 79953 | `32f8b62ffe28` | 69 | 1 | 1 (last) | 0 | 18 comment lines (em dash) | lock 30s, stmt 5min; `CREATE ROLE` x2 |
| 203 | 11914 | `8589d97e18d8` | 11 | 1 | 1 (last) | 0 | none | lock 30s, stmt 5min |

All nine: exactly one top-level `BEGIN` and one `COMMIT` (the final statement), no `ROLLBACK`, no `SAVEPOINT`, no CR, a trailing LF, and **no psql meta-command line**. Bytes and SHA-256 prefixes equal the operator plan's §1 table. The scoped CRLF script is the only psql-only item and is outside `apply_migration`. Two facts the plan did not list: Arabic text and an em dash sit in **code lines** of 195, 196, 199 and 201 (E3 now covers this class of character on O1); and the files 195–199 set no `statement_timeout`, so they run under the endpoint's 2 min default (O1; the Production `execute_sql` session shows the same value) — the duration of 196 and 199 against 2 min is **not measured** (open item).

## 6. Order, pinned from the runbooks
**Fixed order: 195 → 196 → 197 → 198 → (frozen-198 catalog readback, plan §3.6) → 199 → 200 → 201 → the scoped CRLF script, by `psql`, no ledger row → 202 → 203.**
- Sources (all agree): `docs/db/PRE_M202_VALIDATE_MO_TRANSITION_CRLF.md` ("Reviewed order on a Production-shaped restore: canonical 195 through 201, this script, unmodified 202"; the script is "not a numbered migration" and must run before 202 because 202's preflight pins `validate_mo_transition`); `docs/db/STAGE_WIP_MO_LOCK_203.md` ("Reviewed restored-clone order: 195–201, the pre-M202 CRLF script, unmodified 202, then 203"); `sql/migrations/MANIFEST.md`; `docs/db/ROLLOUT_OPERATOR_PLAN_195_203.md` §1; `scripts/ci/fresh-db/run_m203_local.sh` and `.github/workflows/stage-wip-203-acceptance.yml` (restored order `CRLF script -> 202 -> 203`).
- **No conflicting older sequence was found** in those files or in the other repository files that mention the CRLF script (checked by search; the only other mentions concern line-ending hygiene). This note repeats the order and introduces no other.
- Early 203 (after 195, before 202) is the plan's optional alternative; the owner must name it beforehand. 203 may be applied before 202 locally; it is not part of the fixed order.
- One `apply_migration` call per file, file bytes verbatim from `main`, name = file stem; several seconds between calls (the reference design derives the version from a one-second timestamp [INF]).

## 7. Options for ledger/catalog atomicity (G11)
| | A. Canonical bytes through `apply_migration` + explicit reconciliation plan | B1. One message `BEGIN; INSERT ledger row; <canonical bytes>` | B2. Remove the file's `BEGIN`/`COMMIT` and wrap | C. Another mechanism (CLI `db push`, reviewed wrapper) |
|---|---|---|---|---|
| Ledger row written by the service | yes | **no — a hand-written row** | yes | different shape |
| `statements` = canonical file bytes | yes (O1: ASCII, multibyte, 84 KB) | yes (the text we insert) | **no** — the stripped copy is stored | split into several elements (CLI as read) |
| Catalog + ledger committed together | **not guaranteed** (ledger-failure mode untested; E1/E2 propose to test it) | would commit the two together **for files of this shape only** (one `BEGIN … COMMIT`, the `COMMIT` last) if the single message runs as sent; **not tested on O1**; not a guarantee against every failure | would depend on the service (unknown) | depends |
| Repository rules | compatible | **forbidden**: no hand-inserted or edited ledger rows (CLAUDE.md; plan O4) | applied bytes ≠ pinned bytes; the files are not to be edited | changes the ledger convention; needs review and rehearsal |

None of the currently reviewed options demonstrates all three requirements ("canonical bytes in the ledger", "row recorded by the service", "catalog and ledger committed together"). **A with the reconciliation plan (§7.1) is the only option that needs no change of rule or tooling**; B1 and B2 need an explicit rule change by the owner, and C needs its own review and rehearsal. B1 is the only reviewed option that would commit the ledger row and the catalog change together, and only for these files and under its conditions: the file ends with its own `COMMIT` as the last statement (§5), the message is executed as sent as one request, and the row is hand-written (the version and the absent `created_by`/`idempotency_key` are ours). It is **not** a general guarantee: the file's internal `COMMIT` would commit both, and a later failure or a lost response could still leave the operator without a clear outcome. It is also not claimed to be the only solution that is theoretically possible. This is a comparison, not an authorization.

### 7.1 Reconciliation plan for option A (what a readback can show; nothing here edits the ledger)
| Ledger row | Catalog | Meaning | Action |
|---|---|---|---|
| none | unchanged | refused: watched objects absent and no ledger row (P3, P4 shape; other objects are checked by the postflight, not by this table) | report; no retry without owner and reviewer; a fix is a new additive migration |
| present, one element, hash equal | changed, postflight passes | success | continue after the several-second gap |
| none | **changed** | **hole** (P2 shape, or a failure after `COMMIT`) | stop; never re-send the file and never insert a row. The owner decides in writing **before the window** what follows (restore B0/B1 owner-preserving with roles first, or a documented exception reviewed by the reviewer). No default is pre-selected here. |
| present | unchanged/partial | row without effect | stop; owner and reviewer |
| present, wrong hash or element count | changed | wrong bytes committed | stop; treat as drift; owner and reviewer |

Per-call controls: read ledger and catalog before and after **every** call; classify the result only with this table (an error return is never read as "nothing happened"); no automatic retry; a stop after any non-clean result.

## 8. Experiments
| ID | Status | Question and design |
|---|---|---|
| E3 | **done on O1** | Multibyte transport (§2). |
| E4 | **done on O1** | An ≥ 82 KB file (§2). |
| E5 | **not needed now** | Timeout after `COMMIT`: not run, not to be run without a new instruction. |
| **E1/E2** | **proposed, SQL shown, NOT run** | `proposed/e1_e2_ledger_failure_PROPOSED.sql`: a `BEFORE INSERT` trigger on O1's `supabase_migrations.schema_migrations` that raises **only** for two literal names (`o1_probe_07_e1_ledger_fail_after_own_commit`, `o1_probe_08_e2_ledger_fail_plain`; an exact `IN` list, no pattern; every other row unchanged), installed and removed through `execute_sql` (the installation writes no ledger row), a pre- and post-fingerprint of the ledger (row count and an MD5 over version, name and stored-statement SHA-256; `created_by` never read), E1 = a file with its own `BEGIN … COMMIT`, E2 = a plain file. Stop if the trigger cannot be created (no ownership change, no grant); run the removal first if any later step cannot complete. The mechanics were tested on a local throwaway PG 17 with a stub ledger (not evidence about the service). |

**What E1/E2 cannot show.** The experiment models a ledger `INSERT` that errors after the file ran. It does **not** model a lost connection, a killed backend, a lost response or a platform timeout between the file's `COMMIT` and the ledger write. It therefore cannot prove those risks absent, only show what the service does when the `INSERT` itself fails. Reading the pair (E1 table / E2 table) is in the SQL file: present/absent suggests a separate ledger step after the file's own `COMMIT`; absent/absent suggests the ledger write is inside the same transaction or before the file; present/present suggests independent requests.

## 9. Decisions requested (specific; the reviewer's input is requested on each)
- **D1 (G8).** Executed as a read-only supplement (§3). It does not establish the `apply_migration` role on Production. The owner and the reviewer may treat O1 + this supplement as a **conditional basis** for G8, valid only together with the in-window owner check after step 1 (plan §1.1); or they may require more evidence.
- **D2 (G11 mechanism) and D3 (hole policy).** Owner decisions **after** a concrete packet: this note, the E1/E2 outcome if approved, and the owner's choice of what follows a hole. No risk acceptance and no automatic Production restore is claimed or assumed here.
- **D4.** Review the E1/E2 SQL and approve or amend it before any run.
- **D5.** `o1_probe` and three ledger rows stay on O1 for now.
- Still gating any Production action: plan gates G1–G7, G9, G10; repository-first merge with hashes read from `main`; B0/B1 with restore rehearsal; a maintenance window; the step-8 `psql` operator; an independent read-only verifier. **Nothing here applies, or authorizes applying, anything to Production or Staging.**

## 10. Not done / not claimed
No Production or Staging write; no ledger edit or hand-written row; no grant. Not shown: the hosted service's wrapping, `apply_migration`'s role on Production, a ledger-side failure, a lost connection, a timeout after `COMMIT`, concurrency, durations of 196/199 under the 2 min default. The O1 evidence is for that project's platform on the date above; the Production identity query covers `execute_sql` only.
