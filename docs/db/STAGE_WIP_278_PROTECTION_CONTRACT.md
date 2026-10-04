# #278: posted stage-WIP boundary — proposed contract

This is a RED contract and implementation design for independent review. It does
not authorize a Production migration or new material-issue events. The client
issue action remains disabled.

## Source and current evidence

- At `main@4c62299b`, M192 issues materials atomically and increments
  `stage_wip_log.cost_material`; its receipt result records `stage_wip_log_id`.
  It selects the open row containing `CURRENT_DATE` with `ORDER BY period_end
  DESC LIMIT 1`.
- M193 blocks DELETE/TRUNCATE but retains authenticated INSERT/UPDATE. The
  mounted WIP form spreads `cost_material`, `mo_id`, `stage_id`, `period_*` and
  client-calculated values into an ordinary table write. A stale form can
  overwrite a later M192 cost.
- A read-only Production catalog/data check on 2026-09-29 found two open WIP
  rows for the same `(org,MO,stage)`, with periods 2025-11-16..23 and
  2025-11-17..24; each has `cost_material=1000`. Neither period contains the
  current date. There are zero M192 event receipts. `btree_gist` is available
  (1.7) but not installed. The overlap is historical; it blocks an immediate
  global exclusion constraint. No row identifiers or data were modified.

`stage-wip-278/run_red.sh` builds the cutoff-189 baseline + 190..193 in a
disposable PG17 database and asserts four executable defects: an ordinary
same-org member wipes posted cost with a cost-only stale update, changes a
posted row's eligibility period independently, re-keys the posted WIP row to
another MO without an interval conflict, and inserts an
overlapping open row with a later end date that receives the next material
issue. The end date is derived from the original interval so this proof does
not depend on the day the runner executes. The probe transaction rolls back;
the disposable database and its setup fixture are subsequently dropped. A
passing RED runner means the defects were reproduced; it is not GREEN
acceptance.

## Database contract for the implementation PR

1. An ordinary client cannot INSERT a material cost or UPDATE M192-derived
   `cost_material` or derived financial values. The M192 owner-run writer can
   still add cost inside its existing atomic transaction. Direct PostgREST,
   old bundles, Org Admin and a member without WIP permission all face the
   database boundary. Review every existing privileged writer first.
2. A row with posted cost or a receipt linked by `stage_wip_log_id` cannot be
   re-keyed across `org_id`, `mo_id`, `stage_id`, or have its eligibility dates
   changed directly. Reopening a closed row is forbidden. A legitimate
   one-way close must use an authorized, audited operation with MO-before-WIP
   lock order. Preserve legitimate labor/overhead edits through a narrow path;
   do not accept unrestricted direct writes as a compatibility exception.
3. A new or changed open interval must not overlap another eligible open
   interval for the same `(org,MO,stage)`, including an equal `period_end`.
   Both ends are inclusive, exactly as M192's
   `CURRENT_DATE BETWEEN period_start AND period_end`; `is_closed IS NULL` is
   open, exactly as its
   `COALESCE(is_closed,false)=false`. Check the whole interval, independent
   of today's date.
   Enforce this under concurrent INSERT/UPDATE, not only with a SELECT before
   writing. A constraint that excludes historical rows from its index must
   still reject a new interval overlapping one of those rows. Historical
   overlapping rows remain untouched by this change and cannot be used to
   justify a second issue target. M192 must reject a new
   event if more than one row is eligible for its date; an identical authorized
   replay still returns its stored result.
4. The migration must fail atomically on unexpected catalog drift and preserve
   existing M190–M193 bytes, ACLs/RLS outside the reviewed WIP surface,
   report definitions, rows, stock, receipt links and GL. A successful direct
   write that affected zero rows does not prove denial.
5. The mounted form omits event-derived fields from generic writes, keeps an
   explicit user-facing error for rejected stale edits, and uses the approved
   close operation. The database rejects equivalent old-client PATCH payloads.
6. Every WIP INSERT or change of `org_id`, `mo_id` or `stage_id` must verify
   that the referenced MO and stage belong to the WIP organization. This
   applies even to a zero-cost row: independent foreign keys and a tenant-only
   RLS check do not establish child-to-parent organization agreement.
7. Preserve M192's MO-before-WIP lock order. M192 updates material cost while
   holding a WIP row lock: a row-level UPDATE guard must not then acquire an
   MO lock or another lock in the reverse order. Direct identity, interval or
   eligibility edits to existing rows must be denied; an approved operation
   that needs both locks obtains the MO lock before the WIP row lock. A
   concurrent interval guard must not make a legitimate M192 cost-only issue
   deadlock or fail. Choose a serialization mechanism that works with the
   historical overlaps and both INSERT and UPDATE, then prove it with real
   two-session races. A transaction-local client-set GUC alone is not trusted
   authority to bypass the guard.
8. Review table-level and column-level grants, RLS, and every privileged WIP
   writer. State precisely which direct writes remain allowed for each role
   (`authenticated`, Org Admin, owner and `service_role`), how the M192
   owner-run update is distinguished, and what happens when an old client
   sends unchanged protected fields together with a legitimate labor or
   overhead change. Protect `cost_material`, cost-derived/equivalent-unit
   fields, row identity, dates and `is_closed` without rejecting lawful
   recomputation by `trigger_calculate_wip_eu`. Account for BEFORE-trigger
   ordering and `INSERT ... ON CONFLICT DO UPDATE` as an UPDATE path; a
   table-level grant cannot be narrowed by revoking only column grants.

## Required acceptance before any Production decision

- RED above is reproduced on PG17. GREEN: real M192 issue adds a priced line,
  then a cost-only old-client PATCH, period-only PATCH, re-key to a
  non-overlapping interval and full stale-form UPDATE are rejected by the
  intended boundary; the receipt, WIP cost, reservation, SLE, bins and GL are
  unchanged.
- Repeat the old-client checks with an upsert that takes the conflict UPDATE
  path, and with unchanged protected fields in a lawful labor/overhead edit.
- Test ordinary member, authorized WIP editor, Org Admin, foreign-org member
  and privileged writer separately. The privileged path can post via M192;
  an unreviewed direct overwrite is rejected or explicitly scoped.
- Two simultaneous interval inserts and an UPDATE/INSERT race cannot create
  eligible overlap. New overlap with a historical row is rejected. Test equal
  period ends, shared boundary days, `is_closed=NULL`, non-overlapping lawful
  rows, and intervals not containing CURRENT_DATE.
- Seed two pre-existing overlapping rows in a disposable database; the
  migration preserves them without modifying data, then a new event for a date
  in their overlap fails with a named error before stock or WIP effects. A
  normal one-row issue and replay remain green.
- Exercise lawful labor/overhead edit and one-way close through their approved
  permissions; previous legitimate call sites have no silent 0-row success.
- Exercise a real M192 issue concurrently with an authorized interval INSERT
  and an authorized WIP change in both lock orders. Pause between MO and WIP
  locks and assert no `40P01`, no lost cost, and a single unambiguous issue
  target. Reject cross-org MO or stage re-key/insert even on zero-cost rows.
- Run M192 and M193 acceptance again, migration chain, type-check/build and
  exact-head CI. Independently review contract, implementation and mutations.

## Historical data decision

The two Production periods are in November 2025. Do not edit them or install
an exclusion constraint that fails on them. A future data-correction plan must
identify the accounting basis, user approval, backup/restore point and
readback. The protective migration can precede that cleanup only if it safely
handles the legacy overlap as specified above. Production deployment has its
own backup, preflight, owner approval and postflight.
