# M191 — final-review remediation (PR #241)

**This is not a rewrite of the Slice 12 evidence.** `M191_SLICE12_EVIDENCE.txt`,
`M191_ROLLBACK_REHEARSAL_EVIDENCE.txt` and `README.md` remain the historical record for
the SHAs they name. This file records a *later* round of work and says plainly that the
tests below did **not** exist at the head they were found against.

## Reviewed head

| Field | Value |
|---|---|
| Head reviewed by Astra/Codex | `fa1de77f07077af97623c34c0a743b5d00000785` |
| Findings | 3 acceptance/CI defects (no production-body defect) |
| `sql/migrations/191_f2_stock_write_concurrency_closure.sql` | **unchanged** by this remediation |
| Reproduction platform | PostgreSQL **17.11** (`17.11-1.pgdg24.04+2`), fresh cutoff-189 baseline + 190 + 191 |
| Production / Staging | **not touched** — no apply, no connection, no merge |

All three findings are in the *proof* layer: they let a defect through, they are not
themselves defects in Migration 191's behaviour. Each was reproduced first, on a Fresh
PostgreSQL 17 built exactly as the acceptance workflow builds it, before any fix was
written.

---

## Finding 1 — SECURITY DEFINER scanner false green

**Where:** `scripts/ci/check_definer_guards.py`

### Reproduction (at the reviewed head)

`mask_sql()` masked comments and single-quoted literal content correctly at the top
level, but once it entered a dollar-quoted function body it masked only `--` line
comments. Everything else non-executable inside the body stayed visible to `GUARD_RE`.
Feeding `check_file()` synthetic migrations, at the reviewed head:

| Body of an unguarded `SECURITY DEFINER` function | verdict at `fa1de77` |
|---|---|
| no guard at all | REJECT (correct) |
| `PERFORM 'wardah_assert_org_member';` | **ACCEPT** ← false green |
| `/* wardah_assert_org_member */` | **ACCEPT** ← false green |
| `/* outer /* wardah_assert_org_member */ still outer */` | **ACCEPT** ← false green |
| `RAISE NOTICE $$wardah_assert_org_member$$;` | **ACCEPT** ← false green |
| `-- wardah_assert_org_member` | REJECT (already correct) |
| `PERFORM public.wardah_assert_org_member(p_org);` | ACCEPT (correct) |

An unguarded `SECURITY DEFINER` function passed CI merely because the authorization
helper's **name** appeared in non-executable text.

### Fix

`mask_sql` is replaced by a body-aware, length-preserving masker (`mask_sql_checked`,
with `mask_sql` kept as a thin wrapper). Inside the outer dollar-quoted function body it
now also masks single-quoted literal content (including doubled `''` and `E''` backslash
escapes), block comments honouring PostgreSQL's nesting, and nested dollar-quoted
literals (`$$…$$`, `$tag$…$tag$`). Line comments stay masked as before. Executable
PL/pgSQL is untouched and the outer body is **not** made to disappear — `GUARD_RE` still
inspects it.

Offsets are preserved character for character (newlines included), which the
`SECURITY DEFINER` → owning-`CREATE FUNCTION` attribution depends on.

Fail-closed: an unterminated block comment, single-quoted literal, nested dollar quote or
outer function body is reported as an error rather than scanned as executable text.
`_dollar_tag_at` also follows PostgreSQL's rule that a tag begins with a letter or
underscore, so `$1` is a positional parameter and not a quote opener.

### RED / GREEN proof

* RED: `scripts/ci/test_check_definer_guards.py` run against the scanner as it stood at
  `fa1de77` → **9 failures + 2 errors**.
* GREEN: the same file against the fixed scanner → **6 tests, OK**. Every false-green
  shape above now rejects; the real executable guard, the `REVOKE … FROM PUBLIC`
  exemption and a body carrying both a decoy and a real call still accept.
* No regression on real files: `check_file()` verdicts were diffed before/after across
  all 242 committed `sql/migrations/*.sql` + `sql/baseline/*.sql` → **no verdict changed
  on any file**, and none trips the fail-closed path (asserted permanently by
  `test_repository_migrations_remain_scannable`).
* `python3 scripts/ci/check_definer_guards.py` → exit 0, `61 migration(s)`.

### CI wiring

`scripts/ci/test_check_definer_guards.py` runs immediately before
`check_definer_guards.py` in `ci-cd.yml`, and again in the M191 acceptance job.

---

## Finding 2 — Fix F acceptance could not discriminate a reversed lock order

