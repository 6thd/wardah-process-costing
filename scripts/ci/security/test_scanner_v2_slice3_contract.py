#!/usr/bin/env python3
"""RED contract tests for Scanner v2 Slice 3 policy core.

Slice 3 is intentionally policy-only. These tests define the contract before
`scripts/ci/security/scanner_v2_policy_engine.py` exists.
"""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
POLICY = REPO_ROOT / "scripts/ci/security/scanner_v2_policy_engine.py"

BINDING_SCANNER = "wardah-scanner-v2-discovery-binding"
GUARD_SCANNER = "wardah-scanner-v2-guard-evidence-v1"
POLICY_SCANNER = "wardah-scanner-v2-policy"


def _binding(*, oid: int, identity: str, runtime_verdict: str, client_callable: bool,
             discovery_status: str = "RESOLVED", prokind: str = "f",
             public_execute: bool | None = None, anon_role_exists: bool = True,
             anon_execute: bool | None = False, authenticated_role_exists: bool = True,
             authenticated_execute: bool | None = None) -> dict[str, Any]:
    schema, rendered = identity.split(".", 1)
    name = rendered[: rendered.find("(")].strip('"')
    arguments = rendered[rendered.find("(") + 1 : -1]
    if public_execute is None:
        public_execute = client_callable
    if authenticated_execute is None:
        authenticated_execute = client_callable
    return {
        "statement_index": oid,
        "source_kind": "PROCEDURE" if prokind == "p" else "FUNCTION",
        "source_schema": schema.strip('"'),
        "source_name": name,
        "source_arguments": arguments,
        "catalog_oid": oid,
        "catalog_identity": identity,
        "catalog_prokind": prokind,
        "discovery_status": discovery_status,
        "client_callable": client_callable,
        "runtime_verdict": runtime_verdict,
        "runtime_evidence": {
            "public_execute": public_execute,
            "anon_role_exists": anon_role_exists,
            "anon_execute": anon_execute,
            "authenticated_role_exists": authenticated_role_exists,
            "authenticated_execute": authenticated_execute,
            "proacl": None,
            "proconfig": None,
        },
    }


def _bindings_doc(bindings: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "scanner": BINDING_SCANNER,
        "status": "RESOLVED",
        "candidate_count": len(bindings),
        "binding_count": len(bindings),
        "bindings": bindings,
    }


def _guard(*, oid: int, identity: str, status: str,
           mechanism: str | None = None, location: str | None = None,
           proof_class: str | None = None) -> dict[str, Any]:
    if status == "PROVEN":
        mechanism = mechanism or "wardah.assert_permission"
        location = location or "migration.sql:42"
        proof_class = proof_class or "authorization-boundary-v1"
    return {
        "catalog_oid": oid,
        "catalog_identity": identity,
        "guard_status": status,
        "guard_mechanism": mechanism,
        "evidence_location": location,
        "proof_class": proof_class,
    }


def _guards_doc(records: list[dict[str, Any]]) -> dict[str, Any]:
    return {"scanner": GUARD_SCANNER, "guard_records": records}


def _run_policy(bindings: dict[str, Any], guards: dict[str, Any]) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        bindings_path = root / "bindings.json"
        guards_path = root / "guards.json"
        bindings_path.write_text(json.dumps(bindings), encoding="utf-8")
        guards_path.write_text(json.dumps(guards), encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(POLICY), "--bindings", str(bindings_path),
             "--guard-evidence", str(guards_path)],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=False, timeout=15,
        )


