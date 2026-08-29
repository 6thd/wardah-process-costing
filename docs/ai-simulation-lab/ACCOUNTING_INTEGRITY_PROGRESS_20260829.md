# AI Simulation Lab — Accounting Integrity Progress — 2026-08-29

**Purpose:** current-state ledger for the accounting integrity work that must precede Simulation Lab Phase 0.

**Historical evidence:** `PRODUCTION_INTEGRITY_AUDIT_20260828.md` and `TRIAL_BALANCE_CONSUMER_INVENTORY.md` are preserved as discovery-time snapshots. Their descriptions of the live code/database are superseded where this ledger records a completed remediation.

---

## Executive state

| Workstream | State | Current evidence |
|---|---|---|
| Round 1 — Trial Balance truth alignment | ✅ Complete | Migration 182 + Migration 183 + PR #200 |
| Round 2 — Posted GL header/line integrity | 🟡 Implemented and verified in PR #201; not merged/applied | Migration 184 exact-head CI and PostgreSQL 17 acceptance |
| Historical account-code reconciliation | ⏳ Open independently | Issue #195; authoritative mapping required before any backfill |
| Baseline lineage | ⚠️ Lagging | Current baseline cutoff 182 while Production migration ledger is at 183 |
| Round 3 — Inventory integrity | ⏳ Not started | Next integrity round after Round 2 closes |
| Simulation Lab Phase 0 | ⏳ Deferred | Starts only after prerequisite integrity rounds are closed |

---

## Round 1 — Trial Balance truth alignment

### Migration 182 — legal-ledger truth

`rpc_get_trial_balance` was moved from the retired `journal_entries/journal_lines` path to the legal ledger `gl_entries/gl_entry_lines`.

The repaired contract includes:

- legal posted GL lines as the reporting source;
- opening balances derived from configured accounting periods / fiscal-year start;
- historical `account_id IS NULL` lines matched by `account_code` so existing legal movement is not erased;
- inactive/non-postable accounts retained when they carry historical movement;
- localized account name returned from `name_ar` when available.

Ledger Truth acceptance now runs in enforced mode and proves reconciliation against the legal ledger, fiscal-year opening behavior, tenant isolation, retired-ledger inertness, historical NULL-account fallback, and a deliberate LT-3 red proof showing the gate can detect stale mirror columns.

### Migration 183 — report-read RBAC

Migration 183 hardened the reporting boundary after 182:

- financial report RPCs require the exact report-read permission;
- direct `SELECT` on `v_trial_balance` was removed from `authenticated` and `anon`;
- `service_role` retained the intended privileged access;
- the 182 legal-ledger implementation remained the source behind the RPC.

Production migration ledger was independently verified with 183 as the latest applied migration at the time of this document update.

### PR #200 — one client source of truth

PR #200 completed the browser-side consolidation:

- canonical `fetchTrialBalanceRpc` is the client data source;
- screen hook, legacy accounting service, repository adapter, and PostingService delegate to it;
- direct view/manual-table fallback implementations were removed from the client path;
- the source-contract test verifies RPC name, organization/date parameters, returned totals, error propagation, and **zero `supabase.from(...)` table/view reads**.

**Result:** the old consumer-inventory statement describing six competing Trial Balance implementations is historical evidence, not the current architecture.

---

## Round 2 — Migration 184 posted GL integrity

**PR:** #201 — `fix(accounting): enforce posted header-line integrity`

**Current status:** implemented and exact-head verified, but intentionally **not merged and not applied to Production** pending a separate merge decision and a separate Production authorization.

### Contract

At transaction end, every touched `posted` GL entry must have:

1. at least two legal `gl_entry_lines` rows;
2. legal debit sum equal to legal credit sum within tolerance `< 0.01`;
3. legal debit/credit sums equal to `gl_entries.total_debit/total_credit` within the same tolerance.

The guard is `DEFERRABLE INITIALLY DEFERRED`, allowing a valid atomic transaction to create the posted header first and its lines afterward before constraint evaluation.

The migration does **not** scan, rewrite, guess, or delete historical Production rows. The three known historical posted header-only entries remain separate remediation evidence.

### Fixture correction discovered during integration

The Trial Balance Ledger Truth fixture originally forced all deferred events **after** inserting the Case E posted header but **before** inserting its two lines. Migration 184 correctly rejected that transient invalid state with:

