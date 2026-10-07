# Pre-M202 CRLF compatibility for validate_mo_transition

Explicit script: `scripts/ops/pre_m202_validate_mo_transition_crlf.sql`.

This is not a numbered migration. `build_apply_order.py` will not run it.
It does not insert a row into `supabase_migrations.schema_migrations`.
The operator record is the script's `NOTICE` (`PRE_M202_CRLF_NOOP` or
`PRE_M202_CRLF_REPLACED`) in the psql log for the transaction that ran it.

## Why it is not migration 203

Migration 202's preflight pins `public.validate_mo_transition(text,text)` at
md5 `22789ca9c175eb3476b5c33648b92d1a` before it changes anything else.
A numbered migration can only be applied by the ordered chain after 202, which
is too late. Renumbering or editing merged 202 is not allowed. The next free
number on `origin/main` at `eb67705098c0bd14c22700296fffc8001011a435` is 203,
and that number is reserved for the separate stage-WIP lock correction.

Reviewed order on a Production-shaped restore: canonical 195 through 201, this
script, unmodified 202. On a Fresh DB built from the cutoff-189 baseline the
stored body is already the LF pin, so the script is a verified no-op.

## Approved bytes

Signature `public.validate_mo_transition(text,text)`, language plpgsql.

| Variant | md5 | Bytes | CR |
|---|---|---|---|
| Canonical LF, migration 78 and the cutoff-189 baseline | `22789ca9c175eb3476b5c33648b92d1a` | 1648 | 0 |
| Reviewed CRLF variant | `4169a0696bbcc28b39a922dcf1df23fe` | 1683 | 35 |

The CRLF variant is that LF body with each LF expanded to CRLF. It is not
produced by stripping CR bytes from whatever body is live. The live `prosrc`
must equal one of those two strings.

The LF body has 35 line endings and no CR. No LF sits inside a single-quoted
literal: the quote counts on the transition lines and the two `RAISE` lines
are even, and each quoted string closes on its own line. The other lines are
comments or whitespace. PostgreSQL treats CR as whitespace, and a CR that only
sits immediately before the LF that ends a `--` comment is comment text.
Removing those 35 CR bytes therefore does not change a literal value.
A CR or CRLF injected inside a literal is a different body and is refused.
The folded-hash test is not the acceptance rule; equality to the two reviewed
byte strings is.

## Attributes

Before any change the script requires owner `postgres`, `SECURITY INVOKER`,
language plpgsql, volatility volatile, parallel unsafe, not strict, not
leakproof, cost 100, rows 0, identity arguments `p_from text, p_to text`,
result `void`, `search_path=public`, and EXECUTE granted only to `postgres`,
`authenticated`, and `service_role` by `postgres`. Anything else raises
`PRE_M202_CRLF_ATTRIBUTE_REFUSED` with no `CREATE OR REPLACE`.

`CREATE OR REPLACE` keeps owner and ACL and clears `proconfig` when `SET` is
omitted. The replacement therefore sets `search_path = public`, `SECURITY
INVOKER`, owner, volatility, leakproof, parallel, and cost again, then
re-reads the catalog inside the same transaction.

## Lock

The original attributes, including `search_path=public`, are read before any DDL.
An unexpected setting raises `PRE_M202_CRLF_ATTRIBUTE_REFUSED` with no
`ALTER FUNCTION` and no `CREATE OR REPLACE`.

The race lock is owner DDL:

```sql
ALTER FUNCTION public.validate_mo_transition(text, text) COST 100;
```

That statement does not write `proconfig`, `prosrc`, the owner, or the ACL.
It locks the same `pg_proc` tuple that a concurrent `ALTER FUNCTION` or
`CREATE OR REPLACE FUNCTION` updates, so the waiter stops with `lock_timeout`
rather than changing the row. Identity, body, and attributes are read again
after the lock. A `search_path` committed by the other session is still the
value on the row, because this lock does not set it.

`SELECT ... FROM pg_proc FOR UPDATE` is not used. On the Supabase image that
catalog update is denied to non-superuser `postgres`.

The LF path and every refusal roll the transaction back, including the cost
lock. Only the approved CRLF replacement commits. `CREATE OR REPLACE` on that
path clears `proconfig`; the script then sets `search_path = public` again,
after the locked re-read has already required that exact setting. Cost is the
column the lock writes, so a concurrent cost change is not an independent
observation under the lock. The replacement's own post-image still requires
cost 100, and a refusal rolls the cost write back.

A superuser catalog write that bypasses tuple locks, and any change after
this transaction ends, are outside this guard. The script does not install a
permanent guard. Run it as non-superuser `postgres`. Do not run it as
`supabase_admin`.

## Invocation

```text
psql -v ON_ERROR_STOP=1 -f scripts/ops/pre_m202_validate_mo_transition_crlf.sql
```

Run it only on the database where unmodified 202 is about to be applied.
Do not apply it to Production under the current authorization.
