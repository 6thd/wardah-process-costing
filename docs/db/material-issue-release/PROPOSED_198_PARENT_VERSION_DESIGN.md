# Proposed 198 — parent-version check for child-creating setup commands (design only)

**State: design proposal for team review. No SQL, no number allocation, no application.** It does not change 195/196/197, the frozen client contract or the NO-GO rollout decision.

## Problem

`rpc_manage_material_issue_setup` protects every command that *edits* an existing row with an optimistic `expected_version`:

| Command | Version checked | Duplicate intent from a second device |
|---|---|---|
| `set_order_status` | MO `maintenance_version` | rejected as stale |
| `set_work_order_status` | WO `maintenance_version` | rejected as stale |
| `resize_reservation` / `release_reservation` | reservation `maintenance_version` | rejected as stale |
| `open_stage_wip` | none | rejected by `UNIQUE (org_id, mo_id, stage_id, period_start, period_end)` → `23505` |
| `create_order` | none | same number rejected by `UNIQUE (org_id, order_number)`; a different number is a separate intent |
| **`reserve`** | **none** (`mo_id, item_id, uom_id, quantity`) | **accepted twice** |
| **`create_work_order`** | **none** (`mo_id, work_center_id, name, quantity`) | **accepted twice** (`work_order_number` is `MI-<event_id>`, unique per event only) |

Two devices showing the same MO can each press **Reserve** with different event UUIDs and create two reservations. Same-event replay stays idempotent, but different events count as separate requests. The decision export states this honestly with `distinct_event_duplicate_intent_prevented=false`, and the only full mitigation offered today, "server lease required", blocks rollout entirely.

## Proposal

Use the MO's existing `maintenance_version` as the parent version for the two child-creating commands:

1. `reserve` and `create_work_order` require `expected_version`, the MO version the operator was shown. Add the key to both `allowed` arrays and reject a missing or non-integer value.
2. After the existing `SELECT … FOR UPDATE` on the MO, compare versions and raise **`P0001` `ISSUE_SETUP_STALE_VERSION`**. Never use `40001`; see 197 and `scripts/ci/check_retryable_raise_sqlstate.py`.
3. On success, advance the MO version inside the same transaction. The existing `zz_issue_maintenance_version` `BEFORE UPDATE` trigger bumps on any row update, so a deliberate touch such as `UPDATE … SET maintenance_version = maintenance_version WHERE id = mo.id` is enough. **To verify:** M193/M194 and other MO triggers accept that update for every eligible status.
4. Keep the event lookup ahead of the version check, as it is today. A committed reserve whose response was lost then replays its receipt even though the MO version has moved on.
5. Leave everything else unchanged: permissions, lock order (event → MO → children → products → bins), reconciliation fence, receipts and M192 interaction.

Result: the second device's reserve becomes an explicit stale rejection. That device then reconciles through the existing fence and creates a new intent from refreshed state. This is the flow already proven for WO eligibility in the browser acceptance.

## Costs and open questions

- **More stale rejections.** Any MO-level setup change (status, another reservation, a new WO) invalidates other devices' pending reserve/WO drafts. The UI already shows the MO version and has a recovery path; owners should accept this trade-off explicitly.
- **Consumption interaction.** Within 190–197 only the setup RPC updates `manufacturing_orders` rows, so a material issue does not invalidate the MO version. **To verify:** no baseline trigger updates the MO row on consumption, because that would make every issue stale other devices' drafts.
- **Function replacement chain.** 196 → 197 → 198 would all replace the same function. As with the 170–173 and 182–183 chains, the live contract is their union. Derive 198 from the 197 body, pin before/after fingerprints the same way 197 does, and add a chain note.
- **Not covered:** `create_order` duplicates with different numbers, duplicate intent across different MOs, and human intent in general. This is an optimistic lock, not a device lease.

## Review order and paired cutover

1. Separate DB PR: 198 proposal derived from 197, with the retryable-SQLSTATE gate, verify-package fingerprints and the eight-plus-one-file disposable chain.
2. Dependent client PR: send the displayed MO version for `reserve` / `create_work_order`, and add two-profile acceptance (bounded `HTTP 400 P0001`, fence, new intent). The truly concurrent race is a separate database test.
3. Review order is not deployment compatibility. The old client with M198 rejects new child commands with `ISSUE_SETUP_VERSION_REQUIRED`; the new client with M197 gets `UNSUPPORTED_ISSUE_SETUP_FIELD`. Both fail closed. A separately approved isolated non-PROD cutover requires a verified server-side pause and the matching DB/client pair before access resumes; see [paired cutover requirements](../material-issue-parent-version-198/CUTOVER.md). Turning off a build flag does not quiesce existing tabs. Production rules and holds remain unchanged.
4. Acceptance supports only the same-displayed-MO-version child-creation protection. The general `distinct_event_duplicate_intent_prevented` guarantee remains false; any future scoped decision requires explicit owner review. Every other release gate stays as is.

## Acceptance to add

- Disposable SQL race: two actors reserve against the same displayed MO version → exactly one reservation, one `P0001 ISSUE_SETUP_STALE_VERSION`, unchanged stock/financial state.
- Same-event replay after the version moved returns the original receipt.
- Real REPEATABLE READ conflict still surfaces native `40001` (unchanged engine behavior).
- Browser (real local Auth/PostgREST 14.17): two profiles, second reserve gets a bounded `HTTP 400`, then fence and new intent.
