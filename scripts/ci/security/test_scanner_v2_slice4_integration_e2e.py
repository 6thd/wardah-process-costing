#!/usr/bin/env python3
"""Scanner v2 Slice 4 integration/E2E proof.

This phase deliberately does not query PostgreSQL. It starts at the accepted
runtime-evidence handoff: a fixture with the exact output shape produced by
scanner_v2_runtime_probe.py. From there every stage is real and is invoked
through its CLI boundary:

    runtime evidence -> Slice 2 binding -> Slice 4 guard evidence -> Slice 3 policy

The policy therefore consumes guard evidence emitted by the real Slice 4
producer in the same run; no synthetic guard records are constructed here.

This is proof wiring only. It is not mandatory CI integration and does not
replace any accepted Slice 2/3/4 contract test.
"""

from __future__ import annotations

import json
import subprocess  # nosec B404 - fixed repo-local test harness commands only
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
SECURITY_DIR = REPO_ROOT / "scripts/ci/security"

BINDER = SECURITY_DIR / "scanner_v2_discovery_binding.py"
GUARD = SECURITY_DIR / "scanner_v2_guard_evidence.py"
POLICY = SECURITY_DIR / "scanner_v2_policy_engine.py"

RUNTIME_SCANNER = "wardah-scanner-v2-runtime-probe"
BINDING_SCANNER = "wardah-scanner-v2-discovery-binding"
GUARD_SCANNER = "wardah-scanner-v2-guard-evidence-v1"
CONTRACT_SCANNER = "wardah-scanner-v2-guard-contract-oracle-v1"
POLICY_SCANNER = "wardah-scanner-v2-policy"

HELPERS = (
    ("public.wardah_assert_org_member(uuid)", "RAISING_ASSERTION"),
    ("public.wardah_assert_org_admin(uuid)", "RAISING_ASSERTION"),
    ("public.wardah_178_assert_permission(uuid,text)", "RAISING_ASSERTION"),
    ("public.wardah_is_org_member(uuid)", "BOOLEAN_DENY"),
)


@dataclass
class PipelineRun:
    binding: subprocess.CompletedProcess[str]
    guard: subprocess.CompletedProcess[str] | None
    policy: subprocess.CompletedProcess[str] | None
    bindings: dict[str, Any] | None
    guards: dict[str, Any] | None
    result: dict[str, Any] | None


def _routine(name: str, body: str) -> str:
    return (
        f"CREATE OR REPLACE FUNCTION public.{name}(p_org uuid)\n"
        "RETURNS void\n"
        "LANGUAGE plpgsql\n"
        "SECURITY DEFINER\n"
        "AS $$\n"
        "BEGIN\n"
        f"{body}\n"
        "END;\n"
        "$$;\n"
    )


def _oracle_row(
    *, oid: int, name: str, client_callable: bool
) -> dict[str, Any]:
    return {
        "oid": oid,
        "schema": "public",
        "name": name,
        "identity_arguments": "uuid",
        "identity": f"public.{name}(uuid)",
        "owner": "postgres",
        "prokind": "f",
        "security_definer": True,
        "proacl": None,
        "proconfig": None,
        "public_execute": False,
        "anon_role_exists": True,
        "anon_execute": False,
        "authenticated_role_exists": True,
        "authenticated_execute": client_callable,
        "client_callable": client_callable,
    }


def _runtime_evidence(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "scanner": RUNTIME_SCANNER,
        "server_version": "PostgreSQL 17.11 integration fixture",
        "server_version_num": 170011,
        "client_roles": ["public", "anon", "authenticated"],
        "target_count": 0,
        "routine_count": len(rows),
        "routines": rows,
    }


def _guard_contract() -> dict[str, Any]:
    return {
        "scanner": CONTRACT_SCANNER,
        "status": "PROVEN",
        "helper_count": len(HELPERS),
        "helpers": [
            {"identity": identity, "guard_kind": kind}
            for identity, kind in HELPERS
        ],
        "exception_semantics": {
            "raise_exception_sqlstate": "P0001",
            "raise_exception_class_sqlstate": "P0000",
            "unique_violation_catches_raise_exception": False,
        },
    }


def _run(argv: list[str]) -> subprocess.CompletedProcess[str]:
    # argv is built exclusively from sys.executable, fixed repo-local script
    # paths and tempfile paths this test owns; no external input reaches it.
    # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit.dangerous-subprocess-use-audit
    return subprocess.run(  # nosec B603 - fixed interpreter and repo-local scripts
        argv,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=20,
    )


