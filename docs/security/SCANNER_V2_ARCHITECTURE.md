# Wardah ERP — SECURITY DEFINER Scanner v2 Architecture

> **2026-09-25 implementation reconciliation:** Scanner v2 Slices 1–4 are now present on `main@e3869c2f6f7485c423281e42dfc72504edca30e8` through merged PR #251. This architecture remains governing, but v2 has **not** replaced v1 as mandatory migration CI: `ci-cd.yml` still invokes `check_definer_guards.py`, the integrated Slice 4 proof starts from runtime-evidence fixtures, and v2 workflows remain path-scoped. Legacy #243 is closed; the remaining declared string-semantics follow-up is #252. Track mandatory end-to-end CI replacement under #247.


**Status:** Architecture decision / design contract  
**Purpose:** Replace the limits of the current static SECURITY DEFINER scanner with a sounder, PostgreSQL-backed acceptance architecture.  
**Trigger:** PR #246 Round 11 independent validation at `1508029ce1224d76aa087cfb645b7f6c9a19fc00` proved executable interprocedural ACL false-greens.  
**Scope:** CI / migration acceptance tooling only. This document does **not** modify Migration 191, Production SQL, RLS, or application behavior.

---

## 1. Decision

Scanner v1 has reached an architectural boundary.

Do **not** continue extending it with Round 12-style lexical/parser exceptions intended to model migration-time procedural side effects.

The decisive class is not another lexer edge case. PostgreSQL-valid migrations can:

- close EXECUTE with a top-level `REVOKE`;
- invoke a function/procedure through `DO ... PERFORM`, top-level `SELECT`, or `CALL`;
- let the invoked routine perform a static or dynamic `GRANT`;
- finish with the unguarded `SECURITY DEFINER` routine executable by `authenticated`;
- still cause Scanner v1 `check_file()` to return `[]`.

A two-level helper call chain reproduces the same behavior. Therefore the remaining soundness problem is fundamentally **interprocedural / runtime side-effect analysis**, not local SQL tokenization.

Scanner v2 must be designed around that fact rather than attempting to imitate PostgreSQL execution semantics in Python.

---

## 2. Evidence that triggered v2

Exact reviewed Scanner v1 head:

`1508029ce1224d76aa087cfb645b7f6c9a19fc00`

PostgreSQL oracle:

`PostgreSQL 17.11 (Ubuntu 17.11-1.pgdg24.04+2)`

Independently confirmed P2 false-green families:

| Family | Migration-time invocation | ACL side effect | Runtime result | Scanner v1 |
|---|---|---|---|---|
| I1 | `DO -> PERFORM helper()` | helper static `GRANT` | client EXECUTE restored | `[]` |
| I2 | `DO -> PERFORM helper()` | helper dynamic `EXECUTE 'GRANT ...'` | client EXECUTE restored | `[]` |
| I3 | `DO -> CALL procedure()` | procedure `GRANT` | client EXECUTE restored | `[]` |
| I4 | top-level `SELECT helper()` | helper `GRANT` | client EXECUTE restored | `[]` |
| I5 | top-level `CALL procedure()` | procedure `GRANT` | client EXECUTE restored | `[]` |
| I6 | two-level call chain | nested helper `GRANT` | client EXECUTE restored | `[]` |

Controls with harmless helpers remained safe.

This proves the defect is broader than `DO` parsing and broader than direct dynamic SQL.

---

## 3. Boundary with Migration 191

This architectural decision concerns the **acceptance scanner**, not Migration 191 production SQL.

Canonical M191 SHA256 remains:

`637a81caeaebea60693476222611b373dc1e738cd6b10c634bf4c236227f3f40`

The Scanner v2 project must not rewrite M191 or use scanner weaknesses as evidence that M191 itself is defective unless a separate runtime review proves an M191 defect.

---

## 4. Scanner v1 disposition

Scanner v1 remains useful for local/static checks that it can prove safely, including:

