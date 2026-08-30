# AI Simulation Lab — Accounting Integrity Progress — 2026-08-29

**Purpose:** current-state ledger for the accounting integrity work that must precede Simulation Lab Phase 0.

**Last updated:** 2026-08-30.

**Historical evidence:** `PRODUCTION_INTEGRITY_AUDIT_20260828.md` and `TRIAL_BALANCE_CONSUMER_INVENTORY.md` remain discovery-time snapshots. They are not the current Production state.

---

## Executive state

| Workstream | State | Current evidence |
|---|---|---|
| Round 1 — Trial Balance truth alignment | ✅ Complete | Migration 182 + Migration 183 + PR #200 |
| Round 2 — Posted GL header/line integrity | ✅ Complete | PR #201 merged; Migration 184 applied and postflight-verified on Production |
| Historical account-code reconciliation | ⏳ Open independently | Issue #195; authoritative mapping required before any backfill |
| Baseline lineage | ✅ Complete | Cutoff 184 pair merged through PR #202; `main`, repository, and Production all resolve to 184 |
| Baseline publication / Red Proof governance | ✅ Complete | PRs #204–#206; live positive/negative guard proof plus folded-migration acceptance gates |
| Round 3 — Inventory integrity | ⏳ Not started | Next integrity round |
| Simulation Lab Phase 0 | ⏳ Deferred | Starts after prerequisite integrity rounds are closed |

---

## Round 1 — Trial Balance truth alignment

Migration 182 moved `rpc_get_trial_balance` to the legal ledger `gl_entries/gl_entry_lines`. Migration 183 hardened the financial-report read boundary and removed direct authenticated/anon access to `v_trial_balance`. PR #200 made the canonical Trial Balance RPC the sole browser-side source.

**Result:** the old split between legal-ledger truth, reporting RPCs, and client fallbacks is closed.

---

## Round 2 — Migration 184 posted GL integrity

**PR #201:** merged.

**Production migration:** `20260829133146 / 184_gl_posting_integrity`.

**Current status:** ✅ merged, applied, and independently postflight-verified.

### Live contract

At transaction end, every touched `posted` GL entry must have:

1. at least two legal `gl_entry_lines` rows;
2. legal debit sum equal to legal credit sum within tolerance `< 0.01`;
3. legal debit/credit sums equal to `gl_entries.total_debit/total_credit` within the same tolerance.

The integrity check uses deferred constraint triggers so a valid atomic transaction may create the posted header before its lines. `check_balance_before_post_trigger` covers row-level BEFORE INSERT and UPDATE.

### PostgreSQL 17 / RLS closure

Exact-head review before merge found a real fail-open risk: a deferred `SECURITY INVOKER` trigger evaluated after a SECURITY DEFINER posting RPC could run under `authenticated`, where tenant RLS might hide the touched row. The repaired `wardah_184_assert_posted_entry_integrity()` is `SECURITY DEFINER`, owned by `postgres`, with fixed `search_path`, and direct EXECUTE revoked from `anon`, `authenticated`, and `service_role`.

This is physical-integrity visibility, not an authorization bypass: authorization remains at the RPC/RLS boundary, while the deferred invariant must see the actual ledger row.

### Production postflight — 2026-08-29

Read-only verification after application confirmed:

- migration ledger latest row: `20260829133146 / 184_gl_posting_integrity`;
- migration name occurs exactly once;
- `check_balance_before_post_trigger` has `tgtype = 23` (ROW + BEFORE + INSERT + UPDATE);
- two integrity constraint triggers are deferred as designed;
- deferred integrity guard has `prosecdef = true` and owner `postgres`;
- direct EXECUTE is absent for `anon`, `authenticated`, and `service_role` on both internal trigger helpers;
- 19 GL headers, 12 posted, and the same 3 historical posted header-only rows remain;
- the historical three still total SAR 9,955.00 debit and SAR 9,955.00 credit;
- posted entries with header/line mismatch: 0;
- rollback-only Production smoke left 0 `GL184%` entries and 0 smoke organizations.

The Production application did **not** rewrite or invent historical ledger data.

### Historical boundary

The three pre-existing posted header-only entries remain evidence requiring authoritative remediation. After 184, touching one while it still lacks legal lines fails closed with `POSTED_ENTRY_LINES_MISSING`; remediation must add authoritative legal lines and any necessary header change in the same atomic transaction.

Issue #195 remains independent: historical four-digit account codes / `account_id IS NULL` require an authoritative Finance/source-system mapping, not inferred backfill.

---

## Baseline lineage

The previous reviewed pair was cutoff **182**. Production, the repository ledger,
and the pair resolved on `main` are now all cutoff **184**.

The governed `Generate Schema Baseline` workflow completed successfully against the live 184 ledger and generated/pushed:

- `sql/baseline/000_schema_baseline_20260829_135152.sql`
- `sql/baseline/001_system_reference_data_20260829_135152.sql`
- branch `automation/baseline-cutoff-184-33236502184`

The workflow's GitHub token could not create a pull request because repository Actions are not permitted to create/approve PRs. That failure was emitted only as a warning, so the workflow remained green despite completing only the branch-push half of its review-publication contract.

PR #202 was opened explicitly from the generated branch, reviewed on its exact
head, and merged. The resolved pair on `main` now contains 263 system-reference
rows (10 modules, 171 permissions, 6 UoM categories, 17 system UoMs, and 59
aliases). The 183 and 184 acceptance gates both passed after those migrations
were folded into the cutoff-184 baseline.

---

## Governance closure

The original generator could push a branch, fail to create its PR, and remain
green. That anti-vacuity gap is closed without permitting generated output to
land directly on `main`:

1. PR #204 added an independent guard requiring exactly one open review PR into
   `main` for the generated source branch and validating `source_run_id` before
   using it in selection logic.
2. PR #205 made reruns unambiguous with attempt-qualified branch names, retained
   a monotonic highest-cutoff rule for legacy branches, and granted the guard
   only the `actions: read` permission it needs.
3. The guard was proved live in both directions: run `33270868815` passed while
   #202 was open; run `33270900714` failed with zero open review PRs while #202
   was temporarily closed, after which #202 was reopened.
4. PR #206 taught the 183/184 acceptance workflows to use a historical pre-target
   baseline pair for Red Proof and the current pair for green proof. This prevents
   baseline folding from turning a real regression test into a vacuous one.

---

## What remains before Simulation Lab Phase 0

1. Keep Issue #195 as an independent evidence-driven data-remediation path; do
   not infer Finance mappings from code similarity.
2. Execute Round 3 inventory integrity.
3. Then begin Simulation Lab Phase 0 environment/bootstrap work.

---

## Governance note

Repository edits, PR merge authorization, and Production database authorization remain separate decisions. This document records observed state; it does not itself authorize a future merge or Production write.
