# Independent review: documentation-only M195 disposition inventory

Review this Draft PR read-only. It adds four files under
`docs/db/material-issue-owner-disposition/` on canonical main; it must not merge
#301, change its accepted head, alter SQL/runtime/types/workflows, or authorize
any environment access, migration application, client deployment or release.

Frozen anchors:

- Documentation base main: `3acea30d83e182a2651b60b8696a658137bc0c92`, tree `60f5aecb7275660ef8741c3fa18d9f2be48b6b1d`.
- Audited #301 head: `0e462611e49f50d30f888323837d351b03f3acab`, tree `d73fc628ce9ac1addd3cb844bac51c4f4dd747c2`.

First resolve this documentation PR's exact head/tree from its remote ref and
freeze them in your verdict. Check both anchors, PR state and complete delta.
If a remote anchor moved, report that separately and review the frozen source;
do not silently substitute it or modify any branch.

1. Confirm exactly four added documentation files, no other changes, and every
   file/line/hash link against the frozen audited source. Confirm all 33 route
   decisions are PENDING with null owner/decision/approval and empty verification.
2. Independently enumerate tracked `src/**/*.{ts,tsx,js,jsx}`, excluding
   `.test.`/`.spec.`, `__tests__`, `__mocks__`, `database.generated.ts`. Traverse
   TypeScript AST: find literal `.from` calls for manufacturing_orders,
   work_orders and material_reservations, then inspect the same fluent chain
   for insert/update/upsert/delete. Expect **10 chains**, matching DW01–DW10
   path/line/table/operation. Independently scan M195's 12 names in literal RPC
   calls: expect **10 calls**, with no literal call for create_mo_with_reservation
   or release_expired_reservations. A source-count match is not deployed reachability.
3. Inspect identifier-based `.from` calls, wrappers, proxy methods, configuration
   values and named delegates. Verify DW11 is one UPDATE implementation with
   two manufacturing_orders call edges (:142 and :169), not two more literal
   chains. Verify CP01/CP02 delegate to DW10/DW08 and the four GW/four DR
   boundaries are not incorrectly counted as confirmed affected writers.
4. Check conditions against executable code, not comments alone: production
   creation without materials reaches direct INSERT; material RPC missing
   fallback is development-only and real denials stop; relationship creation
   retry repeats INSERT; transition fallback has no production guard and can
   follow no-error/no-success; completion has a separate production refusal;
   isolated status returns outside the legacy catch. Identify inaccurate
   equivalence, retirement or no-effects claims if present.
5. Verify partial-outcome descriptions: ignored MO total-cost UPDATE error after
   cost INSERT; reservation helper catches failure after creation; per-material
   reserve and bulk-release loops; pause logs/time writes precede final status.
   Confirm cache rollback is not treated as DB rollback and the dashboard's
   false action/read constants are not ignored. Do not infer live persistence
   or enabled routes from source alone.
6. Check that maintenance status operations are narrower than MES, routing,
   scheduling, expiry, finished-goods or GL completion; isolated gate cannot
   activate in production. Preserve real grants, current #278, hosted identity,
   pause/in-flight/pending recovery, device policy, monitoring and DB-first
   paired-cutover gates. Do not choose business dispositions for the owner.
7. Assess search limitations honestly: no whole-program data-flow/RPC-body
   audit; no external scheduler/configuration or target usage evidence. Check
   stock_reservations versus material_reservations, retired consumption helpers,
   configurable unrelated table keys and deprecated database tools are not
   misclassified. Do not run deprecated tools or read environment credentials.

Return PASS/FAIL **for documentation accuracy and coverage only**, exact
head/tree/base, diff summary, independent enumeration/hash/anchor results,
P1/P2/P3 findings and remaining unverified boundaries. A PASS may support a
separate documentation merge decision; it must not approve #301 merge, target
application, Production/Staging access, deployment, release or hold removal.
No full SQL/browser/test-suite rerun is needed for an unchanged source tree.
