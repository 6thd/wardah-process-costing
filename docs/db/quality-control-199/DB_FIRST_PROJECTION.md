# M199 DB-first projection and ordered closure

This Draft is a DB-only projection onto frozen main `3acea30d`. It exists because
accepted integration #308 bundles M199 and dependent QC routes, which cannot be
merged together under `CLAUDE.md`. It is a proposed replacement DB merge vehicle,
not approval to merge, apply, deploy or release.

## Scope

- Copy the M199 SQL, MANIFEST entry, QC workflow, QC assertions/runners and QC
  documentation from accepted #308 `2ea72541`; preserve exact file bytes/modes.
- M199 remains byte-identical to narrowly reviewed #306 `e29b4e5a`.
- Use #308's independently accepted snapshot repair and historical checkpoints.
- Add the existing snapshot PASS marker to the standalone QC workflow's required
  marker list. This one workflow assertion is the only executable difference
  from the copied DB files; a missing marker must fail the job.
- Keep runtime `src/`, canonical 195–198, baselines, existing scripts and
  dependency files identical to main. The only src change is the types-only
  `database.generated.ts` from accepted #308 (+75/-3 against main); retaining
  these schema declarations avoids intentionally starting the regeneration
  workflow with stale types. They have not been regenerated locally; exact-head
  hosted type generation must confirm them. No QC route, settings page, service,
  hook or material-issue client is promoted by this proposal.
- Add this closure plan, an attributed independent PASS checkpoint and a review
  prompt. Existing PR heads #301/#303/#304/#306/#307/#308 stay unchanged.

No shared-acceptance/browser fixture is copied into this DB-only proposal: those
remain at the frozen #308 head. Their evidence supports integration review but
cannot substitute for full QC/security review or target acceptance.

## One path forward

| Order | Work / decision | Status |
| --- | --- | --- |
| 1 | Narrow prerequisite repair; source union; deterministic sequential integration | Accepted only at their frozen review heads |
| 2 | Separate DB-only proposal to main; recheck exact-head CI; full QC/security review | This proposal; pending review and new-head CI |
| 3 | Native QC + material browser on one disposable 199 DB; joint races | Open; use #308 as frozen source reference |
| 4 | Owner dispositions and operational/identity/pause/recovery gates | 33 decisions / eight gates remain open |
| 5 | Separately authorize repository merge of the reviewed DB-only head | Not authorized by integration PASS |
| 6 | Separately authorize paired target plan, apply 195→198 then 199, verify ledger/catalog/behavior | No target access or application in this work |
| 7 | Prepare/review a UI-only projection of accepted client/QC sources against resulting main; merge only after verified DB-first gates | Open; do not merge #301/#304/#308 ahead of this |
| 8 | Release decision, monitoring and later baseline regeneration | All holds retained |

Steps 2–4 can gather evidence locally without any live operation. They do not
grant permission for steps 5–8. Existing application/client compatibility and
M192 holds take precedence over a generic “Staging matches main” rule.

## Existing PR roles

| PR | Role |
| --- | --- |
| #301 | Frozen material client source; remains Draft and held |
| #302 | Validated disposition inventory; decisions remain pending |
| #303 | Original M199 DB proposal; lacks the later prerequisite/snapshot repairs |
| #304 | Frozen QC UI source; dependent on verified M199 |
| #305 | Earlier coordination record |
| #306 | Accepted narrow prerequisite repair source; not whole-QC approval |
| #307 | Narrow-review checkpoint |
| #308 | Accepted integration and sequential evidence; frozen Draft/reference, not merge vehicle |

Do not merge both this DB projection and the older DB proposals. Keep them open
until the replacement path is reviewed and the owner explicitly decides which
proposal supersedes which. No historical review or CI claim is relabeled as an
exact-head PASS for this projection.