`POSTED_ENTRY_LINES_MISSING: entry=LT-NULL-ACCOUNT-ID line_count=0`

The fix moved the `SET CONSTRAINTS ALL IMMEDIATE / DEFERRED` flush to before Case E creates its posted header. No 182/184 assertion was weakened and Case E values/metadata expectations remained unchanged.

### PostgreSQL 17 deferred-trigger / RLS fail-open found before merge

Substantive exact-head review found a second, security-relevant issue before 184 was merged:

- `gl_entries` and `gl_entry_lines` use RLS and are not `FORCE ROW LEVEL SECURITY`;
- authenticated read policies scope rows to `wardah_org_id(NULL)`;
- without a valid tenant/org claim, `get_current_tenant_id()` deterministically falls back to the caller's oldest active membership;
- PostgreSQL 17 can evaluate a deferred trigger after the posting `SECURITY DEFINER` RPC has returned to the `authenticated` caller context;
- the original `wardah_184_assert_posted_entry_integrity()` was `SECURITY INVOKER` and used `NOT FOUND ... CONTINUE`, so RLS could hide the touched posted entry and silently skip the integrity contract.

### Fix inside Migration 184

Before merge/application, the internal deferred integrity trigger function was changed to:

- `SECURITY DEFINER`;
- fixed `search_path` (`public`, `pg_temp`);
- no parameters, no dynamic SQL, read-only integrity inspection plus exception raising;
- direct EXECUTE revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`;
- migration postflight asserts `pg_proc.prosecdef = true` and detects any execute-surface leak.

This use of `SECURITY DEFINER` is intentionally limited to **physical integrity visibility**, not authorization. Authorization remains at the RPC/RLS boundary; the deferred trigger must see the actual touched ledger row even when tenant RLS hides it from the caller at commit-time evaluation.

### RLS regression acceptance

Migration 184 acceptance now includes a PostgreSQL 17 multi-organization regression:

1. an `authenticated` user is a member of Org A and Org B;
2. no `tenant_id`/`org_id` claim is supplied, so normal RLS resolves to older Org A;
3. a test-only `SECURITY DEFINER` posting helper creates an invalid `posted` header in Org B;
4. execution returns to `authenticated`;
5. the test first proves the Org B row is invisible to the caller through ordinary RLS;
6. `SET CONSTRAINTS ALL IMMEDIATE` is forced;
7. Migration 184 must still raise `POSTED_ENTRY_LINES_MISSING`.

The exact-head artifact contains the explicit proof marker:

`GL_184_RLS_FAIL_CLOSED_OK: hidden org B posting rejected after definer returned`

The same workflow also retains the pre-184 red proof and the normal post-184 valid/invalid cases. Therefore the gate proves both that the defect existed before 184 and that the repaired invariant is not vacuous.

---

## Known historical data boundary

Migration 184 deliberately does not repair the three historical posted headers with no legal lines. Their authoritative source data must be recovered separately; inventing balancing lines would destroy auditability.

Issue #195 remains separate as well. It records legal-ledger rows with historical four-digit account codes / `account_id IS NULL`. Candidate six-digit accounts are semantic hints only, not approved mappings. Any remediation must address both historical rows and legacy producer paths so the condition cannot recur.

---

## Baseline lineage

The generated baseline pair is currently at migration cutoff **182**. Production has already applied **183**.

This gap is known and should be reconciled only after the current Round 2 merge/application sequence is settled according to baseline governance. Do not silently edit baseline history or use the baseline as evidence that Production is still at 182.

---

## What remains before Simulation Lab Phase 0

1. Finish exact-head review of PR #201 after all CI/status checks complete.
2. Merge #201 only with explicit merge authorization.
3. Apply the merged `184_gl_posting_integrity.sql` blob to Production only with separate explicit Production authorization and execute the runbook pre/post checks.
4. Reconcile baseline lineage after the applied cutoff is stable.
5. Keep Issue #195 as an independent evidence-driven data remediation path.
6. Execute Round 3 inventory integrity.
7. Only then begin Simulation Lab Phase 0 environment/bootstrap work.

---

## Governance note

Repository edits, merge authorization, and Production database authorization are separate decisions. Documentation in this directory records observed state; it does not itself authorize merge or Production writes.
