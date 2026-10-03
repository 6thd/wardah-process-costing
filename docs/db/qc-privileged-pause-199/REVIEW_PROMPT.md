# Independent Round 4 delta review — QC evidence and pause contract

READ ONLY. Freeze the owner-supplied #313 review SHA/tree at start and end.
Do not commit, push, post reviews/comments, merge, mark Ready, allocate/apply a
migration, access Production/Staging or implement a pause. Return drift rather
than silently changing inputs. No whole-QC/security or rollout acceptance.

## Anchors and the scope of this review

Prior Round 3 reviewed head: `5f60aba31f2ac4cab4c21ecb2811efaffe9db7ac`,
tree `cb6428f027f0438e8bb43875c3c9a28963775a60`.
Frozen counterexample base: `3d01f99fae2fb294fa0586084c32f0cd6bdf21fe`,
tree `ad60355c42a0e725bbe431ff3032f95ac5f05d35`.
Live main read by the executor: `1fe5eccc8e52874bc6038f26ffd4366628c46ca1`,
tree `b7dd9baa1d92b434118400c0e5ceaac30da45db8`, includes #312 and #314/M200.
#308 `2ea72541fec4b52e7e0af2a3809ecb7be791bb47`, #310
`0e91e3527e8201ffae6f051cd31f8e4e3e7d9c86`, #311
`33b1806b9fd8cb6639a7a929c6c73b90c9c6d08a` remain frozen references.

Compare the new head to Round 3: only contract, README, this prompt and the
one-condition equivalent Python simplification should change. The complete PR
against the frozen base remains seven added packet files. Do not use a two-dot
live-main diff to mistake missing main-only additions for PR deletions. Verify
unchanged SOURCE_LOCK.json, RED SQL, runner and all 44 frozen source bytes.
Do not rebase/relock M200 into the old ten-step proof.

## Focused questions

1. Is M200 INCLUDED in future P04/P12 inventory with both setters, service_role
   direct/inherited/column paths, its business advisory lock, audit and posting
   consumers? Inspect M200 and runbook §§8–9 from the live-main anchor. Source
   analysis does not prove target grants, external jobs or actual application.
2. Does the proposed guard explicitly refuse owner-session DML without entry
   context and avoid M169's session_user=current_user disjunct? Is server context
   protected against direct helper calls, dynamic SQL, nesting, errors and reuse?
   Check that caller-settable GUCs never prove entrypoint identity. Parameter ACL
   revocation is not a USERSET denial mechanism: verify the cited PG17 distinction
   and require actual negative SET/set_config probes for any protected-parameter
   alternative. Do not accept a parameter ACL readback alone as spoof closure.
3. Are class ID 1463898704, global key 0 and immutable UNIQUE positive int4 org
   registry specified, with no hashing/reuse and exhaustion refusal? Check source
   and available catalog namespace conflicts, global-shared prefix for org
   controllers, new-org provisioning, ascending multi-org order, global-exclusive
   controller, no lock upgrade and no inverted registry/business ordering.
4. Is RECOVERY allowlist a server-code constant, initially only the literal
   rpc_reconcile_material_issue_setup(uuid,uuid,jsonb,uuid) entrypoint, with
   protected helper/context? No writable table or client flag may extend it.
5. Does one authority-revision/sequence NULLS LAST policy cover FINAL,
   IN_PROCESS and list projection? Can trusted append-only supersession outrank
   legacy NULL/arbitrary-high sequences without rewriting history? Missing
   validated replacement must remain blocked. These are future design only.
6. Are P02/P08 sustained-load, convoy/timeouts, marker spoofing, parameter bypass,
   dynamic writers, revision concurrency and complete inventory still mandatory
   gates? A one-waiter advisory sample is not sustained-load proof.

## Small validation delta

Run AST/compile, Ruff 0.16.10 including SIM208, format, full Bandit and whitespace.
Confirm only `if not (not thread.is_alive())` becomes `if thread.is_alive()`;
retain twelve raise sites and zero assert nodes. Check refusal controls if runner
source inputs are changed in scratch. PostgreSQL reproduction of the unchanged
REDs was already independently supplied for Round 3; do not invent a new run.
If reproducing, use disposable loopback PG17 only, preserve actual mutant output,
record all environment differences and prove cleanup. No hosted identity proof.

Return exact identities and drift, the four-file delta, concrete remaining
contract defects separately from future implementation/acceptance dependencies,
and a bounded PASS/FAIL for counterexample accuracy and contract suitability for
further review. If design choices remain unsafe, explain the precise mechanism;
do not accept owner/helper/marker claims on naming alone. This is not approval
for implementation readiness, merge or rollout. All 33 route dispositions,
G01–G08, P01–P12, service_role policy, separate F1 correction, #165, #278 and
NO-GO/M192 holds remain.