def _run_pipeline(
    source: str, runtime_rows: list[dict[str, Any]]
) -> PipelineRun:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        source_path = root / "source.sql"
        runtime_path = root / "runtime.json"
        bindings_path = root / "bindings.json"
        contract_path = root / "guard-contract.json"
        guards_path = root / "guards.json"

        source_path.write_text(source, encoding="utf-8")
        runtime_path.write_text(
            json.dumps(_runtime_evidence(runtime_rows)), encoding="utf-8"
        )
        contract_path.write_text(
            json.dumps(_guard_contract()), encoding="utf-8"
        )

        binding = _run(
            [
                sys.executable,
                str(BINDER),
                "--source",
                str(source_path),
                "--oracle-evidence",
                str(runtime_path),
            ]
        )
        if binding.returncode != 0:
            return PipelineRun(binding, None, None, None, None, None)

        bindings = json.loads(binding.stdout)
        bindings_path.write_text(binding.stdout, encoding="utf-8")

        guard = _run(
            [
                sys.executable,
                str(GUARD),
                "--source",
                str(source_path),
                "--bindings",
                str(bindings_path),
                "--guard-contract-evidence",
                str(contract_path),
            ]
        )
        if guard.returncode != 0:
            return PipelineRun(binding, guard, None, bindings, None, None)

        guards = json.loads(guard.stdout)
        guards_path.write_text(guard.stdout, encoding="utf-8")

        policy = _run(
            [
                sys.executable,
                str(POLICY),
                "--bindings",
                str(bindings_path),
                "--guard-evidence",
                str(guards_path),
            ]
        )
        result = json.loads(policy.stdout) if policy.stdout.strip() else None
        return PipelineRun(binding, guard, policy, bindings, guards, result)


