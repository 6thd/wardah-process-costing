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
from typing import Any

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
    proacl: list[str] | None
    proconfig: list[str] | None
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


def _require_exact_keys(value: dict[str, Any], expected: set[str], context: str) -> None:
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise RuntimeError(
            f"Unexpected {context} keys: missing={missing}, extra={extra}"
        )


def _require_str(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise RuntimeError(f"Expected {field} to be string, got {type(value).__name__}")
    return value


def _require_int(value: Any, field: str) -> int:
    if type(value) is not int:
        raise RuntimeError(f"Expected {field} to be integer, got {type(value).__name__}")
    return value


def _require_bool(value: Any, field: str) -> bool:
    if type(value) is not bool:
        raise RuntimeError(f"Expected {field} to be boolean, got {type(value).__name__}")
    return value


def _require_nullable_bool(value: Any, field: str) -> bool | None:
    if value is None:
        return None
    return _require_bool(value, field)


def _require_nullable_string_list(value: Any, field: str) -> list[str] | None:
    if value is None:
        return None
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise RuntimeError(f"Expected {field} to be null or string array")
    return value


def _decode_oracle_payload(raw: str) -> tuple[str, int, list[RoutineEvidence]]:
    stripped = raw.strip()
    if not stripped:
        raise RuntimeError("PostgreSQL oracle returned no JSON payload")

    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"PostgreSQL oracle returned invalid JSON: {exc}") from exc

    if not isinstance(payload, dict):
        raise RuntimeError("PostgreSQL oracle payload must be a JSON object")

    _require_exact_keys(
        payload,
        {"server_version", "server_version_num", "routines"},
        "oracle payload",
    )

    version = _require_str(payload["server_version"], "server_version")
    if not version:
        raise RuntimeError("PostgreSQL oracle returned empty server_version")
    version_num = _require_int(payload["server_version_num"], "server_version_num")
    if version_num <= 0:
        raise RuntimeError("PostgreSQL oracle returned invalid server_version_num")

    raw_routines = payload["routines"]
    if not isinstance(raw_routines, list):
        raise RuntimeError("Expected routines to be an array")

    routine_keys = {
        "oid",
        "schema",
        "name",
        "identity_arguments",
        "identity",
        "owner",
        "prokind",
        "security_definer",
        "proacl",
        "proconfig",
        "public_execute",
        "anon_role_exists",
        "anon_execute",
        "authenticated_role_exists",
        "authenticated_execute",
    }

    rows: list[RoutineEvidence] = []
    for index, item in enumerate(raw_routines):
        context = f"routine[{index}]"
        if not isinstance(item, dict):
            raise RuntimeError(f"Expected {context} to be an object")
        _require_exact_keys(item, routine_keys, context)

        security_definer = _require_bool(
            item["security_definer"], f"{context}.security_definer"
        )
        if not security_definer:
            raise RuntimeError(f"{context} is not SECURITY DEFINER")

        oid = _require_int(item["oid"], f"{context}.oid")
        if oid <= 0:
            raise RuntimeError(f"Expected {context}.oid to be positive")

        rows.append(
            RoutineEvidence(
                oid=oid,
                schema=_require_str(item["schema"], f"{context}.schema"),
                name=_require_str(item["name"], f"{context}.name"),
                identity_arguments=_require_str(
                    item["identity_arguments"], f"{context}.identity_arguments"
                ),
                identity=_require_str(item["identity"], f"{context}.identity"),
                owner=_require_str(item["owner"], f"{context}.owner"),
                prokind=_require_str(item["prokind"], f"{context}.prokind"),
                security_definer=security_definer,
                proacl=_require_nullable_string_list(
                    item["proacl"], f"{context}.proacl"
                ),
                proconfig=_require_nullable_string_list(
                    item["proconfig"], f"{context}.proconfig"
                ),
                public_execute=_require_bool(
                    item["public_execute"], f"{context}.public_execute"
                ),
                anon_role_exists=_require_bool(
                    item["anon_role_exists"], f"{context}.anon_role_exists"
                ),
                anon_execute=_require_nullable_bool(
                    item["anon_execute"], f"{context}.anon_execute"
                ),
                authenticated_role_exists=_require_bool(
                    item["authenticated_role_exists"],
                    f"{context}.authenticated_role_exists",
                ),
                authenticated_execute=_require_nullable_bool(
                    item["authenticated_execute"],
                    f"{context}.authenticated_execute",
                ),
            )
        )

    return version, version_num, rows


def _query_oracle(db_url: str | None) -> tuple[str, int, list[RoutineEvidence]]:
    # One PostgreSQL statement returns typed JSON for both server identity and
    # routine evidence. PostgreSQL performs all escaping, so tabs/newlines or
    # other delimiter characters inside identifiers, ACLs, or proconfig cannot
    # create synthetic rows or fields in the Python transport.
    sql = """
WITH role_flags AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS has_anon,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AS has_authenticated
), routine_rows AS (
  SELECT
    n.nspname AS schema_name,
    p.proname AS routine_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    p.oid AS routine_oid,
    jsonb_build_object(
      'oid', p.oid::bigint,
      'schema', n.nspname,
      'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'identity', format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
      'owner', pg_get_userbyid(p.proowner),
      'prokind', p.prokind,
      'security_definer', p.prosecdef,
      'proacl', to_jsonb(p.proacl),
      'proconfig', to_jsonb(p.proconfig),
      'public_execute', has_function_privilege('public', p.oid, 'EXECUTE'),
      'anon_role_exists', rf.has_anon,
      'anon_execute', CASE WHEN rf.has_anon THEN has_function_privilege('anon', p.oid, 'EXECUTE') ELSE NULL END,
      'authenticated_role_exists', rf.has_authenticated,
      'authenticated_execute', CASE WHEN rf.has_authenticated THEN has_function_privilege('authenticated', p.oid, 'EXECUTE') ELSE NULL END
    ) AS routine_json
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN role_flags rf
  WHERE p.prosecdef
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
)
SELECT jsonb_build_object(
  'server_version', version(),
  'server_version_num', current_setting('server_version_num')::int,
  'routines', COALESCE(
    (
      SELECT jsonb_agg(
        routine_json
        ORDER BY schema_name, routine_name, identity_arguments, routine_oid
      )
      FROM routine_rows
    ),
    '[]'::jsonb
  )
);
"""
    return _decode_oracle_payload(_run_psql(sql, db_url=db_url))


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
        version, version_num, rows = _query_oracle(args.db_url)
        evidence = _select_targets(rows, args.target)
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
