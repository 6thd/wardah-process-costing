# SECURITY DEFINER scanner — acceptance-layer hardening

**Scope:** `scripts/ci/check_definer_guards.py` and its acceptance layer.
**Migration 191 production SQL is byte-unchanged.** `sql/migrations/191_f2_stock_write_concurrency_closure.sql`
stays at `md5 ff7b8c01a59e290825056b11ed9febbd`; nothing in this pass edits it.
**Zero `KNOWN_EXEMPT` entries were added** — the set is asserted intact by
`test_no_new_known_exempt_entries`, and is now *narrowed* rather than widened.

---

## 1. Why this is one pass and not six regex patches

Five of the six accepted findings have the same root: the scanner attributed
`SECURITY DEFINER` **by position** — find the phrase, walk backwards to the
nearest `CREATE ... FUNCTION`, take the next 4000 characters as the body, and
accept any `REVOKE ... FROM PUBLIC` that happened to sit before the next
`CREATE`. Every one of those steps is an assumption about layout, not about
identity, and each finding is a different way to violate the layout while
staying valid SQL.

Patching them individually would have added six more layout assumptions. The
pass instead parses each file's statements **once**, into identities:

```
CREATE/ALTER FUNCTION  ->  Identity(schema, name, arg-type list)  + own extent
GRANT/REVOKE           ->  Identity targets + grantees + order
```

and every later rule reads that model. A definition owns only its own statement,
so it cannot borrow the next function's body; a REVOKE is credited only to the
function it names; an `ALTER ... SECURITY DEFINER` is a statement in its own
right rather than something blamed on its neighbour; and a quoted identity is
read from the unmasked source, case intact.

The sixth finding — exception categories — is not attribution but PostgreSQL
semantics, and is handled by resolving handler conditions properly rather than
by adding alternatives to a regex.

## 2. Which layer owns what

The instruction was explicit: catalog-backed validation where PostgreSQL
semantics are required, static scanning only for structural guarantees, and no
attempt at a PL/pgSQL compiler. The split:

| Question | Layer | Why |
|---|---|---|
| Is the guard an executable call, at outer level, reachable, un-swallowed? | static | structure inside one file's bytes |
| Does this REVOKE name this function and this overload? | static | structure inside one file's bytes |
| Is this `ALTER ... SECURITY DEFINER` guarded by anything? | static | nothing to read — rejected structurally |
| Is a quoted identity a different function from an exempt name? | static | identity is textual |
| Does `WHEN plpgsql_error` catch a `RAISE EXCEPTION`? | **catalog** | PostgreSQL's matching rule, asserted live |
| Which functions really ARE `SECURITY DEFINER` after the whole chain? | **catalog** | a later migration's ALTER is invisible per-file |
| Who really holds EXECUTE at the end? | **catalog** | the ACL is the authority, not the DDL text |
| Does a guard NAME still resolve to the reviewed helper? | **catalog** | overload resolution is the database's job |

Static: `scripts/ci/check_definer_guards.py`, `scripts/ci/test_check_definer_guards.py`.
Catalog: `scripts/ci/fresh-db/acceptance_definer_guard_contract.sql`, proved
falsifiable by `scripts/ci/fresh-db/selftest_definer_guard_contract.sh`.

## 3. The REDs, reproduced through the real `check_file()` first

Every row below returned `[]` — accepted, no error — at the reviewed head
`afc0272a09070e4a9c60c68c0eac4b8447e7ce14`, from a temporary `999_*.sql`
(strict) or `150_*.sql` (historical) fixture driven through `check_file()`
itself, not through a helper.

### D — exception categories catching authorization failures

Fixture shape: the assertion at the function's own outer statement level, the
handler on the function's own `BEGIN`, a privileged write in the handler. So
placement cannot be the reason it passed.

| Handler | Before | After |
|---|---|---|
| `WHEN plpgsql_error` (class P0000) | accepted | rejected |
| `WHEN SQLSTATE 'P0000'` | accepted | rejected |
| `WHEN SQLSTATE /* reason */ 'P0001'` | accepted | rejected |
| `WHEN unique_violation OR plpgsql_error` | accepted | rejected |
| `WHEN unique_violation OR SQLSTATE 'P0001'` | accepted | rejected |
| `WHEN OTHERS` / `raise_exception` / `SQLSTATE 'P0001'` | rejected | rejected |
| `WHEN unique_violation` / `foreign_key_violation` / `data_exception` | accepted | **accepted** (no false red) |

