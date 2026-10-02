# Material issue / manufacturing quality coordination checkpoint

Snapshot: 2026-10-02 UTC. This is a repository coordination record, not a target
application record or an authorization to merge, apply, deploy, release or remove
holds. No Production or Staging access was used to prepare it.

## Accepted evidence and frozen revisions

The independent review supplied by the owner accepts PR #302 for documentation
accuracy and coverage only, with no P1/P2 findings. Preserve its four reviewed
files and exact head; this checkpoint is a separate proposed addition.

| Item | Frozen head | Tree | State at checkpoint |
|---|---|---|---|
| main after repository-only #299 merge | `3acea30d83e182a2651b60b8696a658137bc0c92` | `60f5aecb7275660ef8741c3fa18d9f2be48b6b1d` | Canonical files allocated; live application not established |
| [#301 client integration](https://github.com/6thd/wardah-process-costing/pull/301) | `0e462611e49f50d30f888323837d351b03f3acab` | `d73fc628ce9ac1addd3cb844bac51c4f4dd747c2` | Open, Draft, unmerged |
| [#302 owner-disposition inventory](https://github.com/6thd/wardah-process-costing/pull/302) | `314ab192d59df0448deb4b1ad5e579bdd83cd01b` | `03174e92c56fc2217d93ba214fef343ba3213493` | Open, Draft, unmerged; documentation review PASS |
| [#303 quality database](https://github.com/6thd/wardah-process-costing/pull/303) | `a312ab529919dc1815692dd7f06fab5f4270d804` | `2a6024609a301c999cf4d50d0eed31b06dbc0287` | Open, not Draft, unmerged |
| [#304 quality interface](https://github.com/6thd/wardah-process-costing/pull/304) | `1781c981468b615777bf6672e80ce3498ca1ff1d` | `71b1c51567b3184e5a2e3aeba42091ef8eb48a1a` | Open, Draft, unmerged; stacked on #303 |
| #298 reference harness | `d71a1657739d1660740ac931ef5f48bffbd4476f` | `ed2f78616e7b3582206bf39e47dcc94539c73c9f` | Frozen reference, not live application evidence |

Re-verify these identities before any later action. A PASS at one frozen head
does not transfer automatically to another head or a combined integration tree.

## What is closed

- #299 repository integration review passed and its canonical allocation is on
  main. This does not establish a live 195–198 ledger or close paired-cutover gates.
- #301's frozen repository integration passed independent local and exact-head
  CI review. The production hard-disable remains. Its review explicitly leaves
  merge, application and release eligibility open.
- #302 adds exactly four documents (+1311/-0). The independent reviewer verified
  31 source hashes, 64 JSON anchors, 34 links, 516 source files, ten literal writes,
  ten literal calls covering twelve quarantined RPC names, and DW11's two dynamic
  UPDATE call edges. All 33 route decisions remain PENDING; all eight operational
  gates remain open. The reviewer did not rerun SQL or browser acceptance.
- #302 exact-head checks observed: six success, three neutral Netlify checks and
  Deploy to Production skipped. Test & Build
  [37022931659](https://github.com/6thd/wardah-process-costing/actions/runs/37022931659)
  and SonarQube
  [37022930410](https://github.com/6thd/wardah-process-costing/actions/runs/37022930410)
  succeeded. These are documentation-branch evidence only.
- #303's two reported review defects (insert-as-done/quality-check bypass and
  inspection-number collision) have source fixes at the frozen head. Its own
  [M199 CI run 37029495858](https://github.com/6thd/wardah-process-costing/actions/runs/37029495858)
  contains 70 acceptance notices, RED reproduction, DEFINER mutation controls
  and a two-session concurrency PASS. This is not an independent review of the
  whole quality feature or a hosted-identity proof.
- #304's inventory repair removes one old direct inspection INSERT and adds six
  literal quality RPC calls. Its own count is 359; its
  [inventory run 37035404173](https://github.com/6thd/wardah-process-costing/actions/runs/37035404173)
  passes. Only three checks were observed on the stacked UI head; this is not the
  full main-targeted CI suite.

## Quality coordination findings and work queue

| ID | Finding | Required next action | Status / evidence boundary |
|---|---|---|---|
| C01 | #303 merges cleanly with frozen #301; synthetic tree `4abd1d824dd7b53cded1bbfbf2dc3c6f8a028edb` | Recompute after any head changes; test the combined schema/client | Static merge only; no combined acceptance yet |
| C02 | #304 conflicts with #301 in four files listed below | Resolve on an isolated integration branch; preserve both features and regenerate the union RBAC inventory | Pending; neither original branch changed |
| C03 | M199 claims 190–198 prerequisites but checks objects already present by M196 | Reproduce on truncated 196/197 chains, add an exact M198 catalog guard, prove early refusal and positive 198 acceptance | Next phase; source-level gap identified, SQL controls not yet run at this snapshot |
| C04 | `release_gate_mode=off` only disables required completion release checks | Keep wording precise: M199 still changes inspection ACLs/policies, immutable history, permission templates and QC RPCs immediately | Documentation/operational assessment pending; do not claim zero behavior changes |
| C05 | QC hold/return intersects material-issue status, replay and parent versions | Prove new issue refusal under QC hold, recorded-event replay, stale-version refusal after return, pending recovery and shared races | Combined local acceptance pending; hosted/operator evidence separate |
| C06 | Canonical acceptance caps at M198 | Add combined M199 acceptance rather than treating the canonical PASS as M199 coverage | Pending |
| C07 | M191 `s82b.sh` chooses first reservations by random UUID and gives up after eight attempts | Separate deterministic-fixture repair and repeated concurrency validation | Source diagnosis checked; Claude's local reproduction is reported evidence, not rerun here |
| C08 | QC accounting and wider inspection scope remain follow-ups | Track scrap accounting, WIP scrap units, incoming inspection/quarantine stock, nonconformance and batch traceability separately | Not implemented by this coordination record |

C02 conflicts:

- `scripts/ci/security/rbac-mutation-baseline.json`
- `src/features/manufacturing/index.tsx`
- `src/locales/ar/translation.json`
- `src/locales/en/translation.json`

#301's pinned mutation count is 360; #304's is 359. Neither pinned file can simply
replace the other. Recompute the combined inventory and classification matrix
from the resolved sources and review the actual removed/added mutations.

C03 concerns the preflight in
[`199_manufacturing_quality_control.sql`](https://github.com/6thd/wardah-process-costing/blob/a312ab529919dc1815692dd7f06fab5f4270d804/sql/migrations/199_manufacturing_quality_control.sql#L10-L31).
M197 and M198 replace the same setup signature. Existence of that signature and
`maintenance_version` does not establish the M198 replacement body. Preserve
195–198 and the pinned harness; repair only the pending M199 guard and its controls
on a separate branch for independent review.

C07 is described in
[Claude's #303 comment](https://github.com/6thd/wardah-process-costing/pull/303#issuecomment-5956091415).
The rehearsal builds only through M191, and its relevant inputs are unchanged by
M199. A later green run does not repair the random-fixture weakness. Do not hide
it by weakening assertions or repeatedly rerunning until green.

## Open owner and cutover gates

[OWNER_DECISIONS.md](OWNER_DECISIONS.md) remains the decision register. No owner,
approval, verification or route decision is inferred from CI or assigned here.

- Disposition of all twelve quarantined legacy RPC names, ten literal direct
  writers, DW11 and dynamic/external/scheduled boundaries, including #230's future
  completion coordinator and legacy callers not covered by narrow replacements.
- Current #278 target application/behavior record and read-only reconciliation
  of the actual ledger, identities, grants and devices through a separately
  authorized process.
- Server-side pause covering retries and in-flight calls; pending-event recovery;
  real hosted authentication and operator reconciliation.
- Explicit grants, expiry, device policy, monitoring, rollback/recovery and
  paired DB/client cutover sign-off.
- Approval to apply 195→198, then 199, and approval to release dependent clients.
  Repository availability and a default-off completion gate do not satisfy these.
- Baseline regeneration only after the live application ledger is verified.

NO-GO, M192, DB-first and paired-cutover holds remain. Staging must not be advanced
to 195–199 just because its normal policy says it follows main. No live access,
application, deployment, merge or release is authorized by this checkpoint.

## Ordered continuation

1. Preserve #302's accepted head and propose this checkpoint separately.
2. Repair C03 on an isolated branch based on frozen #303. Run real 196/197 RED
   controls, positive 198 acceptance and catalog-drift controls; submit the narrow
   repair for independent review. Any unavailable environment or CI evidence must
   be disclosed.
3. Build a separately reviewed combined #301/#304 tree and address C02/C05/C06.
   Run full CI, both feature browser paths and shared database controls on that
   exact tree. Do not reinterpret either existing PASS as combined acceptance.
4. Resolve owner decisions and target/cutover gates with evidence and named
   approvals. Decisions remain pending until supplied.
5. Only after the relevant separate authorizations: repository merges, verified
   paired application/cutover, dependent client deployment and later baseline.

## Non-blocking review notes retained

#302's reviewer suggested mentioning DW03's live hook consumer and an ignored
`process_costs` read error, plus a more direct DW10 dashboard anchor. The read-error
note belongs to DW03's cost recalculation path even though the review labels it
DW06. These optional details do not change enumeration or decisions. Preserve the
accepted documents rather than reopening their review for wording alone.

Previously reported #301/#299 advisories (browser marker greps, Auth bridge
readiness, trigger branch clutter, inherited Git environment, strict profile
types, probe-path quoting, SET ROLE membership, scanner-test independence and
final-chain reserved-stock-floor coverage) remain separate follow-ups. None is
silently treated as fixed by the quality work or this checkpoint.
