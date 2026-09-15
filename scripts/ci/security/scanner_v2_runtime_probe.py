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
import shutil
import subprocess  # nosec B404  # noqa: S404 -- intentional psql oracle boundary
import sys
from dataclasses import asdict, dataclass

CLIENT_ROLES = ("public", "anon", "authenticated")
PSQL_TIMEOUT_SECONDS = 30


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


def _resolve_psql() -> str:
    discovered = shutil.which("psql")
    if not discovered:
        raise RuntimeError("PostgreSQL oracle failed: psql executable not found")

    # Preserve the discovered psql path itself instead of resolving symlinks.
    # On Ubuntu, /usr/bin/psql is intentionally a pg_wrapper symlink and the
    # wrapper depends on argv[0] remaining psql in order to select the client.
    executable = os.path.abspath(discovered)
    if not os.path.isfile(executable) or not os.access(executable, os.X_OK):
        raise RuntimeError(
            f"PostgreSQL oracle failed: psql is not executable: {executable}"
        )
    return executable


def _run_psql(sql: str, *, db_url: str | None = None) -> str:
    executable = _resolve_psql()
    env = os.environ.copy()
    if db_url:
        # libpq accepts a connection URI in the dbname/PGDATABASE parameter.
        # Keeping it in the environment prevents caller data from becoming a
        # command-line switch or executable component.
        env["PGDATABASE"] = db_url

    try:
        # Security-reviewed subprocess boundary: shell is never used; argv is
        # static; the executable is validated; SQL is passed on stdin; and
        # caller targets are matched only after PostgreSQL returns identities.
        completed = subprocess.run(  # nosec B603  # noqa: S603
            [
                "psql",
                "-X",
                "--no-password",
                "-v",
                "ON_ERROR_STOP=1",
                "-A",
                "-t",
                "-F",
                "\t",
            ],
            executable=executable,
            env=env,
            text=True,
            input=sql,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=PSQL_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"PostgreSQL oracle timed out after {PSQL_TIMEOUT_SECONDS}s"
        ) from exc

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


def _query_evidence(db_url: str | None) -> list[RoutineEvidence]:
    # Deliberately fixed SQL. User-provided --target values are matched against
    # PostgreSQL-rendered identities in Python after this catalog query; they are
    # never interpolated into SQL.
    sql = """
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
  format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
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
ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.oid;
"""
    raw = _run_psql(sql, db_url=db_url)
    rows: list[RoutineEvidence] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) != 15:
            raise RuntimeError(
                f"Unexpected catalog row with {len(parts)} fields: {line!r}"
            )

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


def _select_targets(
    rows: list[RoutineEvidence], targets: list[str]
) -> list[RoutineEvidence]:
    if not targets:
        return rows

    by_identity: dict[str, list[RoutineEvidence]] = {}
    for row in rows:
        by_identity.setdefault(row.identity, []).append(row)

    missing = [target for target in targets if not by_identity.get(target)]
    duplicates = [
        target for target in targets if len(by_identity.get(target, [])) > 1
    ]
    if missing or duplicates:
        details = []
        if missing:
            details.append(f"missing targets={missing}")
        if duplicates:
            details.append(f"non-unique targets={duplicates}")
        raise RuntimeError("; ".join(details))

    selected: list[RoutineEvidence] = []
    seen: set[str] = set()
    for target in targets:
        if target in seen:
            continue
        selected.append(by_identity[target][0])
        seen.add(target)
    return selected


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
        evidence = _select_targets(_query_evidence(args.db_url), args.target)
    except (OSError, RuntimeError, ValueError) as exc:
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