PostgreSQL matches a handler either on the exact SQLSTATE or on its **category**
— a code whose last three characters are `000`. A bare `RAISE EXCEPTION` is
P0001, whose category is P0000, so `plpgsql_error` catches it. Verified live,
not inferred, and pinned by §1 of the catalog contract.

Handler conditions are now resolved on **masked structure** with only the
SQLSTATE *value* recovered from the raw source. That is what makes the
comment-separated form resolve without a separator regex having to anticipate
comments: by the time the condition is read, the comment is whitespace.

Unknown condition names are treated as non-catching, and that is sound rather
than optimistic: PostgreSQL rejects an unrecognized condition name at compile
time, so an attacker cannot invent one. Only `OTHERS`, `raise_exception` and
`plpgsql_error` can reach P0001.

### E — unreachable guards due to control flow

`RETURN` was modelled; an aborting `RAISE` at the outer statement level was not.

```sql
RAISE EXCEPTION 'NOT_IMPLEMENTED';
PERFORM public.wardah_assert_org_member(p_org);   -- accepted; never executes
```

A raise **inside a conditional** is not an exit and must not cost a real guard
its recognition — `IF p_org IS NULL THEN RAISE ...; END IF;` before the
assertion is a positive control. `RAISE NOTICE` is not an abort. The rule is
strict-contract only, like the RETURN rule it extends.

### F — body attribution (the same class, from the other side)

```sql
CREATE FUNCTION public.f_unreadable(p_org uuid) ... LANGUAGE internal
  SECURITY DEFINER AS 'boolin';      -- no dollar-quoted body of its own
CREATE FUNCTION public.f_guarded(p_org uuid) ... AS $guarded$ ... PERFORM guard ... $guarded$;
```

The body extractor searched **forward** for the first `AS $tag$`, so
`f_unreadable` was scanned using `f_guarded`'s body and inherited its guard. A
definition is now bounded by its own statement; a `SECURITY DEFINER` routine
whose body the scanner cannot read is rejected, never lent someone else's. The
SQL-standard `BEGIN ATOMIC` body is rejected the same way, at every migration
age.

### G — misleading REVOKE attribution

| Fixture | Before | After |
|---|---|---|
| `REVOKE ... ON FUNCTION public.f_somewhere_else(uuid) FROM PUBLIC` | accepted | rejected |
| `REVOKE ... ON FUNCTION public.f_c(text)` for a definition of `f_c(uuid)` | accepted | rejected |
| REVOKE from PUBLIC, then `GRANT ... TO PUBLIC` | accepted | rejected |
| REVOKE placed **before** the definition | accepted | rejected |
| `REVOKE ... ON ALL FUNCTIONS IN SCHEMA public` | accepted | rejected (not attribution) |
| close PUBLIC, grant `authenticated` (strict) | accepted | rejected |
| close PUBLIC, grant `authenticated` (≤190) | accepted | **accepted** — see below |

The exemption is now an ACL replay against the definition's own identity:
PostgreSQL grants EXECUTE to PUBLIC on every new function, so the surface starts
open, only a REVOKE that names this function closes it, and a later GRANT
re-opens it.

**Historical compatibility is explicit and bounded.** Requiring `anon` and
`authenticated` to be closed as well — which is what the project contract has
always said, "اسحب EXECUTE من PUBLIC **والعملاء**" — turns three immutable
historical migrations red: `123_fix_user_profile_trigger_and_active_guards.sql`
(`wardah_is_org_admin`), `175_rbac_consumer_migration_rpcs.sql`
(`rpc_set_org_admin`) and `186_stock_moves_contract_repair.sql`
(`rpc_complete_manufacturing_order`), each of which closes PUBLIC and grants
`authenticated` while carrying its own reviewed authorization. So the full
client closure is required **from the strict cutoff on**, and below it the
historical PUBLIC-only test is preserved. The cutoff is a migration NUMBER; no
function is exempted by name.

