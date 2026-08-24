# Migration 179 — Generic GL idempotency hardening

Issue: #176  
Parent security epic: #48

## Scope

Migration 179 is DB-only. It does not change application callers or widen the browser-executable journal surface established by Migration 178.

The authoritative uniqueness boundary already exists from Migration 76:

```sql
CREATE UNIQUE INDEX uq_gl_entries_org_idem
ON gl_entries (org_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
```

179 preserves that index and changes the generic journal primitive from a best-effort pre-check into a deterministic request-identity contract.

## Corrected diagnosis

Before 179, two concurrent requests with the same `(org_id,idempotency_key)` can both pass the RPC's `SELECT` pre-check. The existing unique index prevents duplicate commits, but the loser can receive raw PostgreSQL `23505`.

The old RPC also replays an existing key without comparing payload identity, so a materially changed request can silently receive an unrelated prior journal result.

## Contract after 179

For requests with a non-empty `idempotency_key`:

- 179 computes SHA-256 over canonical `p_payload::text` using the same convention as Migration 150. The idempotency key is intentionally included.
- A new keyed row stores the digest in `gl_entries.request_hash`.
- Exact replay returns the same `entry_id` with `duplicate=true`, `payload_verified=true`, `legacy_replay=false`.
- Reusing the key with a different hash fails `IDEMPOTENCY_KEY_CONFLICT`.
- A concurrent loser handles `uq_gl_entries_org_idem` by re-reading the winner and applying the same hash comparison.
- Any other unique violation, including `(org_id,entry_number)`, is re-raised unchanged.

Requests without an idempotency key preserve the historical behavior and store `request_hash=NULL`.

## Historical keyed rows

Production inspection before implementation found existing keyed GL rows created before 179. Their original JSON payloads cannot be reconstructed losslessly from normalized ledger storage, so the migration does **not** backfill guessed hashes.

A keyed row with `request_hash IS NULL` is treated as an explicitly unverified compatibility replay:

```json
{
  "duplicate": true,
  "payload_verified": false,
  "legacy_replay": true
}
```

The replay never fills `request_hash` opportunistically.

## Acceptance evidence required before merge

The dedicated `GL Idempotency 179 Acceptance` workflow must prove all of the following on PostgreSQL 17:

1. Build a fresh database through 178.
2. Seed a pre-179 keyed GL fixture before `request_hash` exists.
3. Apply 179.
4. Confirm legacy replay returns the original entry, is explicitly unverified, and leaves the hash NULL.
5. Confirm a new keyed request stores SHA-256, exact replay returns the same entry, and changed payload fails closed.
6. Force an unrelated `entry_number` unique collision and prove its original unique violation is not converted into idempotent replay.
7. Run two independent PostgreSQL sessions against the same key. A third session holds an advisory-lock barrier at a test-only BEFORE INSERT trigger; the workflow must observe both RPC sessions waiting at that barrier before release. This proves both calls passed the pre-check before either insert completed.
8. Assert the race commits exactly one GL header and one two-line set, both callers resolve to the same `entry_id`, and no raw `23505` leaks.
9. Re-run Migration 178 journal-boundary acceptance after 179.
10. Full repository CI/regression gates must remain green.

## Production deployment

Do not apply 179 before the DB-only PR is merged and all required checks are green.

Deployment sequence:

1. Read-only preflight:
   - verify Production migration ledger does not contain 179;
   - verify `uq_gl_entries_org_idem` still exists;
   - verify no duplicate `(org_id,idempotency_key)` groups;
   - verify `request_hash` is absent before application;
   - record keyed-row count only; do not mutate rows.
2. Apply the exact merged Migration 179 once.
3. Post-apply read-only verification:
   - migration ledger contains 179;
   - `request_hash` exists and historical keyed rows remain NULL;
   - existing unique index remains present;
   - `authenticated` still cannot execute `rpc_create_journal_entry(jsonb)` directly;
   - canonical public wrappers from 178 retain their grants.
4. Do not create test/demo journal entries in Production for verification.

## Rollback posture

179 is additive at the schema level and replaces one function body. Historical data is not rewritten. If a deployment problem is discovered, do not delete the new column or historical data; ship a forward corrective migration.