**Where:** `docs/db/m191-evidence/harness/s9_fixf.sh` and the static gate

### Reproduction (at the reviewed head)

The real `public.release_expired_reservations(uuid)` body was mutated in place, changing
exactly one line — `ORDER BY mr.id` → `ORDER BY mr.id DESC` — on the Fresh PG17 database.
Every existing gate stayed **GREEN**:

| Gate | verdict against the DESC mutant |
|---|---|
| `acceptance_191_f2_stock_write_concurrency.sql` | `M191_ACCEPTANCE_CONTRACT_PASS` |
| `12_acceptance_static_gates.sql` | `M191_ACCEPTANCE_STATIC_PASS` |
| `harness/s9_fixf.sh` (§9.1–§9.3) | `SLICE12_S9_PASS` |

Why the old §9 could not see it: §9.1 compares two **handwritten** test-only functions
and says nothing about the deployed body; §9.2 lets the real release *finish* before
consumption starts competing, so it proves serialization, not acquisition **order**;
§9.3 is a business-semantics scenario with no concurrency at all. The static gate skipped
`release_expired_reservations` entirely, because check 5 covers only bodies that take the
shared product prefix and Fix F takes none.

### Fix — static layer

New `pg_temp.m191_assert_fix_f_release_lock_contract` in `12_acceptance_gate_defs.sql`,
called from `12_acceptance_static_gates.sql` (check 8) on the deployed body. It runs on
the existing Slice 12 masked executable text — not a raw grep — and yields six distinct
verdicts, ordered so the specific one is reached before the generic one:

1. `FIX_F_LOCK_SOURCE_MISSING` — no `FROM public.material_reservations mr`
2. `FIX_F_DESCENDING_LOCK_ORDER` — `ORDER BY mr.id DESC`
3. `FIX_F_FOR_UPDATE_REINTRODUCED` — bare `FOR UPDATE`
4. `FIX_F_SKIP_LOCKED_PRESENT` — `SKIP LOCKED`
5. `FIX_F_ORDERED_LOCK_MISSING` — ordering and lock mode not one contiguous clause
6. `FIX_F_UPDATE_BEFORE_ORDERED_LOCK` — an `UPDATE public.material_reservations` ahead of
   the ordered lock

Because it matches masked text, a matching shape that survives only in a comment or a
string literal cannot satisfy it.

Self-acceptance: `12_acceptance_gate_selftest.sql` gains a second block emitting
`M191_GATE_SELFTEST_REMEDIATION_PASS`, with **8 Fix F mutants** (one per verdict above,
plus the comment-only and string-only shapes) and one positive.

### Fix — runtime layer

`s9_fixf.sh` gains §9.4 and §9.5, which probe the **deployed** function, not a stand-in.

`probe_acquisition_order` builds two independent single-row blockers — `blocker_R1` holds
only the lower-uuid reservation, `blocker_R2` only the higher — asserts the fixture
precondition `R1 < R2` using PostgreSQL's own uuid comparison, then starts the real
release and reads its acquisition sequence out of `pg_blocking_pids()` via
`blockers_of` / `wait_for_any_blocker` / `wait_for_blockers` (new in `lib.sh`). Releasing
the blocker it is *actually* waiting on is what lets it advance, so the recorded sequence
is the order the function itself chose. **No sleep-only timing is used anywhere**; every
transition is observed backend state, printed as `EVIDENCE[… first]` / `EVIDENCE[… second]`
with the blocking pid.

§9.5 derives a DESC mutant **from the deployed body** via `pg_get_functiondef`, asserting
that the rename succeeded, that `ORDER BY mr.id` occurs exactly once, and that the mutant
differs from the deployed body in **exactly one line**. The identical probe then runs
against it. The mutant is dropped by an `EXIT` trap, so it does not survive a failure
path either, and §9.5 asserts no `public.zz\_%` function is left behind.

§9.1, §9.2 and §9.3 are **retained unchanged**: release-wins, consume-wins/exhausted
reservation, exact `quantity_released`, and no partial material consumption. The probe
supplements them.

### RED / GREEN proof

* GREEN (real function): `observed acquisition order (real function) = R1->R2 status=0
  returned=2`, with `EVIDENCE[s9f-p4 first] … blocked_by=<blocker_R1 pid>` then
  `EVIDENCE[s9f-p4 second] … blocked_by=<blocker_R2 pid>`.
* Discriminator (§9.5): `observed acquisition order (DESC mutant) = R2->R1` — the probe
  demonstrably distinguishes the two orders, so §9.4's result is not vacuous.