class ScannerV2IntegrationE2ETest(unittest.TestCase):
    def _assert_handoffs(self, run: PipelineRun, expected_count: int) -> None:
        self.assertEqual(run.binding.returncode, 0, run.binding.stderr)
        self.assertIsNotNone(run.guard)
        assert run.guard is not None
        self.assertEqual(run.guard.returncode, 0, run.guard.stderr)
        self.assertIsNotNone(run.policy)
        self.assertIsNotNone(run.bindings)
        self.assertIsNotNone(run.guards)
        self.assertIsNotNone(run.result)

        assert run.bindings is not None
        assert run.guards is not None
        assert run.result is not None
        self.assertEqual(run.bindings["scanner"], BINDING_SCANNER)
        self.assertEqual(run.guards["scanner"], GUARD_SCANNER)
        self.assertEqual(run.result["scanner"], POLICY_SCANNER)
        self.assertEqual(run.bindings["binding_count"], expected_count)
        self.assertEqual(len(run.guards["guard_records"]), expected_count)
        self.assertEqual(run.result["target_count"], expected_count)

        binding_oids = {
            item["catalog_oid"] for item in run.bindings["bindings"]
        }
        guard_oids = {
            item["catalog_oid"] for item in run.guards["guard_records"]
        }
        policy_oids = {
            item["catalog_oid"] for item in run.result["targets"]
        }
        self.assertEqual(binding_oids, guard_oids)
        self.assertEqual(binding_oids, policy_oids)

    def test_real_handoff_maps_all_policy_outcomes(self) -> None:
        source = "\n".join(
            [
                _routine(
                    "open_guarded",
                    "  PERFORM public.wardah_assert_org_member(p_org);",
                ),
                _routine("open_absent", "  PERFORM 1;"),
                _routine(
                    "open_unknown",
                    "  PERFORM public.wardah_is_org_member(p_org);",
                ),
                _routine(
                    "open_ambiguous",
                    "  PERFORM wardah_assert_org_member(p_org);",
                ),
                _routine(
                    "closed_unknown",
                    "  PERFORM public.wardah_is_org_member(p_org);",
                ),
            ]
        )
        rows = [
            _oracle_row(oid=5001, name="open_guarded", client_callable=True),
            _oracle_row(oid=5002, name="open_absent", client_callable=True),
            _oracle_row(oid=5003, name="open_unknown", client_callable=True),
            _oracle_row(oid=5004, name="open_ambiguous", client_callable=True),
            _oracle_row(oid=5005, name="closed_unknown", client_callable=False),
        ]

        run = _run_pipeline(source, rows)
        self._assert_handoffs(run, 5)
        assert run.policy is not None
        assert run.guards is not None
        assert run.result is not None

        self.assertEqual(run.policy.returncode, 2, run.policy.stderr)
        self.assertEqual(run.result["overall_status"], "FAIL")
        self.assertEqual(
            run.result["overall_reason"], "ONE_OR_MORE_TARGETS_FAILED"
        )

        guard_by_oid = {
            item["catalog_oid"]: item
            for item in run.guards["guard_records"]
        }
        self.assertEqual(guard_by_oid[5001]["guard_status"], "PROVEN")
        self.assertEqual(guard_by_oid[5002]["guard_status"], "ABSENT")
        self.assertEqual(guard_by_oid[5003]["guard_status"], "UNKNOWN")
        self.assertEqual(guard_by_oid[5004]["guard_status"], "AMBIGUOUS")
        self.assertEqual(guard_by_oid[5005]["guard_status"], "UNKNOWN")

        target_by_oid = {
            item["catalog_oid"]: item for item in run.result["targets"]
        }
        self.assertEqual(target_by_oid[5001]["policy_status"], "PASS_GUARDED")
        self.assertEqual(
            target_by_oid[5002]["policy_status"], "FAIL_OPEN_UNGUARDED"
        )
        self.assertEqual(target_by_oid[5003]["policy_status"], "FAIL_UNKNOWN")
        self.assertEqual(
            target_by_oid[5004]["policy_status"], "FAIL_AMBIGUOUS"
        )
        self.assertEqual(target_by_oid[5005]["policy_status"], "PASS_CLOSED")
        self.assertEqual(target_by_oid[5005]["runtime_verdict"], "CLOSED")
        self.assertEqual(target_by_oid[5005]["guard_status"], "UNKNOWN")

    def test_open_guarded_plus_closed_unknown_passes_end_to_end(self) -> None:
        source = "\n".join(
            [
                _routine(
                    "open_guarded",
                    "  PERFORM public.wardah_assert_org_member(p_org);",
                ),
                _routine(
                    "closed_unknown",
                    "  PERFORM public.wardah_is_org_member(p_org);",
                ),
            ]
        )
        rows = [
            _oracle_row(oid=5101, name="open_guarded", client_callable=True),
            _oracle_row(oid=5102, name="closed_unknown", client_callable=False),
        ]

        run = _run_pipeline(source, rows)
        self._assert_handoffs(run, 2)
        assert run.policy is not None
        assert run.result is not None

        self.assertEqual(run.policy.returncode, 0, run.policy.stderr)
        self.assertEqual(run.result["overall_status"], "PASS")
        self.assertEqual(
            run.result["overall_reason"], "ALL_TARGETS_ACCEPTED"
        )

        by_oid = {
            item["catalog_oid"]: item for item in run.result["targets"]
        }
        self.assertEqual(by_oid[5101]["policy_status"], "PASS_GUARDED")
        self.assertEqual(by_oid[5102]["policy_status"], "PASS_CLOSED")


    # ------------------------------------------------------------------
    # P2 remediation contract: one source-location contract across the
    # Slice 2 -> Slice 4 boundary.
    #
    # Frozen failed-acceptance baseline: 51fd7b4065b26a36fb007232c1ba16221086fc5c
    #
    # Slice 2 ``_split_statements`` numbers every semicolon-delimited
    # fragment. Slice 4 ``split_statements`` keeps a ``BEGIN ATOMIC ... END``
    # routine whole. A valid LANGUAGE sql atomic routine ahead of a bound
    # PL/pgSQL routine therefore shifts ``statement_index``: on the baseline
    # Slice 2 emits index 5 while Slice 4 sees 2 statements and aborts with
    # ``binding names a statement the source lacks``.
    #
    # The binding below is produced by the real Slice 2 CLI and handed to
    # Slice 4 unedited. No index is corrected in this fixture -- doing so
    # would hide the very mismatch under test.
    # ------------------------------------------------------------------

    def test_atomic_body_preserves_slice2_to_slice4_binding_parity(
        self,
    ) -> None:
        """The exact binding Slice 2 emits must be consumable by Slice 4.

        The atomic body carries three inner semicolons so the divergence is
        discriminating rather than off-by-one: any splitter disagreement
        shows up as a wrong routine or a hard failure, never as a pass.
        """
        atomic_routine = (
            "CREATE OR REPLACE FUNCTION public.atomic_helper(p_org uuid)\n"
            "RETURNS void\n"
            "LANGUAGE sql\n"
            "BEGIN ATOMIC\n"
            "  SELECT 1;\n"
            "  SELECT 2;\n"
            "  SELECT 3;\n"
            "END;\n"
        )
        source = atomic_routine + "\n" + _routine(
            "guarded_after_atomic",
            "  PERFORM public.wardah_assert_org_member(p_org);",
        )
        run = _run_pipeline(
            source,
            [
                _oracle_row(
                    oid=5201,
                    name="guarded_after_atomic",
                    client_callable=True,
                )
            ],
        )

        self.assertEqual(
            run.binding.returncode,
            0,
            msg=f"slice 2 failed: {run.binding.stderr}",
        )
        assert run.guard is not None
        self.assertEqual(
            run.guard.returncode,
            0,
            msg=(
                "slice 4 rejected the binding slice 2 produced for the same "
                f"source bytes: {run.guard.stderr}"
            ),
        )

        assert run.guards is not None
        self.assertEqual(len(run.guards["guard_records"]), 1)
        record = run.guards["guard_records"][0]
        self.assertEqual(record["catalog_oid"], 5201)
        self.assertEqual(
            record["catalog_identity"], "public.guarded_after_atomic(uuid)"
        )
        # Bound to its own body, not the atomic routine's, and not to a
        # neighbour that merely happens to carry a guard.
        self.assertEqual(record["guard_status"], "PROVEN")
        self.assertEqual(
            record["guard_mechanism"], "public.wardah_assert_org_member"
        )

        assert run.result is not None
        self.assertEqual(run.result["overall_status"], "PASS")
        self.assertEqual(run.result["targets"][0]["policy_status"], "PASS_GUARDED")


if __name__ == "__main__":
    unittest.main()
