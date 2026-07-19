# Migration Ledger Governance

## Source of truth

Three states are distinct and must never be conflated:

1. `sql/migrations/`: canonical repository files.
2. latest schema baseline: a reviewed snapshot of Production with an explicit cutoff.
3. `supabase_migrations.schema_migrations`: immutable Production execution history.

The Production ledger is never edited merely to normalize names or remove duplicate history.

## Canonical naming contract

Every new migration at number 101 or later must use:

```text
NNN_snake_case.sql
```

The `name` supplied to Supabase `apply_migration` must equal the complete file stem:

```text
127_stock_adjustment_ledger_valued_posting.sql
→ 127_stock_adjustment_ledger_valued_posting
```

Migration numbers and file stems must be unique.

## Historical exceptions

Exact immutable exceptions live in:

```text
sql/migrations/migration_ledger_exceptions.json
```

Current exceptions:

- Migration 101 appears at versions `20260712195336` and `20260715134637`.
- Migration 102 appears at versions `20260715044240` and `20260715135008`.
- Version `20260716201851` is named `fail_closed_tenant_isolation` and maps to the canonical file `121_fail_closed_tenant_isolation.sql`.

The allowlist is exact. A third execution of 101/102, a different version, a new duplicate name, or another alias fails validation.

## Automated controls

### Pull-request and main-branch control

`Migration Governance` validates:

- canonical filenames;
- unique migration numbers and stems;
- exception targets still exist;
- baseline cutoff is not ahead of the repository;
- baseline README documents the actual current cutoff;
- validator regression tests.

### Production control

`Audit Production Migration Ledger` runs weekly and manually. It reads only the migration ledger and fails on:

- undocumented live migration names;
- new or changed duplicates;
- stale exception records;
- Production ahead of the repository;
- ambiguous or missing repository mapping.

The audit uploads evidence for 90 days.

### Baseline generation

`Generate Schema Baseline`:

1. reads the full Production migration ledger;
2. validates it against repository files and exact historical exceptions;
3. derives the cutoff from the latest mapped live row;
4. creates a timestamped schema-only dump;
5. rebuilds a clean PostgreSQL 17 database from the generated baseline;
6. updates `CLAUDE.md` and `sql/baseline/README.md`;
7. pushes a dedicated automation branch and opens a PR.

It never writes directly to `main` and never writes to Production.

## Required deployment sequence

1. Merge a migration PR after CI and Fresh DB checks.
2. Apply the migration with a name exactly matching the file stem.
3. Verify one new ledger row with the expected name.
4. Run the read-only ledger audit.
5. Generate a new baseline only when consolidation is useful.
6. Review and merge the generated baseline PR through normal CI.

## Prohibited actions

- deleting or editing Production migration-history rows to make the ledger look clean;
- renaming an already-applied migration file;
- reusing a migration number;
- applying SQL through an untracked name;
- setting a documented baseline cutoff higher than the baseline file itself;
- pushing generated baselines directly to `main`.