* RED: with the DESC mutation applied to the **real** function, the strengthened
  `s9_fixf.sh` exits **1** with
  `SLICE12_FAIL[9.4]: the deployed release_expired_reservations acquired reservations in
  R2->R1, not ascending R1->R2`, and the trap still left **0** `zz_%` functions behind.
* RED (static): the same mutation makes `12_acceptance_static_gates.sql` fail with
  `M191_ACCEPTANCE_FIX_F_DESCENDING_LOCK_ORDER: release_expired_reservations`.

---

## Finding 3 — no UUID parser-parity acceptance for Fix E

**Where:** the acceptance layer for `rpc_post_goods_receipt` / `rpc_post_delivery_note`

### Reproduction (at the reviewed head)

The production prepasses correctly gate their candidate cast with
`pg_input_is_valid(…, 'uuid')`. Nothing proved it: at `fa1de77` there was no
`pg_input_is_valid` assertion anywhere in the acceptance layer, and no fixture used any
UUID spelling other than canonical 8-4-4-4-12. A regression to a hand-written canonical
regex would therefore have stayed GREEN while rejecting PostgreSQL-valid spellings — such
a line silently drops out of the prelock set and then dies in the unchanged loop at
`PRODUCT_NOT_PRELOCKED`.

### Fix — runtime layer

New `docs/db/m191-evidence/harness/s8c_uuid_parity.sh`, a full 2×2 of **real** RPC calls
on legitimate disposable fixtures (`s8_fixture.sh`, unchanged; no predecessor business
validation is weakened — the payloads are the ordinary ones with one identifier
respelled):

| | brace-wrapped `{…}` | 32-hex hyphenless |
|---|---|---|
| `rpc_post_goods_receipt` (`product_id`) | 8.C1 | 8.C2 |
| `rpc_post_delivery_note` (`sales_invoice_line_id`) | 8.C3 | 8.C4 |

Each case asserts the call succeeds exactly as a canonical UUID would, that it does
**not** fail with `PRODUCT_NOT_PRELOCKED`, that the persisted line resolved to the right
product / invoice line, and that the bin moved by the expected quantity. §12
reconciliation runs for both products at the end.

§8.C5 proves the matrix is not vacuous: a canonical-only-regex mutant derived from the
**deployed** goods receipt body (validator call replaced, nothing else) is run against
8.C1's payload and must fail with `PRODUCT_NOT_PRELOCKED`. The mutant is dropped by an
`EXIT` trap, and §8.C5 asserts no `zz_%` function and no orphan goods receipt survives.

### Fix — static layer

New `pg_temp.m191_assert_uuid_parser_parity`, called from `12_acceptance_static_gates.sql`
(check 9) for **exactly two** bodies — `rpc_post_goods_receipt` with candidate key
`product_id`, and `rpc_post_delivery_note` with `sales_invoice_line_id`. It positively
asserts `pg_input_is_valid(…, 'uuid')` in executable position gating a `::uuid` cast, and
rejects canonical-only regex forms.

**Scope is deliberate and narrow.** The assertion takes one body and one key. It does
**not** grep the repository or `docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md`, whose historical
text intentionally carries superseded regex examples; those remain untouched.

Self-acceptance: 5 mutants in the remediation selftest block — canonical regex in place of
the validator, a canonical regex alongside a still-present validator, the validator
present only in a comment, a validator that gates something other than the candidate cast,
and a prepass that no longer reads the candidate key.

### RED / GREEN proof

* GREEN: `SLICE12_S8C_PASS` — 8.C1 `{…}` → A bin `100 → 104`; 8.C2 hyphenless → B bin
  `100 → 104`; 8.C3 `{…}` → A bin `104 → 101`; 8.C4 hyphenless → B bin `104 → 101`; both
  reconciliations clean.
* RED: 8.C5 → `PRODUCT_NOT_PRELOCKED: 00002295-0000-0000-0000-00000000000a` raised by
  `zz_m191_testonly_gr_canonical_uuid`, i.e. the canonical-only regex does drop the
  brace-wrapped id — so 8.C1–8.C4 are discriminating results.

---

## Codex P1 on `has_function_privilege('public', …)` — reviewer false positive

Codex reported that `has_function_privilege('public', …)` in
`scripts/ci/fresh-db/acceptance_191_f2_stock_write_concurrency.sql` would error because
PUBLIC is not a role. This was **reproduced against PostgreSQL 17.11** rather than acted
on from the report:

```
SELECT has_function_privilege('public','public.release_expired_reservations(uuid)','EXECUTE');
 t
```

The access-privilege inquiry functions accept `public` as the pseudo-role PUBLIC. The
existing CI evidence (the catalog contract passing on PG17) is consistent with this.
**Classified as a reviewer false positive; no code change made.** The catalog logic is
correct as written.

---

## Workflow integration

`.github/workflows/f2-stock-write-concurrency-191-acceptance.yml`:

* new step **SECURITY DEFINER scanner selftest** → `test_check_definer_guards.py` then
  `check_definer_guards.py`;
* the gate step now also requires `M191_GATE_SELFTEST_REMEDIATION_PASS`;
* the GREEN battery is **14** scripts — `s8c_uuid_parity` added beside `s8_fixe` (they
  share `s8_fixture.sh`), and `s9_fixf` now carries §9.4/§9.5;
* `scripts/ci/check_definer_guards.py` and its test are added to the `paths:` trigger;
* `/tmp/191-definer-selftest.out` is uploaded with the evidence bundle.

`harness/rollback_rehearsal.sh` adds `s8c_uuid_parity.sh` to `run_green_suite`, so forward
recovery re-runs the strengthened battery too.

Deterministic GREEN job order is unchanged otherwise: catalog contract → static gate
selftest → static gate → runtime battery → reconciliation.

## Files changed

| File | Change |
|---|---|
| `scripts/ci/check_definer_guards.py` | body-aware length-preserving masker; fail-closed reporting |
| `scripts/ci/test_check_definer_guards.py` | **new** — scanner regression tests against `check_file()` |
| `.github/workflows/ci-cd.yml` | run the scanner selftest before the scanner |
| `docs/db/m191-slices/12_acceptance_gate_defs.sql` | Fix F lock-order + Fix E UUID-parity assertions |
| `docs/db/m191-slices/12_acceptance_gate_selftest.sql` | remediation self-acceptance block (3 positives, 13 mutants) |
| `docs/db/m191-slices/12_acceptance_static_gates.sql` | checks 8 and 9 |
| `docs/db/m191-evidence/harness/lib.sh` | `blockers_of`, `wait_for_any_blocker`, `wait_for_blockers` |
| `docs/db/m191-evidence/harness/s9_fixf.sh` | §9.4 real acquisition-order probe, §9.5 DESC mutant discriminator |
| `docs/db/m191-evidence/harness/s8c_uuid_parity.sh` | **new** — Fix E 2×2 parity matrix + canonical-regex discriminator |
| `docs/db/m191-evidence/harness/rollback_rehearsal.sh` | `s8c_uuid_parity.sh` in the forward-recovery battery |
| `.github/workflows/f2-stock-write-concurrency-191-acceptance.yml` | invoke all of the above |
| `docs/db/m191-evidence/README.md` | pointer to this file |
| `docs/db/F2_STOCK_WRITE_CONCURRENCY_191_RUNBOOK.md` | pointer to this file |

`sql/migrations/191_f2_stock_write_concurrency_closure.sql` is **not** in this list: no
test added here demonstrated the production body to be wrong.

## Local verification before push

On a Fresh PostgreSQL 17.11 built exactly as the workflow builds it
(cutoff-189 baseline pair → chain through 190 and 191):

| Step | Result |
|---|---|
| `test_check_definer_guards.py` | `Ran 6 tests … OK` |
| `check_definer_guards.py` | exit 0, `61 migration(s)` |
| catalog contract | `M191_ACCEPTANCE_CONTRACT_PASS` |
| gate selftest | `M191_GATE_SELFTEST_PASS: positive=7 mutants=15` **and** `M191_GATE_SELFTEST_REMEDIATION_PASS: positive=3 mutants=13 (fix_f=8 uuid_parity=5)` |
| static gate | `M191_ACCEPTANCE_STATIC_PASS: … fix_f=ordered_asc_no_key_update uuid_parity=2/2_pg_input_is_valid` |
| GREEN battery (14 scripts) | all `OK` |
| reconciliation | `M191_RECONCILIATION_PASS` |
| rollback rehearsal + forward recovery | `M191_ROLLBACK_REHEARSAL_PASS` |

## Post-push identifiers

Recorded in the follow-up commit on this branch once CI has run:

| Field | Value |
|---|---|
| Remediation head SHA | _recorded after push_ |
| M191 acceptance workflow run | _recorded after push_ |
| Job `acceptance` | _recorded after push_ |
| Job `rollback` | _recorded after push_ |