- SECURITY DEFINER discovery;
- recognized direct authorization guards;
- lexical masking and statement ownership;
- exact/probable routine identity in supported syntax;
- direct top-level function ACL replay;
- known fail-closed cases.

But Scanner v1 must no longer be treated as a complete proof of final ACL state for migrations that execute arbitrary procedural code after or around ACL closure.

### No further parser escalation

Do not add ad-hoc handling for:

- helper call graphs;
- arbitrary `SELECT` side effects;
- arbitrary `CALL` side effects;
- arbitrary `PERFORM` side effects;
- PL/pgSQL variable values;
- dynamic SQL construction;
- nested helper execution;
- runtime branch reachability.

Those are the boundary between static syntax analysis and execution semantics.

---

## 5. Design principles for Scanner v2

Scanner v2 must follow these principles.

### 5.1 PostgreSQL is the semantic oracle

Where PostgreSQL can answer identity, privilege, catalog, or execution questions directly, Scanner v2 should ask PostgreSQL rather than reimplementing those semantics.

Examples:

- routine identity / overload resolution;
- type identity and aliases;
- quoted vs unquoted catalog names;
- effective EXECUTE privileges;
- default function privileges;
- final catalog state after a migration;
- search-path-sensitive resolution where practical.

### 5.2 Separate syntax from policy

Scanner v2 should have explicit layers:

1. **Discovery / ownership** — where statements and routine bodies live.
2. **Catalog identity** — what PostgreSQL object each statement refers to.
3. **Execution evidence** — what catalog/privilege state actually exists after migration execution in an isolated database.
4. **Security policy** — whether that resulting state is acceptable for Wardah.

No single regex/parser path should carry all four responsibilities.

### 5.3 Fail closed on unresolved execution effects

If Scanner v2 cannot prove the final authorization/ACL state of an unguarded SECURITY DEFINER routine, the acceptance result must be non-green.

Unknown is not equivalent to closed.

### 5.4 Do not simulate arbitrary PL/pgSQL

Scanner v2 must not become a general PL/pgSQL interpreter or symbolic executor.

Runtime semantics should be established through isolated PostgreSQL execution where possible, not reconstructed in Python.

### 5.5 Reproducibility first

A green result must be reproducible from:

- a frozen repository SHA;
- a declared PostgreSQL major/minor version;
- a deterministic baseline schema/migration chain;
- a deterministic set of client roles;
- exact post-migration catalog queries;
- preserved evidence artifacts/logs.

---

## 6. Proposed v2 architecture

### Layer A — Static preflight

Purpose: reject obviously unsafe or unsupported input before database execution.

Responsibilities:

- detect SECURITY DEFINER routines;
- detect recognized authorization guards where policy requires them;
- detect malformed/unparseable scanner inputs;
- classify migration statements and ownership boundaries;
- record routines whose acceptance depends on ACL closure instead of a guard;
- flag procedural invocation surfaces for later runtime proof.

Static preflight must not claim final ACL safety.

### Layer B — Disposable PostgreSQL execution

Purpose: execute the migration chain in the same PostgreSQL major version used for acceptance.

Requirements:

- Fresh isolated PostgreSQL instance/database;
- no Production or Staging access;
- exact baseline through the required cutoff;
- migration under review applied normally;
- fail hard if setup/execution is incomplete;
- no clean result when the oracle is dead or execution counts collapse.

### Layer C — Catalog and privilege proof

After migration execution, query PostgreSQL directly for every relevant SECURITY DEFINER routine.

At minimum collect:

- `pg_proc` identity / OID / schema / arguments;
- `prosecdef`;
- `proacl`;
- `proconfig` / search path where relevant;
- effective `has_function_privilege` for `PUBLIC`, `anon`, `authenticated`, and other policy roles;
- owner and grant provenance where available;
- whether the routine is reachable by a client role.

The core security property is evaluated against the **final database state**, not a replay guessed from source text.

