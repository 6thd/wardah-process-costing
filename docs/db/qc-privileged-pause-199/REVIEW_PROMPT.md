# Independent Round 5 focused contract-defect closure review

READ ONLY. Freeze the owner-supplied #313 head/tree at start and end. No edits,
commits, push, comments/reviews, Ready/merge, migration allocation/application,
Production/Staging access, pause implementation or rollout.

Prior Round 4: `7041dd0dd2e697ef8f22408688b6d90d80a5a37f`, tree
`7f2dc170b765e8268af27eda3b67c7d63fb0b4f6`.
Frozen proof base: `3d01f99fae2fb294fa0586084c32f0cd6bdf21fe`, tree
`ad60355c42a0e725bbe431ff3032f95ac5f05d35`.
Live-main readback: `1fe5eccc8e52874bc6038f26ffd4366628c46ca1`, tree
`b7dd9baa1d92b434118400c0e5ceaac30da45db8`.
#315/M201 was open/draft at `71192ed30b0bda48e7c2fe0523938a8a4fe37868`,
not merged into that main. Report new drift; do not silently absorb it.
#308/#310/#311 references remain the same as README.

Verify only contract, README and this prompt change against Round 4; all proof
code and the 44-source lock remain byte-identical. Total PR is seven additions
against frozen base. Main-only M200 files are not PR deletions. No rebase/relock.
This is four specific contract defects, not a repeat of all RED reproductions.

1. Identity binding: does the document stop claiming helper reachability from
   a textual signature, NOLOGIN or EXECUTE revoke alone? Check distinct dedicated
   execution owners, fixed owner-to-signature mapping in an INVOKER helper,
   protected context/row partitions, guard execution-role preservation and the
   complete closed code/role graph. Same-owner rogue function/dynamic-SQL mutants
   must fail that graph gate, not be magically detected by caller introspection.
   A shared postgres owner or unknown capability edge blocks acceptance. Identify
   any concrete remaining path; owner/superuser/DDL exclusions remain explicit.
2. session_replication_role: are negative SET and set_config from fresh separate
   sessions for each reviewed login and its reachable roles mandatory, with
   unchanged origin/trigger protections and SQLSTATE evidence? ACL-only or
   postgres-only readback is insufficient. No unauthorized target probing.
3. Namespace: read M171's actual hashtext(org),hashtext(day) expression. Is it an
   explicit blocker until additive rekey to disjoint fixed class 1463898705,
   verified old-call drain and quota acceptance? Check allocator key
   (1463898704,-1), positive org IDs, global key 0, and no global lock upgrade.
   Dynamic/external unresolved callers must block namespace acceptance. Neither
   rekey nor actual class reservation is claimed implemented/proven.
4. Ordering: read both M199 gate selectors. FINAL partition is current cycle;
   IN_PROCESS includes stage_id and remains cycle-independent. Check NOT NULL
   authority revision/counter plus DESC NULLS LAST, legacy mapping 0, corrupt/null
   refusal, two-stage independence and latest-revision-without-replacement denial.
   Existing history stays immutable; no selector/schema change is claimed.

Verify the paired-switch step now names the selected frozen target chain,
including M200 when applicable, rather than implying a maximum migration 199.
P02/P08 sustained-load and all other implementation probes remain PENDING.

Small validation: recompute unchanged proof-code blobs and 44 hashes; whitespace
and Markdown consistency. Do not report a new PG17 run unless actually performed.
Return exact identities/delta, PASS/FAIL for each of the four text corrections,
remaining concrete contract defects, and future implementation dependencies
separately. Retain the bounded counterexample/further-review verdict. This does
not approve implementation readiness, merge, a working pause, whole-QC/security
or rollout. All 33 routes, G01–G08, P01–P12, F1/service_role policy, #165, #278,
NO-GO/M192 and the independent M171 rekey/namespace acceptance remain open.
