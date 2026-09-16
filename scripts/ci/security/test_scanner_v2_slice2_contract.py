#!/usr/bin/env python3
"""RED contract tests for Scanner v2 Slice 2.

These tests intentionally define behavior before implementation exists.
They must fail on the initial Slice 2 branch because
`scripts/ci/security/scanner_v2_discovery_binding.py` does not exist yet.

The contract is deliberately narrow:
- discover SECURITY DEFINER routine ownership from source;
- bind candidates to PostgreSQL-rendered catalog identities;
- fail closed for missing / ambiguous bindings;
- never statically reinterpret procedural ACL side effects as final truth;
- preserve the Slice 1 runtime-oracle verdict when joining evidence.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
BINDER = REPO_ROOT / "scripts/ci/security/scanner_v2_discovery_binding.py"


def _catalog_row(
    *,
    oid: int,
    identity: str,
    name: str,
    prokind: str = "f",
    client_callable: bool = False,
) -> dict[str, Any]:
    schema, rendered = identity.split(".", 1)
    return {
        "oid": oid,
        "schema": schema.strip('"'),
        "name": name,
        "identity_arguments": rendered[rendered.find("(") + 1 : -1],
        "identity": identity,
        "owner": "postgres",
        "prokind": prokind,
        "security_definer": True,
        "proacl": None,
        "proconfig": None,
        "public_execute": client_callable,
        "anon_role_exists": True,
        "anon_execute": False,
        "authenticated_role_exists": True,
        "authenticated_execute": client_callable,
        "client_callable": client_callable,
    }


def _run_binding(source_sql: str, routines: list[dict[str, Any]]) -> subprocess.CompletedProcess[str]:
    oracle = {
        "scanner": "wardah-scanner-v2-runtime-probe",
        "server_version": "PostgreSQL 17.11 contract fixture",
        "server_version_num": 170011,
        "client_roles": ["public", "anon", "authenticated"],
        "target_count": 0,
        "routine_count": len(routines),
        "routines": routines,
    }

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        source_path = tmp_path / "migration.sql"
        oracle_path = tmp_path / "oracle.json"
        source_path.write_text(source_sql, encoding="utf-8")
        oracle_path.write_text(json.dumps(oracle), encoding="utf-8")

        return subprocess.run(
            [
                sys.executable,
                str(BINDER),
                "--source",
                str(source_path),
                "--oracle-evidence",
                str(oracle_path),
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=15,
        )


class Slice2DiscoveryBindingContract(unittest.TestCase):
    def _json(self, completed: subprocess.CompletedProcess[str]) -> dict[str, Any]:
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertIsInstance(payload, dict)
        return payload

    def test_clear_source_candidate_binds_to_postgresql_identity(self) -> None:
        source = r'''
CREATE OR REPLACE FUNCTION public.review_probe()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$ BEGIN RETURN 'unguarded'; END $$;
'''
        completed = _run_binding(
            source,
            [_catalog_row(oid=1001, identity="public.review_probe()", name="review_probe")],
        )
        payload = self._json(completed)
        self.assertEqual(payload["status"], "RESOLVED")
        self.assertEqual(len(payload["bindings"]), 1)
        binding = payload["bindings"][0]
        self.assertEqual(binding["catalog_identity"], "public.review_probe()")
        self.assertEqual(binding["catalog_oid"], 1001)
        self.assertEqual(binding["discovery_status"], "RESOLVED")
        self.assertFalse(binding["client_callable"])

    def test_missing_catalog_object_fails_closed(self) -> None:
        source = r'''
CREATE FUNCTION public.missing_probe()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$ BEGIN NULL; END $$;
'''
        completed = _run_binding(source, [])
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("UNKNOWN", completed.stderr)
        self.assertNotIn('"status": "RESOLVED"', completed.stdout)

    def test_unrelated_nonempty_catalog_does_not_bind_source_candidate(self) -> None:
        source = r'''
CREATE FUNCTION public.foo()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$ BEGIN NULL; END $$;
'''
        completed = _run_binding(
            source,
            [_catalog_row(oid=1501, identity="public.bar()", name="bar")],
        )
        # Non-empty oracle evidence is not sufficient. Slice 2 must correlate
        # discovered source candidates to matching PostgreSQL catalog identities.
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("UNKNOWN", completed.stderr)
        self.assertNotIn('"status": "RESOLVED"', completed.stdout)

    def test_ambiguous_overload_or_quoted_identity_fails_closed(self) -> None:
        source = r'''
CREATE FUNCTION public."CaseProbe"(value integer)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
AS $$ SELECT value $$;
'''
        routines = [
            _catalog_row(
                oid=2001,
                identity='public."CaseProbe"(integer)',
                name="CaseProbe",
            ),
            _catalog_row(
                oid=2002,
                identity='public."CaseProbe"(text)',
                name="CaseProbe",
            ),
        ]
        completed = _run_binding(source, routines)
        # The implementation must prove exact source -> PostgreSQL identity.
        # Any unresolved/ambiguous result is a hard failure, never a PASS.
        if completed.returncode == 0:
            payload = json.loads(completed.stdout)
            self.assertEqual(payload["status"], "RESOLVED")
            self.assertEqual(len(payload["bindings"]), 1)
            self.assertEqual(
                payload["bindings"][0]["catalog_identity"],
                'public."CaseProbe"(integer)',
            )
        else:
            self.assertTrue(
                "AMBIGUOUS" in completed.stderr or "UNKNOWN" in completed.stderr,
                completed.stderr,
            )

    def test_procedural_acl_side_effect_is_not_reinterpreted_statically(self) -> None:
        source = r'''
CREATE FUNCTION public.review_probe()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$ BEGIN RETURN 'unguarded'; END $$;

CREATE FUNCTION public.reopen_helper()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated';
END
$$;

SELECT public.reopen_helper();
'''
        completed = _run_binding(
            source,
            [
                _catalog_row(
                    oid=3001,
                    identity="public.review_probe()",
                    name="review_probe",
                    client_callable=True,
                )
            ],
        )
        payload = self._json(completed)
        self.assertEqual(payload["status"], "RESOLVED")
        binding = payload["bindings"][0]
        # Runtime evidence is authoritative. Slice 2 must not decide that this
        # is closed merely because it does not interpret helper/dynamic SQL.
        self.assertTrue(binding["client_callable"])
        self.assertEqual(binding["runtime_verdict"], "OPEN")
        self.assertNotIn("acl_replay", payload)
        self.assertNotIn("procedural_effect_inference", payload)


if __name__ == "__main__":
    unittest.main()
