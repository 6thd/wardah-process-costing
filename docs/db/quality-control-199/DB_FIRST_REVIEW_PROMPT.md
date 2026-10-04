# Independent review prompt: M199 DB-only projection

Review read-only. Do not merge, push, comment, dispatch workflows, access
Production/Staging, apply a live migration, deploy or lift holds.

Resolve the proposal head/tree from its PR and compare with its body. Verify
base main remains `3acea30d83e182a2651b60b8696a658137bc0c92`, tree
`60f5aecb7275660ef8741c3fa18d9f2be48b6b1d`; if anything moved, report drift
before relying on old evidence. Re-resolve after review.

Frozen input #308 is `2ea72541fec4b52e7e0af2a3809ecb7be791bb47`, tree
`6ed7d21a7a6654382fc7cbff5265fd244b6012fb`. M199 SQL must also equal #306
`e29b4e5aa96556165f97b278f55591dc61c8044e` byte for byte. Original QC
acceptance/red/concurrency must equal #304 `1781c981`.

1. Recover status/HEAD/diff/reflog before creating scratch worktrees. Reuse work
   already present. Verify the DB-only file list and exact numstat in the PR.
2. Compare every copied DB/support file and mode with frozen #308. Only the
   standalone workflow's extra required snapshot marker and three new closure
   documents may differ. The only src delta is types-only database.generated.ts
   copied from #308; no runtime src, dependency, existing script, baseline or
   canonical 195–198 changes. SQL delta only M199 plus MANIFEST. Confirm hosted
   type generation is current or record any bot-created head separately.
3. Run the complete QC runner on a disposable **UTF8 PG17** database. Require
   two prefix refusals, fourteen mutation refusals/restoration, snapshot
   maintenance=1/semantic=2/restored=true, RED, seventy assertions, four DEFINER
   mutants, reference RBAC and concurrency. Check missing/wrong snapshot marker
   fails the workflow loop.
4. Perform the **whole QC feature/security review** rather than treating the
   earlier narrow PASS as that review. Cover multi-tenant and actor checks,
   grants/owners, service_role inspection direct writes, insert/update gates,
   cycle/release quantities, conditional acceptance, immutable inspections,
   numbering/retry/idempotency and concurrent hold/return/completion behavior.
   Distinguish verified defects from outstanding owner decisions.
5. Check package/delegation/DEFINER controls and post-M199 quarantine. Review
   exact-head hosted CI separately; stock-image evidence on #308 does not prove
   this head. Confirm deployment remains skipped and no new path requests a
   live connection.
6. Validate the accepted integration checkpoint's attribution/limits and the
   ordered closure plan. Do not count M198-only browser logs as QC/199 evidence
   or close the missing joint-race, owner or operational gates.

Return verdict, exact frozen identities/delta, commands/results, P1/P2/P3 with
evidence and scope, environment limits, and remaining gates. A repository-only
PASS must explicitly retain DB-first, NO-GO/M192, owner and target holds.