### Layer D — Guard contract proof

For client-callable SECURITY DEFINER routines, prove one of the approved states:

1. the function is not client-callable under Wardah's ACL policy; or
2. the function contains an approved authorization boundary whose soundness is established by the guard scanner / dedicated tests.

A client-callable, unguarded SECURITY DEFINER routine fails.

### Layer E — Policy engine

The policy engine consumes evidence; it does not parse PostgreSQL syntax itself.

Suggested outcomes:

- `PASS_PROVEN_CLOSED`
- `PASS_GUARDED`
- `FAIL_CLIENT_CALLABLE_UNGUARDED`
- `FAIL_GUARD_SWALLOWED_OR_UNREACHABLE`
- `FAIL_ORACLE_INCOMPLETE`
- `FAIL_UNRESOLVED`

Avoid a single boolean where the evidence category matters.

---

## 7. Restricted migration policy / DSL option

Even with PostgreSQL execution evidence, Wardah should consider a migration-authoring policy that reduces opaque procedural ACL mutation.

Candidate policy for new migrations:

- ACL changes should be explicit top-level `GRANT` / `REVOKE` statements where practical;
- migration-time helper functions/procedures should not mutate routine ACL unless explicitly declared and acceptance-tested;
- dynamic SQL that changes routine privileges should be prohibited or require a dedicated reviewed exception;
- new SECURITY DEFINER routines should prefer direct explicit post-definition ACL statements;
- procedural calls after an ACL closure should require runtime final-state proof.

This is a policy/DSL constraint, not an attempt to ban PostgreSQL capabilities globally.

---

## 8. Relationship to issue #243

Scanner v2 should absorb the three known #243 limitations into the new architecture rather than continuing to treat them as independent parser exceptions:

1. `standard_conforming_strings = off`;
2. custom denial SQLSTATE swallowed by a matching handler;
3. schema-wide `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA` reopening after explicit REVOKE.

In v2:

- final ACL/catalog state should make schema-wide grant reopening observable;
- PostgreSQL execution removes much of the need to manually emulate string/parser identity;
- guard exception semantics may still require static/runtime targeted proof, but should remain isolated from ACL-state proof.

#243 has since been reconciled/closed. The remaining declared session/string-semantics boundary is tracked separately by #252; this document does not close #252.

---

## 9. Acceptance corpus

Scanner v2 must preserve the full historical adversarial corpus from Scanner v1 and add runtime-first cases.

### Static / lexical regression

Preserve coverage for:

- comments/literals/dollar quotes;
- quoted/U& identifiers;
- SQLSTATE forms;
- swallowed authorization failures;
- labelled EXIT/RETURN reachability;
- quoted/unquoted type identity;
- type aliases and modifiers;
- overload ACL matching;
- `REVOKE GRANT OPTION FOR`;
- statement ownership;
- ALTER SECURITY state.

### Runtime ACL corpus

Must include:

- direct top-level REVOKE/GRANT;
- schema-wide grants;
- default grants;
- DO direct static/dynamic ACL;
- DO indirect helper ACL;
- top-level SELECT helper side effects;
- CALL procedure side effects;
- multi-level call chains;
- dynamic SQL;
- harmless procedural calls as controls;
- later exact closure recovery;
- cross-role effective privilege checks.

A runtime false-green count greater than zero is a release blocker for the scanner.

---

## 10. Differential / fuzz testing

Scanner v2 should include differential generation where practical:

1. generate PostgreSQL-valid migrations/routine signatures/ACL variants;
2. execute them on disposable PostgreSQL;
3. query ground-truth final effective privileges;
4. compare scanner verdicts;
5. record false-green and conservative false-red counts separately.

Security objective:

`false_green = 0`

False-reds may be tolerated when deliberately fail-closed and documented, but should be measured and reduced without weakening soundness.

---

## 11. CI integration

Recommended CI flow:

