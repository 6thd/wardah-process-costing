#!/usr/bin/env python3
"""RED contract tests for Scanner v2 Slice 4 guard-evidence production.

Slice 4 is intentionally evidence-only. The future producer consumes:
- the original SQL source;
- accepted Slice 2 binding/runtime evidence;
- a separate PostgreSQL-backed guard-contract oracle proving that the four
  recognized authorization helpers still have their reviewed identities and
  exception semantics.

The producer emits only structurally trustworthy guard evidence for the
accepted Slice 3 policy engine. It does not query PostgreSQL itself and does not
replay ACL state.
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
PRODUCER = REPO_ROOT / "scripts/ci/security/scanner_v2_guard_evidence.py"

BINDING_SCANNER = "wardah-scanner-v2-discovery-binding"
CONTRACT_SCANNER = "wardah-scanner-v2-guard-contract-oracle-v1"
GUARD_SCANNER = "wardah-scanner-v2-guard-evidence-v1"

HELPERS = (
    ("public.wardah_assert_org_member(uuid)", "RAISING_ASSERTION"),
    ("public.wardah_assert_org_admin(uuid)", "RAISING_ASSERTION"),
    ("public.wardah_178_assert_permission(uuid,text)", "RAISING_ASSERTION"),
    ("public.wardah_is_org_member(uuid)", "BOOLEAN_DENY"),
)


def _binding(
    *,
    oid: int,
    name: str = "review_probe",
    statement_index: int = 1,
    kind: str = "FUNCTION",
    source_arguments: str = "p_org uuid",
    identity_arguments: str = "uuid",
) -> dict[str, Any]:
    prokind = "p" if kind == "PROCEDURE" else "f"
    return {
        "statement_index": statement_index,
        "source_kind": kind,
        "source_schema": "public",
        "source_name": name,
        "source_arguments": source_arguments,
        "catalog_oid": oid,
        "catalog_identity": f"public.{name}({identity_arguments})",
        "catalog_prokind": prokind,
        "discovery_status": "RESOLVED",
        "client_callable": True,
        "runtime_verdict": "OPEN",
        "runtime_evidence": {
            "public_execute": True,
            "anon_role_exists": True,
            "anon_execute": True,
            "authenticated_role_exists": True,
            "authenticated_execute": True,
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


def _routine_source(
    body: str,
    *,
    name: str = "review_probe",
    kind: str = "FUNCTION",
    args: str = "p_org uuid",
    language: str = "plpgsql",
    tag: str = "$$",
    raw_plpgsql: bool = False,
) -> str:
    kind = kind.upper()
    if kind == "PROCEDURE":
        header = (
            f"CREATE OR REPLACE PROCEDURE public.{name}({args})\n"
            f"LANGUAGE {language}\nSECURITY DEFINER\nAS {tag}\n"
        )
    else:
        header = (
            f"CREATE OR REPLACE FUNCTION public.{name}({args})\n"
            f"RETURNS void\nLANGUAGE {language}\nSECURITY DEFINER\nAS {tag}\n"
        )

    if language.lower() == "plpgsql":
        payload = body if raw_plpgsql else f"BEGIN\n{body}\nEND;"
    else:
        payload = body

    return f"{header}{payload}\n{tag};\n"


def _run_producer(
    source: str,
    bindings: dict[str, Any],
    contract: dict[str, Any] | None = None,
) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        source_path = root / "source.sql"
        bindings_path = root / "bindings.json"
        contract_path = root / "guard-contract.json"
        source_path.write_text(source, encoding="utf-8")
        bindings_path.write_text(json.dumps(bindings), encoding="utf-8")
        contract_path.write_text(
            json.dumps(_guard_contract() if contract is None else contract),
            encoding="utf-8",
        )
        return subprocess.run(
            [
                sys.executable,
                str(PRODUCER),
                "--source",
                str(source_path),
                "--bindings",
                str(bindings_path),
                "--guard-contract-evidence",
                str(contract_path),
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=15,
        )


class Slice4GuardEvidenceContract(unittest.TestCase):
    def _payload(
        self, completed: subprocess.CompletedProcess[str]
    ) -> dict[str, Any]:
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertTrue(completed.stdout.strip(), completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(set(payload), {"scanner", "guard_records"})
        self.assertEqual(payload["scanner"], GUARD_SCANNER)
        self.assertIsInstance(payload["guard_records"], list)
        return payload

    def _record(
        self, completed: subprocess.CompletedProcess[str]
    ) -> dict[str, Any]:
        payload = self._payload(completed)
        self.assertEqual(len(payload["guard_records"]), 1)
        record = payload["guard_records"][0]
        self.assertEqual(
            set(record),
            {
                "catalog_oid",
                "catalog_identity",
                "guard_status",
                "guard_mechanism",
                "evidence_location",
                "proof_class",
            },
        )
        return record

    def _assert_status(
        self,
        completed: subprocess.CompletedProcess[str],
        expected: str,
        *,
        mechanism: str | None = None,
        proof_class: str | None = None,
    ) -> dict[str, Any]:
        record = self._record(completed)
        self.assertEqual(record["guard_status"], expected)
        if expected == "PROVEN":
            self.assertEqual(record["guard_mechanism"], mechanism)
            self.assertEqual(record["proof_class"], proof_class)
            self.assertIsInstance(record["evidence_location"], str)
            self.assertTrue(record["evidence_location"].strip())
            self.assertIn("statement:1", record["evidence_location"])
        else:
            self.assertIsNone(record["guard_mechanism"])
            self.assertIsNone(record["evidence_location"])
            self.assertIsNone(record["proof_class"])
        return record

    def _assert_evidence_error(
        self, completed: subprocess.CompletedProcess[str]
    ) -> None:
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("SCANNER_V2_GUARD_EVIDENCE_ERROR", completed.stderr)
        self.assertNotIn(f'"scanner": "{GUARD_SCANNER}"', completed.stdout)

    def test_proven_org_member_assertion_requires_valid_contract(self) -> None:
        source = _routine_source(
            "PERFORM public.wardah_assert_org_member(p_org);"
        )
        self._assert_status(
            _run_producer(source, _bindings_doc([_binding(oid=2001)])),
            "PROVEN",
            mechanism="public.wardah_assert_org_member",
            proof_class="raising-assertion-v1",
        )

    def test_proven_org_admin_assertion(self) -> None:
        source = _routine_source(
            "PERFORM public.wardah_assert_org_admin(p_org);"
        )
        self._assert_status(
            _run_producer(source, _bindings_doc([_binding(oid=2002)])),
            "PROVEN",
            mechanism="public.wardah_assert_org_admin",
            proof_class="raising-assertion-v1",
        )

    def test_proven_permission_assertion(self) -> None:
        source = _routine_source(
            "PERFORM public.wardah_178_assert_permission("
            "p_org, 'inventory.stock.write');"
        )
        self._assert_status(
            _run_producer(source, _bindings_doc([_binding(oid=2003)])),
            "PROVEN",
            mechanism="public.wardah_178_assert_permission",
            proof_class="raising-assertion-v1",
        )

    def test_absent_when_no_guard_candidate_exists(self) -> None:
        source = _routine_source("PERFORM 1;")
        self._assert_status(
            _run_producer(source, _bindings_doc([_binding(oid=2004)])),
            "ABSENT",
        )

    def test_textual_mentions_do_not_prove(self) -> None:
        cases = {
            "comment": "-- PERFORM public.wardah_assert_org_member(p_org);\nPERFORM 1;",
            "literal": "PERFORM 'public.wardah_assert_org_member(p_org)';",
            "nested_dollar_literal": (
                "PERFORM $x$public.wardah_assert_org_member(p_org)$x$;"
            ),
            "quoted_alias": 'PERFORM 1 AS "wardah_assert_org_member";',
            "bare_identifier": "PERFORM wardah_assert_org_member;",
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                source = _routine_source(body)
                self._assert_status(
                    _run_producer(
                        source, _bindings_doc([_binding(oid=2010)])
                    ),
                    "ABSENT",
                )

        tagged = _routine_source(
            "PERFORM 1;",
            tag="$wardah_assert_org_member$",
        )
        self._assert_status(
            _run_producer(tagged, _bindings_doc([_binding(oid=2011)])),
            "ABSENT",
        )

    def test_unqualified_recognized_guard_is_ambiguous(self) -> None:
        source = _routine_source(
            "PERFORM wardah_assert_org_member(p_org);"
        )
        self._assert_status(
            _run_producer(source, _bindings_doc([_binding(oid=2012)])),
            "AMBIGUOUS",
        )

    def test_wrong_schema_or_arity_is_unknown(self) -> None:
        cases = {
            "wrong_schema": (
                "PERFORM attacker.wardah_assert_org_member(p_org);"
            ),
            "member_wrong_arity": (
                "PERFORM public.wardah_assert_org_member(p_org, p_org);"
            ),
            "admin_wrong_arity": (
                "PERFORM public.wardah_assert_org_admin();"
            ),
            "permission_wrong_arity": (
                "PERFORM public.wardah_178_assert_permission(p_org);"
            ),
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2013)]),
                    ),
                    "UNKNOWN",
                )

    def test_discarded_boolean_predicate_is_unknown(self) -> None:
        source = _routine_source(
            "PERFORM public.wardah_is_org_member(p_org);"
        )
        self._assert_status(
            _run_producer(source, _bindings_doc([_binding(oid=2014)])),
            "UNKNOWN",
        )

    def test_negated_boolean_deny_is_proven(self) -> None:
        cases = {
            "sole_term": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "top_level_or_term": (
                "IF p_org IS NULL OR NOT public.wardah_is_org_member(p_org) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2015)]),
                    ),
                    "PROVEN",
                    mechanism="public.wardah_is_org_member",
                    proof_class="negated-boolean-deny-v1",
                )

    def test_boolean_deny_non_guaranteeing_shapes_are_unknown(self) -> None:
        cases = {
            "and_false": (
                "IF NOT public.wardah_is_org_member(p_org) AND false THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "no_raise": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "  PERFORM 1;\n"
                "END IF;"
            ),
            "return_before_raise": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "  RETURN;\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "non_aborting_raise": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "  RAISE NOTICE 'DENIED';\n"
                "END IF;"
            ),
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2016)]),
                    ),
                    "UNKNOWN",
                )

    def test_nested_assertion_is_unknown(self) -> None:
        cases = {
            "if": (
                "IF true THEN\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "END IF;"
            ),
            "loop": (
                "LOOP\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "  EXIT;\n"
                "END LOOP;"
            ),
            "case": (
                "CASE WHEN true THEN\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "END CASE;"
            ),
            "nested_begin": (
                "BEGIN\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "END;"
            ),
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2017)]),
                    ),
                    "UNKNOWN",
                )

    def test_unreachable_assertion_after_terminator_is_unknown(self) -> None:
        cases = {
            "return": (
                "BEGIN\n"
                "  RETURN;\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "END;"
            ),
            "raise": (
                "BEGIN\n"
                "  RAISE EXCEPTION 'STOP';\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "END;"
            ),
            "labelled_exit": (
                "<<outer>>\n"
                "BEGIN\n"
                "  EXIT outer;\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "END outer;"
            ),
        }
        for label, block in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(block, raw_plpgsql=True),
                        _bindings_doc([_binding(oid=2018)]),
                    ),
                    "UNKNOWN",
                )

    def test_catching_exception_handlers_block_proof(self) -> None:
        handlers = {
            "others": "OTHERS",
            "raise_exception": "raise_exception",
            "quoted_raise_exception": '"raise_exception"',
            "plpgsql_error": "plpgsql_error",
            "sqlstate_p0001": "SQLSTATE 'P0001'",
            "sqlstate_p0000": "SQLSTATE 'P0000'",
        }
        for label, handler in handlers.items():
            with self.subTest(label=label):
                block = (
                    "BEGIN\n"
                    "  PERFORM public.wardah_assert_org_member(p_org);\n"
                    "EXCEPTION\n"
                    f"  WHEN {handler} THEN NULL;\n"
                    "END;"
                )
                self._assert_status(
                    _run_producer(
                        _routine_source(block, raw_plpgsql=True),
                        _bindings_doc([_binding(oid=2019)]),
                    ),
                    "UNKNOWN",
                )

    def test_noncapturing_exception_handler_allows_proof(self) -> None:
        handlers = {
            "unique_violation": "unique_violation",
            "sqlstate_23505": "SQLSTATE '23505'",
        }
        for label, handler in handlers.items():
            with self.subTest(label=label):
                block = (
                    "BEGIN\n"
                    "  PERFORM public.wardah_assert_org_member(p_org);\n"
                    "EXCEPTION\n"
                    f"  WHEN {handler} THEN NULL;\n"
                    "END;"
                )
                self._assert_status(
                    _run_producer(
                        _routine_source(block, raw_plpgsql=True),
                        _bindings_doc([_binding(oid=2020)]),
                    ),
                    "PROVEN",
                    mechanism="public.wardah_assert_org_member",
                    proof_class="raising-assertion-v1",
                )

    def test_multiple_proven_guards_are_deterministic(self) -> None:
        source = _routine_source(
            "PERFORM public.wardah_assert_org_member(p_org);\n"
            "PERFORM public.wardah_assert_org_admin(p_org);"
        )
        record = self._assert_status(
            _run_producer(source, _bindings_doc([_binding(oid=2021)])),
            "PROVEN",
            mechanism="public.wardah_assert_org_member",
            proof_class="raising-assertion-v1",
        )
        self.assertIn("statement:1", record["evidence_location"])

    def test_multi_binding_emits_exactly_one_record_per_binding(self) -> None:
        source = (
            _routine_source(
                "PERFORM public.wardah_assert_org_member(p_org);",
                name="guarded_probe",
            )
            + "\n"
            + _routine_source(
                "PERFORM 1;",
                name="unguarded_probe",
            )
        )
        bindings = _bindings_doc(
            [
                _binding(
                    oid=2022,
                    name="guarded_probe",
                    statement_index=1,
                ),
                _binding(
                    oid=2023,
                    name="unguarded_probe",
                    statement_index=2,
                ),
            ]
        )
        payload = self._payload(_run_producer(source, bindings))
        self.assertEqual(len(payload["guard_records"]), 2)
        by_oid = {
            record["catalog_oid"]: record
            for record in payload["guard_records"]
        }
        self.assertEqual(set(by_oid), {2022, 2023})
        self.assertEqual(by_oid[2022]["guard_status"], "PROVEN")
        self.assertEqual(by_oid[2023]["guard_status"], "ABSENT")

    def test_orphan_source_routine_is_not_emitted(self) -> None:
        source = (
            _routine_source(
                "PERFORM public.wardah_assert_org_member(p_org);",
                name="bound_probe",
            )
            + "\n"
            + _routine_source(
                "PERFORM public.wardah_assert_org_admin(p_org);",
                name="source_only_probe",
            )
        )
        payload = self._payload(
            _run_producer(
                source,
                _bindings_doc(
                    [_binding(oid=2024, name="bound_probe", statement_index=1)]
                ),
            )
        )
        self.assertEqual(len(payload["guard_records"]), 1)
        self.assertEqual(payload["guard_records"][0]["catalog_oid"], 2024)

    def test_statement_binding_identity_mismatch_fails_hard(self) -> None:
        source = _routine_source(
            "PERFORM public.wardah_assert_org_member(p_org);",
            name="actual_probe",
        )
        binding = _binding(oid=2025, name="other_probe")
        self._assert_evidence_error(
            _run_producer(source, _bindings_doc([binding]))
        )

    def test_duplicate_binding_oid_fails_hard(self) -> None:
        source = (
            _routine_source("PERFORM 1;", name="first_probe")
            + "\n"
            + _routine_source("PERFORM 1;", name="second_probe")
        )
        bindings = _bindings_doc(
            [
                _binding(oid=2026, name="first_probe", statement_index=1),
                _binding(oid=2026, name="second_probe", statement_index=2),
            ]
        )
        self._assert_evidence_error(_run_producer(source, bindings))

    def test_binding_document_contract_is_strict(self) -> None:
        baseline = _bindings_doc([_binding(oid=2027)])
        mutations = {
            "wrong_scanner": {"scanner": "wrong-binding-producer"},
            "wrong_status": {"status": "UNKNOWN"},
            "wrong_candidate_count": {"candidate_count": 2},
            "wrong_binding_count": {"binding_count": 2},
            "extra_top_level_key": {"override_guard": "PROVEN"},
        }
        for label, mutation in mutations.items():
            with self.subTest(label=label):
                evidence = copy.deepcopy(baseline)
                evidence.update(mutation)
                self._assert_evidence_error(
                    _run_producer(
                        _routine_source("PERFORM 1;"),
                        evidence,
                    )
                )

    def test_guard_contract_evidence_is_mandatory_and_exact(self) -> None:
        source = _routine_source(
            "PERFORM public.wardah_assert_org_member(p_org);"
        )
        bindings = _bindings_doc([_binding(oid=2028)])
        baseline = _guard_contract()

        cases: dict[str, dict[str, Any]] = {}

        wrong_scanner = copy.deepcopy(baseline)
        wrong_scanner["scanner"] = "wrong-guard-contract"
        cases["wrong_scanner"] = wrong_scanner

        wrong_status = copy.deepcopy(baseline)
        wrong_status["status"] = "UNKNOWN"
        cases["wrong_status"] = wrong_status

        wrong_count = copy.deepcopy(baseline)
        wrong_count["helper_count"] = 3
        cases["wrong_count"] = wrong_count

        missing_helper = copy.deepcopy(baseline)
        missing_helper["helpers"] = missing_helper["helpers"][:-1]
        missing_helper["helper_count"] = len(missing_helper["helpers"])
        cases["missing_helper"] = missing_helper

        duplicate_helper = copy.deepcopy(baseline)
        duplicate_helper["helpers"][-1] = copy.deepcopy(
            duplicate_helper["helpers"][0]
        )
        cases["duplicate_helper"] = duplicate_helper

        wrong_kind = copy.deepcopy(baseline)
        wrong_kind["helpers"][0]["guard_kind"] = "BOOLEAN_DENY"
        cases["wrong_helper_kind"] = wrong_kind

        wrong_raise_code = copy.deepcopy(baseline)
        wrong_raise_code["exception_semantics"][
            "raise_exception_sqlstate"
        ] = "XX000"
        cases["wrong_raise_sqlstate"] = wrong_raise_code

        wrong_class_code = copy.deepcopy(baseline)
        wrong_class_code["exception_semantics"][
            "raise_exception_class_sqlstate"
        ] = "XX000"
        cases["wrong_raise_class_sqlstate"] = wrong_class_code

        wrong_unique = copy.deepcopy(baseline)
        wrong_unique["exception_semantics"][
            "unique_violation_catches_raise_exception"
        ] = True
        cases["unique_violation_semantics_drift"] = wrong_unique

        for label, contract in cases.items():
            with self.subTest(label=label):
                self._assert_evidence_error(
                    _run_producer(source, bindings, contract)
                )

    def test_sql_language_target_is_unknown(self) -> None:
        source = _routine_source(
            "SELECT public.wardah_assert_org_member(p_org);",
            language="sql",
        )
        self._assert_status(
            _run_producer(source, _bindings_doc([_binding(oid=2029)])),
            "UNKNOWN",
        )

    def test_procedure_target_can_be_proven(self) -> None:
        source = _routine_source(
            "PERFORM public.wardah_assert_org_member(p_org);",
            name="review_proc",
            kind="PROCEDURE",
        )
        binding = _binding(
            oid=2030,
            name="review_proc",
            kind="PROCEDURE",
        )
        self._assert_status(
            _run_producer(source, _bindings_doc([binding])),
            "PROVEN",
            mechanism="public.wardah_assert_org_member",
            proof_class="raising-assertion-v1",
        )

    def test_non_proven_records_have_null_proof_fields(self) -> None:
        cases = {
            "ABSENT": "PERFORM 1;",
            "UNKNOWN": "PERFORM public.wardah_is_org_member(p_org);",
            "AMBIGUOUS": "PERFORM wardah_assert_org_member(p_org);",
        }
        for expected, body in cases.items():
            with self.subTest(expected=expected):
                record = self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2031)]),
                    ),
                    expected,
                )
                self.assertIsNone(record["guard_mechanism"])
                self.assertIsNone(record["evidence_location"])
                self.assertIsNone(record["proof_class"])


if __name__ == "__main__":
    unittest.main()