A PUBLIC re-grant is rejected at every age — that one is not a historical
practice, it is a defect.

### H — `ALTER FUNCTION ... SECURITY DEFINER`

| Fixture | Before | After |
|---|---|---|
| `ALTER FUNCTION public.f_legacy(uuid) SECURITY DEFINER;` alone | accepted (no CREATE to attribute to → skipped) | rejected |
| the same, after a guarded function | accepted (borrowed that guard) | rejected |
| the same, closed then `GRANT ... TO PUBLIC` | accepted | rejected |
| `ALTER ... SECURITY INVOKER` (migration 120's shape) | accepted | **accepted** |
| ALTER of a function this migration defines and guards | accepted | **accepted** |
| ALTER plus a named full closure | accepted | **accepted** |

An ALTER restates no body, so there is nothing to prove a guard from. It is
accepted only when the same migration also defines that exact function — whose
CREATE was checked on its own terms — or closes it to every client role. The
repository contains no `ALTER FUNCTION ... SECURITY DEFINER` today, so this
rule costs nothing now and closes the door before it is used.

### I — quoted function identities

`CREATE FUNCTION public."f_quoted"(...)` matched no definition at all: the name
pattern read the MASKED text, where quoted-identifier content is blanked by
design. Its `SECURITY DEFINER` was therefore attributed to an earlier function
or dropped. Identities are now read from the unmasked source with case intact,
which also settles `public."HAS_PERMISSION"` — a *different* function from
`has_permission`, and no longer able to inherit its exemption. Another schema's
same-named function is likewise no longer conflated with `public`'s.

### J — overload guard impersonation

| Fixture | Before | After |
|---|---|---|
| new overload `public.has_permission(uuid)` in a strict migration | accepted (exempt by name) | rejected |
| the migration defines a no-op `wardah_assert_org_member(text)` and calls it | accepted | rejected |
| `PERFORM public.wardah_assert_org_member()` — zero args | accepted | rejected |
| `PERFORM public.wardah_assert_org_member(p_org, p_org)` | accepted | rejected |
| `IF NOT wardah_is_org_member(p_org, p_org) THEN RAISE` | accepted | rejected |

Three separate closures, because an overload is a different function in
PostgreSQL: `KNOWN_EXEMPT` stops applying at the cutoff, a recognized guard call
must match the helper's canonical arity, and a migration that redefines a
recognized helper is a hard stop rather than a judgement call — the guard the
scanner reads and the guard the database will run would be two different bodies.

## 4. What did NOT change verdict

`check_definer_guards.py` still reports **61 migrations clean** — the same set,
with the same verdict, including Migration 191 and Migration 190.

The full old-vs-new sweep over all 242 `sql/migrations/*.sql` and
`sql/baseline/*.sql` files shows verdict changes only **outside** the scanned
set, and every one is the same correction: the old window
(`after.split("CREATE")[0]`) cut a file's REVOKE block off, so a function that
its own migration genuinely closes was reported unguarded. `117` (one function)
and the eleven `pg_dump` baselines — which emit every REVOKE at the end of the
file, after every CREATE — are that false positive.

Migration 191's own resolution, printed from the model:

```
public.wardah_apply_stock_incoming(...9 args...)   closed=True  guarded=False
public.wardah_apply_stock_incoming(...10 args...)  closed=True  guarded=False
public.wardah_apply_stock_outgoing(...8 args...)   closed=True  guarded=True
public.wardah_apply_stock_outgoing(...9 args...)   closed=True  guarded=True
public.rpc_cancel_stock_adjustment(uuid,text)      closed=False guarded=True
public.rpc_manual_stock_movement_v2(jsonb)         closed=False guarded=True
public.rpc_post_goods_receipt(jsonb)               closed=False guarded=True
public.rpc_post_delivery_note(jsonb)               closed=False guarded=True
public.rpc_submit_stock_adjustment(uuid)           closed=False guarded=True
public.rpc_consume_reserved_materials_v2(...)      closed=False guarded=True
public.rpc_create_mo_with_reservation(...)         closed=False guarded=True
```

`closed=True` here is the **strict** closure — PUBLIC *and* `anon` *and*
`authenticated` — so 191 satisfies the hardest form of the contract on its own
merits: nine guarded, two closed to every client, none exempted by name. That is
asserted as a test, `test_migration_191_still_relies_on_no_exemption`, so it
cannot quietly become an exemption later.

## 5. Catalog contract and its selftest

`acceptance_definer_guard_contract.sql` asserts five things the static scanner
cannot:

1. **Exception semantics, live.** P0001 is caught by its own code and by class
   P0000; `unique_violation` does not catch it. If PostgreSQL ever changed
   either, the scanner's rules would be wrong and this gate says so.
2. **Guard identity.** Each recognized helper exists with exactly its reviewed
   signature, has exactly one overload, is `SECURITY DEFINER` with a hardened
   `search_path`, and — for the three raising helpers — actually contains a
   `RAISE EXCEPTION`.
3. **No mixed-case twins** anywhere in `public`.
4. **Final security mode** of all thirteen Migration 191 objects, pinned
   `prosecdef` by `prosecdef` — the catalog-side answer to a later `ALTER`.
5. **Privilege ledger** for the five closure-exempt helpers, checked twice: via
   `has_function_privilege` (which resolves the PUBLIC pseudo-role) and via
   `aclexplode(...).grantee = 0`, plus a `proacl IS NULL` check because a
   default ACL still carries PUBLIC's inherited EXECUTE.

`selftest_definer_guard_contract.sh` drives four broken catalogs through the
**real** contract file — a shadow guard overload, a quoted mixed-case name, an
`ALTER ... SECURITY DEFINER`, and an EXECUTE grant to `authenticated` — requires
each to be rejected **by its own error token** (so a mutant cannot pass the
selftest by failing for an unrelated reason), then reverts every mutation and
proves the contract green again.

## 6. Verification run

On a Fresh **PostgreSQL 17.11** database built exactly as the acceptance
workflow does — shim → baseline `000_schema_baseline_20260905_184634.sql`
(cutoff 189) → its reference-data pair → `190` → `191`:

| Stage | Result |
|---|---|
| `check_definer_guards.py` | ✅ 61 migrations, 0 errors |
| `test_check_definer_guards.py` | ✅ 44 tests |
| `selftest_definer_guard_contract.sh` | ✅ `DEFINER_GUARD_CONTRACT_SELFTEST_PASS` (4 mutants, catalog restored) |
| `acceptance_definer_guard_contract.sql` | ✅ `DEFINER_GUARD_CONTRACT_PASS` |
| `acceptance_191_f2_stock_write_concurrency.sql` | ✅ `M191_ACCEPTANCE_CONTRACT_PASS` |
| `12_acceptance_gate_selftest.sql` | ✅ `M191_GATE_SELFTEST_PASS` (positive=7 mutants=15) + `M191_GATE_SELFTEST_REMEDIATION_PASS` |
| `12_acceptance_static_gates.sql` | ✅ `M191_ACCEPTANCE_STATIC_PASS` |
| deterministic GREEN harness, 14 scripts | ✅ all `SLICE12_*_PASS` |
| `acceptance_191_reconciliation.sql` | ✅ `M191_RECONCILIATION_PASS` |

The behavioural harness and the reconciliation were rerun **after** the
selftest's mutate/revert cycle, so they also evidence that the selftest leaves
the catalog exactly as it found it.

## 7. Known limits, stated rather than hidden

- The rules remain **syntactic**. A guard called with a hard-coded organization
  id rather than the one being written is still accepted; binding the assertion
  to the operated tenant is a review question, not a scanner one.
- Privileged work placed **before** an outer-level assertion is still accepted.
  PL/pgSQL rolls the statement back when the assertion raises, so it is not a
  persistence hole; it is a code-order preference, and rejecting it would be a
  new contract rather than a closure of an accepted finding.
- `REVOKE ... ON ALL FUNCTIONS IN SCHEMA` genuinely closes PUBLIC, but is
  deliberately **not** credited as attribution: it names no function, and a
  blanket statement is exactly the kind of thing a later `GRANT` undoes without
  anyone noticing.
- The strict reachability rules can reject a future function whose returns and
  raises are all provably guarded. The remedy is to move the authorization
  boundary earlier, never to weaken the gate.