```text
Static Scanner v2 preflight
        │
        ▼
Fresh PostgreSQL acceptance DB
        │
        ▼
Apply baseline + migration under review
        │
        ▼
Catalog / effective privilege snapshot
        │
        ▼
Guard contract evaluation
        │
        ▼
Policy verdict + evidence artifact
```

CI must report the PostgreSQL version, migration cutoff, target SHA, and evidence counts.

A skipped or failed oracle stage must never be represented as a pass.

---

## 12. Performance / cost discipline

Scanner v2 should not execute an unnecessarily large matrix on every local edit.

Suggested tiers:

- **Fast local/static tier:** syntax/guard checks only.
- **PR acceptance tier:** fresh PostgreSQL final-state proof for changed/new migrations.
- **Release/frozen-SHA tier:** full historical runtime corpus + differential oracle + rollback/reapply gates where applicable.

Cache/build optimizations may reduce setup cost, but must not reuse mutable database state across security acceptance runs.

---

## 13. Evidence artifact contract

Every frozen-SHA acceptance run should preserve at least:

- target commit SHA;
- scanner version;
- PostgreSQL exact version;
- applied migration range;
- SECURITY DEFINER routine inventory;
- effective client EXECUTE matrix;
- guard classification per routine;
- final verdict per routine;
- false-green/false-red corpus counts;
- oracle health/liveness evidence;
- CI run ID.

This evidence should be consumable by the final Wardah/Genspark reporting package without reinterpreting raw logs.

---

## 14. Migration from v1 to v2

Recommended sequence:

1. Freeze Scanner v1 feature growth after the #246 architectural-boundary record.
2. Keep existing v1 tests as regression assets.
3. Build v2 side-by-side; do not silently replace v1 during development.
4. Run v1 and v2 in parallel on the repository migration corpus.
5. Reproduce all known v1 false-greens as RED against v1 and GREEN against v2.
6. Preserve the closed #243 classes in v2 regression acceptance and reconcile the remaining #252 fail-closed boundary.
7. Obtain independent review of v2 architecture and implementation.
8. Only then change the mandatory CI acceptance contract from v1 to v2.

---

## 15. Exit criteria for Scanner v2

Scanner v2 is eligible to replace v1 only when all are true:

- PostgreSQL 17 runtime oracle is mandatory and fail-hard;
- all known v1 executable false-greens are reproduced and closed;
- interprocedural ACL side-effect corpus has zero false-greens;
- the closed #243 classes remain covered by regression evidence, and #252 is closed or explicitly governed by a separately approved fail-closed rule;
- effective privileges are derived from final PostgreSQL catalog state;
- no migration-history rewrite;
- no blanket exemption added to hide findings;
- no Production/Staging dependency;
- historical scanner regression suite remains green;
- independent reviewers agree on the frozen implementation SHA;
- documentation and runbooks identify evidence limits precisely.

---

## 16. PR #246 disposition

PR #246 should be treated as the durable record of Scanner v1 hardening through Round 11 and of the point where v1's architectural boundary became executable and independently demonstrated.

It should not be extended indefinitely to implement Scanner v2.

Whether #246 is later merged for the value of its already-proven local hardening is a separate owner decision and must not be interpreted as claiming Scanner v1 provides complete runtime ACL proof.

No Ready/merge/Production action is authorized by this document.

---

## 17. Architectural conclusion

The scanner problem changed category.

Earlier defects were largely about faithfully reading PostgreSQL syntax and local control flow. The Round 11 follow-up proved that a migration's final ACL can be changed through arbitrary executed routines without the ACL-changing text appearing at the call site.

At that point, soundness requires either:

- runtime final-state evidence from PostgreSQL;
- a restricted migration policy that makes procedural ACL mutation impossible/explicit;
- or full interprocedural execution analysis.

Wardah chooses the first two. It explicitly rejects building a general PostgreSQL/PLpgSQL interpreter inside Scanner v1.
