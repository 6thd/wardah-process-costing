#!/usr/bin/env python3
"""Scanner v2 runtime privilege probe.

This is the first implementation slice of Scanner v2. It does not parse
migration SQL and does not try to infer PL/pgSQL side effects. Instead it asks
PostgreSQL for the final effective EXECUTE surface of SECURITY DEFINER routines
in an already-built disposable acceptance database.

The probe is intentionally small and fail-hard:
- PostgreSQL/psql must be reachable.
- query failures are fatal.
- requested target routines must resolve exactly once.
- JSON output records exact server version and role reachability.

A later Scanner v2 layer will combine this runtime evidence with static guard
classification. Until then, --require-client-closed is useful for targeted
fixtures where the reviewed SECURITY DEFINER routine is intentionally unguarded
and therefore must not be client-callable.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass, asdict
from typing import Iterable

CLIENT_ROLES = ("public", "anon", "authenticated")


@dataclass(frozen=True)
class RoutineEvidence:
    oid: int
    schema: str
    name: str
    identity_arguments: str
    identity: str
    owner: str
    prokind: str
    security_definer: bool
    proacl: str | None
    proconfig: str | None
    public_execute: bool
    anon_role_exists: bool
    anon_execute: bool | None
    authenticated_role_exists: bool
    authenticated_execute: bool | None

    @property
    def client_callable(self) -> bool:
        return bool(
            self.public_execute
            or self.anon_execute is True
            or self.authenticated_execute is True
        )


def _run_psql(sql: str, *, db_url: str | None = None) -> str:
    cmd = [
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-A",
        "-t",
        "-F",
        "\t",
    ]
    if db_url:
        cmd.append(db_url)
    cmd.extend(["-c", sql])

    env = os.environ.copy()
    completed = subprocess.run(
        cmd,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "PostgreSQL oracle failed: "
            f"psql exit={completed.returncode}: {completed.stderr.strip()}"
        )
    return completed.stdout


def _server_version(db_url: str | None) -> tuple[str, int]:
    raw = _run_psql(
        "SELECT version(), current_setting('server_version_num')::int;",
        db_url=db_url,
    ).strip()
    if not raw:
        raise RuntimeError("PostgreSQL oracle returned no version row")
    fields = raw.split("\t")
    if len(fields) != 2:
        raise RuntimeError(f"Unexpected version row: {raw!r}")
    return fields[0], int(fields[1])


def _identity_sql() -> str:
    return (
        "format('%I.%I(%s)', n.nspname, p.proname, "
        "pg_get_function_identity_arguments(p.oid))"
    )


def _target_predicate(targets: Iterable[str]) -> str:
    values = list(targets)
    if not values:
        return "TRUE"
    quoted = ", ".join("'" + value.replace("'", "''") + "'" for value in values)
    return f"{_identity_sql()} IN ({quoted})"


def _query_evidence(db_url: str | None, targets: list[str]) -> list[RoutineEvidence]:
    predicate = _target_predicate(targets)
    identity_sql = _identity_sql()
    sql = f"""
WITH role_flags AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS has_anon,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AS has_authenticated
)
SELECT
  p.oid::bigint,
  n.nspname,
  p.proname,
  pg_get_function_identity_arguments(p.oid),
  {identity_sql},
  pg_get_userbyid(p.proowner),
  p.prokind,
  p.prosecdef,
  CASE WHEN p.proacl IS NULL THEN NULL ELSE array_to_string(p.proacl, ',') END,
  CASE WHEN p.proconfig IS NULL THEN NULL ELSE array_to_string(p.proconfig, ',') END,
  has_function_privilege('public', p.oid, 'EXECUTE'),
  rf.has_anon,
  CASE WHEN rf.has_anon THEN has_function_privilege('anon', p.oid, 'EXECUTE') ELSE NULL END,
  rf.has_authenticated,
  CASE WHEN rf.has_authenticated THEN has_function_privilege('authenticated', p.oid, 'EXECUTE') ELSE NULL END
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN role_flags rf
WHERE p.prosecdef
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND {predicate}
ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.oid;
"""
    raw = _run_psql(sql, db_url=db_url)
    rows: list[RoutineEvidence] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) != 15:
            raise RuntimeError(f"Unexpected catalog row with {len(parts)} fields: {line!r}")

        def pg_bool(value: str) -> bool:
            if value == "t":
                return True
            if value == "f":
                return False
            raise RuntimeError(f"Unexpected PostgreSQL boolean: {value!r}")

        def pg_nullable_bool(value: str) -> bool | None:
            return None if value == "" else pg_bool(value)

        rows.append(
            RoutineEvidence(
                oid=int(parts[0]),
                schema=parts[1],
                name=parts[2],
                identity_arguments=parts[3],
                identity=parts[4],
                owner=parts[5],
                prokind=parts[6],
                security_definer=pg_bool(parts[7]),
                proacl=parts[8] or None,
                proconfig=parts[9] or None,
                public_execute=pg_bool(parts[10]),
                anon_role_exists=pg_bool(parts[11]),
                anon_execute=pg_nullable_bool(parts[12]),
                authenticated_role_exists=pg_bool(parts[13]),
                authenticated_execute=pg_nullable_bool(parts[14]),
            )
        )
    return rows


def _validate_targets(rows: list[RoutineEvidence], targets: list[str]) -> None:
    if not targets:
        return
    by_identity: dict[str, int] = {}
    for row in rows:
        by_identity[row.identity] = by_identity.get(row.identity, 0) + 1
    missing = [target for target in targets if by_identity.get(target, 0) == 0]
    duplicates = [target for target in targets if by_identity.get(target, 0) > 1]
    if missing or duplicates:
        details = []
        if missing:
            details.append(f"missing targets={missing}")
        if duplicates:
            details.append(f"non-unique targets={duplicates}")
        raise RuntimeError("; ".join(details))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--db-url",
        help="Optional PostgreSQL connection URL. If omitted, psql uses PG* environment variables.",
    )
    parser.add_argument(
        "--target",
        action="append",
        default=[],
        help="Exact schema-qualified identity to inspect, e.g. public.review_probe(). Repeatable.",
    )
    parser.add_argument(
        "--require-client-closed",
        action="store_true",
        help="Exit 2 if any selected SECURITY DEFINER is executable by PUBLIC/anon/authenticated.",
    )
    args = parser.parse_args(argv)

    try:
        version, version_num = _server_version(args.db_url)
        evidence = _query_evidence(args.db_url, args.target)
        _validate_targets(evidence, args.target)
    except (RuntimeError, ValueError) as exc:
        print(f"SCANNER_V2_ORACLE_ERROR: {exc}", file=sys.stderr)
        return 3

    payload = {
        "scanner": "wardah-scanner-v2-runtime-probe",
        "server_version": version,
        "server_version_num": version_num,
        "client_roles": list(CLIENT_ROLES),
        "target_count": len(args.target),
        "routine_count": len(evidence),
        "routines": [
            {
                **asdict(row),
                "client_callable": row.client_callable,
            }
            for row in evidence
        ],
    }
    print(json.dumps(payload, sort_keys=True, indent=2))

    if args.require_client_closed:
        open_routines = [row.identity for row in evidence if row.client_callable]
        if open_routines:
            print(
                "SCANNER_V2_CLIENT_EXECUTE_OPEN: " + ", ".join(open_routines),
                file=sys.stderr,
            )
            return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