class Slice3PolicyContract(unittest.TestCase):
    def _payload(self, completed: subprocess.CompletedProcess[str]) -> dict[str, Any]:
        self.assertTrue(completed.stdout.strip(), completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["scanner"], POLICY_SCANNER)
        return payload

    def _assert_pass(self, completed: subprocess.CompletedProcess[str], expected_status: str) -> dict[str, Any]:
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = self._payload(completed)
        self.assertEqual(payload["overall_status"], "PASS")
        self.assertEqual(len(payload["targets"]), 1)
        self.assertEqual(payload["targets"][0]["policy_status"], expected_status)
        return payload

    def _assert_policy_fail(self, completed: subprocess.CompletedProcess[str], expected_status: str) -> dict[str, Any]:
        self.assertNotEqual(completed.returncode, 0)
        payload = self._payload(completed)
        self.assertEqual(payload["overall_status"], "FAIL")
        self.assertEqual(len(payload["targets"]), 1)
        self.assertEqual(payload["targets"][0]["policy_status"], expected_status)
        return payload

    def _assert_evidence_error(self, completed: subprocess.CompletedProcess[str]) -> None:
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("SCANNER_V2_POLICY_EVIDENCE_ERROR", completed.stderr)
        self.assertNotIn('"overall_status": "PASS"', completed.stdout)

    def test_closed_without_guard_passes_closed(self) -> None:
        binding = _binding(oid=1001, identity="public.closed_probe()", runtime_verdict="CLOSED",
                           client_callable=False, public_execute=False, authenticated_execute=False)
        completed = _run_policy(_bindings_doc([binding]), _guards_doc([]))
        payload = self._assert_pass(completed, "PASS_CLOSED")
        self.assertEqual(payload["targets"][0]["runtime_verdict"], "CLOSED")
        self.assertIsNone(payload["targets"][0]["guard_status"])

    def test_open_with_proven_guard_passes_guarded(self) -> None:
        binding = _binding(oid=1002, identity="public.guarded_probe()", runtime_verdict="OPEN",
                           client_callable=True)
        guard = _guard(oid=1002, identity="public.guarded_probe()", status="PROVEN")
        completed = _run_policy(_bindings_doc([binding]), _guards_doc([guard]))
        payload = self._assert_pass(completed, "PASS_GUARDED")
        self.assertEqual(payload["targets"][0]["guard_status"], "PROVEN")

    def test_open_with_absent_guard_fails_unguarded(self) -> None:
        binding = _binding(oid=1003, identity="public.unguarded_probe()", runtime_verdict="OPEN",
                           client_callable=True)
        guard = _guard(oid=1003, identity="public.unguarded_probe()", status="ABSENT")
        self._assert_policy_fail(
            _run_policy(_bindings_doc([binding]), _guards_doc([guard])),
            "FAIL_OPEN_UNGUARDED",
        )

    def test_open_with_unknown_guard_fails_closed(self) -> None:
        binding = _binding(oid=1004, identity="public.unknown_guard_probe()", runtime_verdict="OPEN",
                           client_callable=True)
        guard = _guard(oid=1004, identity="public.unknown_guard_probe()", status="UNKNOWN")
        self._assert_policy_fail(
            _run_policy(_bindings_doc([binding]), _guards_doc([guard])),
            "FAIL_UNKNOWN",
        )

    def test_open_with_ambiguous_guard_fails_closed(self) -> None:
        binding = _binding(oid=1005, identity="public.ambiguous_guard_probe()", runtime_verdict="OPEN",
                           client_callable=True)
        guard = _guard(oid=1005, identity="public.ambiguous_guard_probe()", status="AMBIGUOUS")
        self._assert_policy_fail(
            _run_policy(_bindings_doc([binding]), _guards_doc([guard])),
            "FAIL_AMBIGUOUS",
        )

    def test_runtime_fields_contradiction_fails_closed(self) -> None:
        binding = _binding(
            oid=1006,
            identity="public.contradictory_runtime_probe()",
            runtime_verdict="CLOSED",
            client_callable=False,
            public_execute=True,
            authenticated_execute=False,
        )
        self._assert_evidence_error(_run_policy(_bindings_doc([binding]), _guards_doc([])))

    def test_unresolved_or_missing_catalog_binding_fails_closed(self) -> None:
        binding = _binding(
            oid=1007,
            identity="public.unresolved_probe()",
            runtime_verdict="OPEN",
            client_callable=True,
            discovery_status="UNKNOWN",
        )
        binding["catalog_oid"] = None
        self._assert_evidence_error(_run_policy(_bindings_doc([binding]), _guards_doc([])))

    def test_multi_target_one_failure_makes_aggregate_fail_without_dropping_targets(self) -> None:
        closed = _binding(
            oid=1008, identity="public.closed_multi_probe()", runtime_verdict="CLOSED",
            client_callable=False, public_execute=False, authenticated_execute=False,
        )
        opened = _binding(
            oid=1009, identity="public.open_multi_probe()", runtime_verdict="OPEN",
            client_callable=True,
        )
        guard = _guard(oid=1009, identity="public.open_multi_probe()", status="ABSENT")
        completed = _run_policy(_bindings_doc([closed, opened]), _guards_doc([guard]))
        self.assertNotEqual(completed.returncode, 0)
        payload = self._payload(completed)
        self.assertEqual(payload["overall_status"], "FAIL")
        self.assertEqual(payload["target_count"], 2)
        self.assertEqual(len(payload["targets"]), 2)
        by_identity = {t["catalog_identity"]: t["policy_status"] for t in payload["targets"]}
        self.assertEqual(by_identity["public.closed_multi_probe()"], "PASS_CLOSED")
        self.assertEqual(by_identity["public.open_multi_probe()"], "FAIL_OPEN_UNGUARDED")

    def test_duplicate_guard_oid_is_rejected_not_last_write_wins(self) -> None:
        binding = _binding(oid=1010, identity="public.duplicate_guard_probe()", runtime_verdict="OPEN",
                           client_callable=True)
        guards = [
            _guard(oid=1010, identity="public.duplicate_guard_probe()", status="PROVEN"),
            _guard(oid=1010, identity="public.duplicate_guard_probe()", status="ABSENT"),
        ]
        self._assert_evidence_error(_run_policy(_bindings_doc([binding]), _guards_doc(guards)))

    def test_guard_proof_for_other_oid_does_not_authorize_target(self) -> None:
        first = _binding(oid=1011, identity="public.shared_probe(integer)", runtime_verdict="OPEN",
                         client_callable=True)
        second = _binding(oid=1012, identity="public.shared_probe(text)", runtime_verdict="OPEN",
                          client_callable=True)
        guard = _guard(oid=1012, identity="public.shared_probe(text)", status="PROVEN")
        completed = _run_policy(_bindings_doc([first, second]), _guards_doc([guard]))
        self.assertNotEqual(completed.returncode, 0)
        payload = self._payload(completed)
        by_oid = {t["catalog_oid"]: t for t in payload["targets"]}
        self.assertEqual(payload["overall_status"], "FAIL")
        self.assertEqual(by_oid[1011]["policy_status"], "FAIL_UNKNOWN")
        self.assertEqual(by_oid[1012]["policy_status"], "PASS_GUARDED")

    def test_guard_proof_does_not_override_runtime_open_state(self) -> None:
        binding = _binding(oid=1013, identity="public.runtime_open_probe()", runtime_verdict="OPEN",
                           client_callable=True)
        guard = _guard(oid=1013, identity="public.runtime_open_probe()", status="PROVEN")
        payload = self._assert_pass(
            _run_policy(_bindings_doc([binding]), _guards_doc([guard])),
            "PASS_GUARDED",
        )
        self.assertEqual(payload["targets"][0]["runtime_verdict"], "OPEN")

    def test_unknown_guard_enum_fails_closed(self) -> None:
        binding = _binding(oid=1014, identity="public.unknown_enum_probe()", runtime_verdict="OPEN",
                           client_callable=True)
        guard = _guard(oid=1014, identity="public.unknown_enum_probe()", status="TRUSTED")
        self._assert_policy_fail(
            _run_policy(_bindings_doc([binding]), _guards_doc([guard])),
            "FAIL_UNKNOWN",
        )

    def test_zero_targets_is_not_vacuous_pass(self) -> None:
        completed = _run_policy(_bindings_doc([]), _guards_doc([]))
        self.assertNotEqual(completed.returncode, 0)
        payload = self._payload(completed)
        self.assertEqual(payload["overall_status"], "FAIL")
        self.assertEqual(payload["overall_reason"], "NO_RELEVANT_TARGETS")
        self.assertEqual(payload["target_count"], 0)
        self.assertEqual(payload["targets"], [])

    def test_non_proven_guard_cannot_carry_proof_fields(self) -> None:
        binding = _binding(oid=1015, identity="public.smuggled_proof_probe()", runtime_verdict="OPEN",
                           client_callable=True)
        guard = _guard(
            oid=1015,
            identity="public.smuggled_proof_probe()",
            status="ABSENT",
            mechanism="wardah.assert_permission",
            location="migration.sql:99",
            proof_class="authorization-boundary-v1",
        )
        self._assert_evidence_error(_run_policy(_bindings_doc([binding]), _guards_doc([guard])))

    def test_unexpected_evidence_key_fails_closed(self) -> None:
        binding = _binding(oid=1016, identity="public.extra_key_probe()", runtime_verdict="OPEN",
                           client_callable=True)
        guards = _guards_doc([
            _guard(oid=1016, identity="public.extra_key_probe()", status="ABSENT")
        ])
        guards["override_runtime_verdict"] = "CLOSED"
        self._assert_evidence_error(_run_policy(_bindings_doc([binding]), guards))

    def test_guard_evidence_scanner_identity_is_exact(self) -> None:
        binding = _binding(oid=1017, identity="public.guard_scanner_probe()", runtime_verdict="OPEN",
                           client_callable=True)
        guards = _guards_doc([
            _guard(oid=1017, identity="public.guard_scanner_probe()", status="PROVEN")
        ])
        guards["scanner"] = "some-other-guard-producer"
        self._assert_evidence_error(_run_policy(_bindings_doc([binding]), guards))

    def test_binding_document_identity_status_and_counts_are_strict(self) -> None:
        binding = _binding(
            oid=1018,
            identity="public.binding_doc_probe()",
            runtime_verdict="CLOSED",
            client_callable=False,
            public_execute=False,
            authenticated_execute=False,
        )
        baseline = _bindings_doc([binding])
        mutations = {
            "wrong_scanner": {"scanner": "some-other-binding-producer"},
            "wrong_status": {"status": "UNKNOWN"},
            "wrong_binding_count": {"binding_count": 2},
            "wrong_candidate_count": {"candidate_count": 2},
        }
        for label, mutation in mutations.items():
            with self.subTest(label=label):
                evidence = copy.deepcopy(baseline)
                evidence.update(mutation)
                self._assert_evidence_error(_run_policy(evidence, _guards_doc([])))

    def test_guard_proof_is_oid_scoped_even_when_identity_is_identical(self) -> None:
        old_target = _binding(
            oid=1019,
            identity="public.recreated_probe()",
            runtime_verdict="OPEN",
            client_callable=True,
        )
        new_target = _binding(
            oid=1020,
            identity="public.recreated_probe()",
            runtime_verdict="OPEN",
            client_callable=True,
        )
        stale_guard = _guard(
            oid=1019,
            identity="public.recreated_probe()",
            status="PROVEN",
        )
        completed = _run_policy(
            _bindings_doc([old_target, new_target]),
            _guards_doc([stale_guard]),
        )
        self.assertNotEqual(completed.returncode, 0)
        payload = self._payload(completed)
        by_oid = {target["catalog_oid"]: target for target in payload["targets"]}
        self.assertEqual(payload["overall_status"], "FAIL")
        self.assertEqual(by_oid[1019]["policy_status"], "PASS_GUARDED")
        self.assertEqual(by_oid[1020]["policy_status"], "FAIL_UNKNOWN")

    def test_duplicate_binding_oid_is_rejected(self) -> None:
        closed = _binding(
            oid=1021,
            identity="public.duplicate_binding_closed_probe()",
            runtime_verdict="CLOSED",
            client_callable=False,
            public_execute=False,
            authenticated_execute=False,
        )
        opened = _binding(
            oid=1021,
            identity="public.duplicate_binding_open_probe()",
            runtime_verdict="OPEN",
            client_callable=True,
        )
        self._assert_evidence_error(
            _run_policy(_bindings_doc([closed, opened]), _guards_doc([]))
        )

    def test_nonresolved_discovery_status_fails_even_with_populated_oid(self) -> None:
        binding = _binding(
            oid=1022,
            identity="public.ambiguous_binding_probe()",
            runtime_verdict="OPEN",
            client_callable=True,
            discovery_status="AMBIGUOUS",
        )
        self._assert_evidence_error(
            _run_policy(_bindings_doc([binding]), _guards_doc([]))
        )

    def test_proven_guard_cannot_bypass_runtime_contradiction(self) -> None:
        binding = _binding(
            oid=1023,
            identity="public.guarded_contradictory_runtime_probe()",
            runtime_verdict="CLOSED",
            client_callable=False,
            public_execute=True,
            authenticated_execute=False,
        )
        guard = _guard(
            oid=1023,
            identity="public.guarded_contradictory_runtime_probe()",
            status="PROVEN",
        )
        self._assert_evidence_error(
            _run_policy(_bindings_doc([binding]), _guards_doc([guard]))
        )

    def test_closed_target_still_validates_present_guard_evidence(self) -> None:
        binding = _binding(
            oid=1024,
            identity="public.closed_with_bad_guard_probe()",
            runtime_verdict="CLOSED",
            client_callable=False,
            public_execute=False,
            authenticated_execute=False,
        )
        malformed_guard = _guard(
            oid=1024,
            identity="public.closed_with_bad_guard_probe()",
            status="ABSENT",
            mechanism="wardah.assert_permission",
            location="migration.sql:144",
            proof_class="authorization-boundary-v1",
        )
        self._assert_evidence_error(
            _run_policy(_bindings_doc([binding]), _guards_doc([malformed_guard]))
        )

    def test_runtime_rederivation_covers_anon_and_authenticated_execute(self) -> None:
        cases = (
            {
                "label": "anon_execute_only",
                "oid": 1025,
                "identity": "public.anon_runtime_probe()",
                "runtime_verdict": "CLOSED",
                "client_callable": False,
                "anon_role_exists": True,
                "anon_execute": True,
                "authenticated_role_exists": True,
                "authenticated_execute": False,
                "with_proven_guard": False,
            },
            {
                "label": "authenticated_execute_only",
                "oid": 1026,
                "identity": "public.authenticated_runtime_probe()",
                "runtime_verdict": "CLOSED",
                "client_callable": False,
                "anon_role_exists": True,
                "anon_execute": False,
                "authenticated_role_exists": True,
                "authenticated_execute": True,
                "with_proven_guard": False,
            },
            {
                "label": "anon_execute_without_role",
                "oid": 1028,
                "identity": "public.anon_missing_role_probe()",
                "runtime_verdict": "OPEN",
                "client_callable": True,
                "anon_role_exists": False,
                "anon_execute": True,
                "authenticated_role_exists": False,
                "authenticated_execute": False,
                "with_proven_guard": True,
            },
            {
                "label": "authenticated_execute_without_role",
                "oid": 1029,
                "identity": "public.authenticated_missing_role_probe()",
                "runtime_verdict": "OPEN",
                "client_callable": True,
                "anon_role_exists": False,
                "anon_execute": False,
                "authenticated_role_exists": False,
                "authenticated_execute": True,
                "with_proven_guard": True,
            },
        )
        for case in cases:
            with self.subTest(label=case["label"]):
                binding = _binding(
                    oid=case["oid"],
                    identity=case["identity"],
                    runtime_verdict=case["runtime_verdict"],
                    client_callable=case["client_callable"],
                    public_execute=False,
                    anon_role_exists=case["anon_role_exists"],
                    anon_execute=case["anon_execute"],
                    authenticated_role_exists=case["authenticated_role_exists"],
                    authenticated_execute=case["authenticated_execute"],
                )
                guards = _guards_doc([])
                if case["with_proven_guard"]:
                    guards = _guards_doc([
                        _guard(
                            oid=case["oid"],
                            identity=case["identity"],
                            status="PROVEN",
                        )
                    ])
                self._assert_evidence_error(
                    _run_policy(_bindings_doc([binding]), guards)
                )

    def test_proven_guard_requires_complete_nonempty_proof_metadata(self) -> None:
        binding = _binding(
            oid=1027,
            identity="public.incomplete_proven_guard_probe()",
            runtime_verdict="OPEN",
            client_callable=True,
        )
        baseline = _guard(
            oid=1027,
            identity="public.incomplete_proven_guard_probe()",
            status="PROVEN",
        )
        mutations = {
            "missing_guard_mechanism": ("guard_mechanism", "missing"),
            "null_guard_mechanism": ("guard_mechanism", None),
            "empty_guard_mechanism": ("guard_mechanism", ""),
            "missing_evidence_location": ("evidence_location", "missing"),
            "null_evidence_location": ("evidence_location", None),
            "empty_evidence_location": ("evidence_location", ""),
            "missing_proof_class": ("proof_class", "missing"),
            "null_proof_class": ("proof_class", None),
            "empty_proof_class": ("proof_class", ""),
        }
        for label, (field, value) in mutations.items():
            with self.subTest(label=label):
                guard = copy.deepcopy(baseline)
                if value == "missing":
                    del guard[field]
                else:
                    guard[field] = value
                self._assert_evidence_error(
                    _run_policy(_bindings_doc([binding]), _guards_doc([guard]))
                )


if __name__ == "__main__":
    unittest.main()