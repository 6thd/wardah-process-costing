# Migration 180 — Retire legacy journal approval surface

Issue: #175  
Parent security epic: #48

## Decision

The active journal lifecycle is `gl_entries` / `gl_entry_lines` and the canonical manual-journal RPC surface introduced by Migration 178. The historical approval model (`journal_entries`, `journal_entry_approvals`, `approve_journal_entry`) is not revived.

Production evidence before this migration shows:

- `journal_entry_approvals` has no active rows;
- `approve_journal_entry` is already not executable by `authenticated`;
- `check_entry_approval_required` returns `false` and contains a TODO rather than an active approval policy;
- the client `JournalService.approveEntry()` is intentionally fail-closed pending #175.

A future multi-level approval feature, if required, must be designed explicitly against canonical `gl_entries`, with assigned-approver and segregation-of-duties rules. It must not reuse the legacy `journal_entries` workflow.

## Scope

Migration 180 is DB-only and non-destructive.

It:

- preserves the legacy table, functions, rows, and schema history;
- revokes `journal_entry_approvals` access from `PUBLIC`, `anon`, `authenticated`, and `service_role`;
- revokes execution of `check_entry_approval_required(uuid)` and `approve_journal_entry(uuid,integer,text)` from those roles;
- does not change `gl_entries`, `gl_entry_lines`, canonical journal statuses, posting, reversal, permissions, or idempotency.

## Preflight — read only

Before applying to Production, confirm:

1. the merged migration is exactly the reviewed `main` version;
2. Production migration ledger ends at or beyond 179 and does not already contain 180;
3. `journal_entry_approvals` still exists;
4. legacy approval row count is recorded without modifying rows;
5. canonical manual journal RPC grants match the post-178 contract;
6. generic `rpc_create_journal_entry(jsonb)` remains closed to `anon` and `authenticated` per 178/179.

Do not create test journal entries or approval rows in Production for this migration.

## Deployment order

1. Review DB-only PR.
2. Require normal CI/quality gates plus `Legacy Journal Approval 180 Acceptance` green.
3. Merge to `main`.
4. Re-fetch the exact merged migration from `main` and compare it with the reviewed file.
5. Apply Migration 180 once to Production.
6. Run the read-only postflight below.
7. Only after DB verification may a separate application PR remove the dormant approval UI/service calls.

## Postflight — read only

Verify:

- migration ledger contains `180_retire_legacy_journal_approval_surface` exactly once;
- legacy table and both legacy functions still exist;
- `anon`, `authenticated`, and `service_role` have no table privileges on `journal_entry_approvals`;
- those roles cannot execute either legacy approval function;
- `authenticated` still has EXECUTE on canonical manual journal create/post/reverse RPCs;
- `anon` and `authenticated` still cannot execute generic `rpc_create_journal_entry(jsonb)`.

## Rollback policy

There is no destructive rollback. If an unexpected supported legacy dependency is discovered after deployment, stop and document it before restoring any grant. Do not re-grant broad table DML or browser EXECUTE as an emergency shortcut. Any compatibility restoration must be a reviewed additive migration with a narrowly defined authorization boundary.

## Follow-up application round

After Production 180 is verified, a separate PR may:

- remove the dormant Approvals tab/component from the active canonical Journal Entries UI;
- remove `JournalService.checkApprovalRequired`, `approveEntry`, and legacy approval reads from active application code where no other supported caller exists;
- update behavior-lock tests so the UI cannot accidentally reintroduce the retired legacy workflow.

That application PR must contain no database migration and must not redefine approval semantics.
