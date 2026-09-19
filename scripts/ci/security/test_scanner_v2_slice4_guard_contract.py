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

CATCHING_HANDLERS = {
    "others": "OTHERS",
    "raise_exception": "raise_exception",
    "quoted_raise_exception": '"raise_exception"',
    "plpgsql_error": "plpgsql_error",
    "sqlstate_p0001": "SQLSTATE 'P0001'",
    "sqlstate_p0000": "SQLSTATE 'P0000'",
}

NONCAPTURING_HANDLERS = {
    "unique_violation": "unique_violation",
    "sqlstate_23505": "SQLSTATE '23505'",
}

RAISING_GUARD_BODY = "PERFORM public.wardah_assert_org_member(p_org);"

BOOLEAN_DENY_GUARD_BODY = (
    "IF NOT public.wardah_is_org_member(p_org) THEN\n"
    "  RAISE EXCEPTION 'DENIED';\n"
    "END IF;"
)

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


def _indent(body: str) -> str:
    return "\n".join(
        f"  {line}" if line else line for line in body.splitlines()
    )


def _handler_block(guard: str, *handlers: str) -> str:
    """Wrap ``guard`` in the routine's own outermost handler block.

    An EXCEPTION section is a *list* of WHEN clauses, so several may be
    passed; PostgreSQL tries each in order and the first match wins.
    """
    whens = "\n".join(f"  WHEN {handler} THEN NULL;" for handler in handlers)
    return (
        "BEGIN\n"
        f"{_indent(guard)}\n"
        "EXCEPTION\n"
        f"{whens}\n"
        "END;"
    )


def _labelled_block(
    body: str,
    *,
    label: str = "auth_block",
    end_label: str | None = None,
    declare: str = "",
    between: str = "",
) -> str:
    """A routine body whose OUTER block carries a ``<<label>>``.

    The block grammar is ``[<<label>>] [DECLARE ...] BEGIN ... END
    [label];`` — the label precedes any declaration section, and PL/pgSQL
    labels are identifiers, so they may be quoted or non-ASCII.
    """
    tail = label if end_label is None else end_label
    head = f"<<{label}>>\n{between}"
    if declare:
        head += f"DECLARE\n{_indent(declare)}\n"
    tail_text = f" {tail}" if tail else ""
    return f"{head}BEGIN\n{_indent(body)}\nEND{tail_text};"


def _declare_block(declarations: str, body: str) -> str:
    """A routine body with its own DECLARE section."""
    return (
        "DECLARE\n"
        f"{_indent(declarations)}\n"
        "BEGIN\n"
        f"{_indent(body)}\n"
        "END;"
    )


# PostgreSQL scan.l: dolq_start is [A-Za-z\200-\377_] and dolq_cont adds
# [0-9], so EVERY non-ASCII byte is legal in a dollar-quote tag. A tag the
# producer fails to recognize leaves the literal's content exposed as
# executable text, which is how these became real false-greens.
NON_ASCII_TAGS = {
    "emoji": "$\U0001F600$",
    "roman_numeral": "$\u2168$",
    "combining_mark": "$a\u0301$",
    "zero_width_space": "$a\u200b$",
    "nbsp": "$\u00a0$",
    "soft_hyphen": "$\u00ad$",
    "bom": "$a\ufeff$",
    "private_use": "$\ue000$",
}

# PostgreSQL clips every identifier to NAMEDATALEN-1 = 63 BYTES, on a
# character boundary, and downcases UNQUOTED identifiers in ASCII ONLY.
# A block label and an EXIT target are therefore the same label whenever
# their canonical forms agree, however differently they are spelled in the
# source. Slice 4 needs this only for labels; routine, schema and type
# identity stay on the accepted Slice 2 boundary.
NAMEDATALEN_LIMIT = 63

# 64 ASCII bytes with the suffix: the suffix is clipped away.
LONG_ASCII = "a" * NAMEDATALEN_LIMIT

# 32 two-byte Arabic letters are already 64 bytes, so these labels differ
# only past the limit while being short in CHARACTERS.
LONG_MULTIBYTE = "\u0645" * 32

# U+212A KELVIN SIGN is 3 UTF-8 bytes; Python's str.lower() turns it into a
# 1-byte "k", which moves the 63-byte clip and pulls an over-length label
# back under the limit. PostgreSQL does not fold it at all.
KELVIN = "\u212a"

# U+1D400 MATHEMATICAL BOLD CAPITAL A: 4 UTF-8 bytes, above the BMP.
ASTRAL = "\U0001D400"

GUARD_PATHS = {
    "raising_assertion": (
        RAISING_GUARD_BODY,
        "public.wardah_assert_org_member",
        "raising-assertion-v1",
    ),
    "negated_boolean_deny": (
        BOOLEAN_DENY_GUARD_BODY,
        "public.wardah_is_org_member",
        "negated-boolean-deny-v1",
    ),
}


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

    def test_raising_assertion_must_be_a_standalone_statement(self) -> None:
        """The call must be the statement, not merely appear in one.

        Carried over from the accepted predecessor's
        ``test_standalone_perform_contract``. A ``PERFORM guard(...) WHERE
        false`` names a real helper with the exact oracle signature and
        never executes it; a matcher keyed on "PERFORM + helper" proves it
        anyway.
        """
        rejected = {
            "perform_where_false": (
                "PERFORM public.wardah_assert_org_member(p_org) WHERE false;"
            ),
            "perform_from_table": (
                "PERFORM public.wardah_assert_org_member(p_org) "
                "FROM public.bins;"
            ),
            "select_context": (
                "SELECT public.wardah_assert_org_member(p_org);"
            ),
            "select_where_false": (
                "SELECT public.wardah_assert_org_member(p_org) WHERE false;"
            ),
            "perform_as_operand": (
                "PERFORM 1 WHERE public.wardah_assert_org_member(p_org) "
                "IS NOT NULL;"
            ),
        }
        for label, body in rejected.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2052)]),
                    ),
                    "UNKNOWN",
                )

        with self.subTest(label="assignment_context"):
            block = (
                "DECLARE\n"
                "  v_ok boolean;\n"
                "BEGIN\n"
                "  v_ok := public.wardah_assert_org_member(p_org);\n"
                "END;"
            )
            self._assert_status(
                _run_producer(
                    _routine_source(block, raw_plpgsql=True),
                    _bindings_doc([_binding(oid=2053)]),
                ),
                "UNKNOWN",
            )

        accepted = {
            "plain": RAISING_GUARD_BODY,
            "spaced": (
                "  PERFORM  public.wardah_assert_org_member ( p_org ) ;"
            ),
            "wrapped_across_lines": (
                "PERFORM public.wardah_assert_org_member(\n"
                "  p_org\n"
                ");"
            ),
        }
        for label, body in accepted.items():
            with self.subTest(accept=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2054)]),
                    ),
                    "PROVEN",
                    mechanism="public.wardah_assert_org_member",
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
            "block_comment": (
                "/* PERFORM public.wardah_assert_org_member(p_org); */\n"
                "PERFORM 1;"
            ),
            "nested_block_comment": (
                "/* outer /* inner */\n"
                "PERFORM public.wardah_assert_org_member(p_org);\n"
                "*/\n"
                "PERFORM 1;"
            ),
            "escape_string": (
                "PERFORM E'public.wardah_assert_org_member(p_org)';"
            ),
            "escape_string_with_escaped_quote": (
                "PERFORM E'it\\'s public.wardah_assert_org_member(p_org)';"
            ),
            "unicode_string": (
                "PERFORM U&'public.wardah_assert_org_member(p_org)';"
            ),
            "doubled_quote_literal": (
                "PERFORM 'it''s public.wardah_assert_org_member(p_org)';"
            ),
            "continued_literal": (
                "PERFORM 'public.wardah_assert_org_member('\n"
                "'p_org)';"
            ),
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

    def test_literal_and_comment_boundaries_do_not_hide_real_guards(
        self,
    ) -> None:
        """Masking must end exactly where PostgreSQL ends a literal/comment.

        The mirror of ``test_textual_mentions_do_not_prove``: a masker that
        mis-locates a closing boundary silently swallows the executable guard
        that follows it and reports a false ABSENT/UNKNOWN.
        """
        cases = {
            "after_escape_string_with_escaped_quote": (
                "PERFORM E'it\\'s not a guard';\n"
                + RAISING_GUARD_BODY
            ),
            "after_doubled_quote_literal": (
                "PERFORM 'it''s not a guard';\n" + RAISING_GUARD_BODY
            ),
            "after_unicode_string": (
                "PERFORM U&'not a guard';\n" + RAISING_GUARD_BODY
            ),
            "after_continued_literal": (
                "PERFORM 'not '\n'a guard';\n" + RAISING_GUARD_BODY
            ),
            "after_nested_block_comment": (
                "/* outer /* inner */ still comment */\n" + RAISING_GUARD_BODY
            ),
            "after_dollar_literal": (
                "PERFORM $x$not a guard$x$;\n" + RAISING_GUARD_BODY
            ),
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2032)]),
                    ),
                    "PROVEN",
                    mechanism="public.wardah_assert_org_member",
                    proof_class="raising-assertion-v1",
                )

    def test_textual_boolean_deny_mentions_do_not_prove(self) -> None:
        """The boolean-deny idiom is masked by the same lexical rules.

        ``negated-boolean-deny-v1`` carries its own proof class, so a producer
        may well reach it through a separate matcher. That matcher must sit
        behind the same literal/comment masking as the raising path.
        """
        cases = {
            "ordinary_literal": (
                "PERFORM 'IF NOT public.wardah_is_org_member(p_org) "
                "THEN RAISE EXCEPTION ''DENIED''; END IF;';"
            ),
            "escape_string": (
                "PERFORM E'IF NOT public.wardah_is_org_member(p_org) "
                "THEN RAISE EXCEPTION \\'DENIED\\'; END IF;';"
            ),
            "unicode_string": (
                "PERFORM U&'IF NOT public.wardah_is_org_member(p_org) "
                "THEN RAISE EXCEPTION ''DENIED''; END IF;';"
            ),
            "dollar_literal": (
                "PERFORM $x$IF NOT public.wardah_is_org_member(p_org) "
                "THEN RAISE EXCEPTION 'DENIED'; END IF;$x$;"
            ),
            "line_comment": (
                "-- IF NOT public.wardah_is_org_member(p_org) "
                "THEN RAISE EXCEPTION 'DENIED'; END IF;\n"
                "PERFORM 1;"
            ),
            "block_comment": (
                "/* IF NOT public.wardah_is_org_member(p_org)\n"
                "   THEN RAISE EXCEPTION 'DENIED'; END IF; */\n"
                "PERFORM 1;"
            ),
            "nested_block_comment": (
                "/* outer /* inner */\n"
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;\n"
                "*/\n"
                "PERFORM 1;"
            ),
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2045)]),
                    ),
                    "ABSENT",
                )

    def test_boundaries_do_not_hide_real_boolean_deny_guards(self) -> None:
        """Over-consumption mirror for the boolean-deny path."""
        cases = {
            "after_escape_string_with_escaped_quote": (
                "PERFORM E'it\\'s not a guard';\n" + BOOLEAN_DENY_GUARD_BODY
            ),
            "after_doubled_quote_literal": (
                "PERFORM 'it''s not a guard';\n" + BOOLEAN_DENY_GUARD_BODY
            ),
            "after_nested_block_comment": (
                "/* outer /* inner */ still comment */\n"
                + BOOLEAN_DENY_GUARD_BODY
            ),
            "after_dollar_literal": (
                "PERFORM $x$not a guard$x$;\n" + BOOLEAN_DENY_GUARD_BODY
            ),
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2046)]),
                    ),
                    "PROVEN",
                    mechanism="public.wardah_is_org_member",
                    proof_class="negated-boolean-deny-v1",
                )

    def test_non_ascii_dollar_tags_are_recognized(self) -> None:
        """Tag recognition decides where executable text even begins.

        Carried over from the predecessor's
        ``test_dollar_tag_recognition_uses_postgresqls_byte_range``. A tag the
        producer does not recognize leaves the literal's content exposed, so
        the guard text inside it reads as code.
        """
        for label, tag in NON_ASCII_TAGS.items():
            with self.subTest(reject=label):
                body = f"PERFORM {tag} {RAISING_GUARD_BODY} {tag};"
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2071)]),
                    ),
                    "ABSENT",
                )
            with self.subTest(reject_boolean=label):
                inline = " ".join(BOOLEAN_DENY_GUARD_BODY.split("\n"))
                body = f"PERFORM {tag} {inline} {tag};"
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2072)]),
                    ),
                    "ABSENT",
                )

    def test_non_ascii_dollar_tags_do_not_hide_real_guards(self) -> None:
        """Widen tag recognition, do not swallow real guards.

        Both halves matter: the tag may delimit a literal *beside* the guard,
        or the routine body itself — and an unrecognized body delimiter means
        no body to analyse at all.
        """
        for label, tag in NON_ASCII_TAGS.items():
            with self.subTest(beside=label):
                body = f"PERFORM {tag}note{tag};\n{RAISING_GUARD_BODY}"
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2073)]),
                    ),
                    "PROVEN",
                    mechanism="public.wardah_assert_org_member",
                    proof_class="raising-assertion-v1",
                )
            with self.subTest(delimits_body=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(RAISING_GUARD_BODY, tag=tag),
                        _bindings_doc([_binding(oid=2074)]),
                    ),
                    "PROVEN",
                    mechanism="public.wardah_assert_org_member",
                    proof_class="raising-assertion-v1",
                )
            with self.subTest(delimits_body_boolean=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(BOOLEAN_DENY_GUARD_BODY, tag=tag),
                        _bindings_doc([_binding(oid=2075)]),
                    ),
                    "PROVEN",
                    mechanism="public.wardah_is_org_member",
                    proof_class="negated-boolean-deny-v1",
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

    def test_wrong_argument_type_is_not_proven(self) -> None:
        """The call must resolve to the exact oracle overload identity.

        ``public.wardah_assert_org_member`` alone is a name, not an identity;
        only ``public.wardah_assert_org_member(uuid)`` is in the oracle. A call
        that provably resolves elsewhere, or whose resolution is not statically
        determinable, must fail closed.
        """
        uuid_arg_cases = {
            "explicit_cast_to_text": (
                "PERFORM public.wardah_assert_org_member(p_org::text);"
            ),
            "typed_non_uuid_literal": (
                "PERFORM public.wardah_assert_org_member('abc'::text);"
            ),
            "untyped_literal": (
                "PERFORM public.wardah_assert_org_member('abc');"
            ),
            "integer_literal": (
                "PERFORM public.wardah_assert_org_member(1);"
            ),
            "permission_first_arg_cast": (
                "PERFORM public.wardah_178_assert_permission("
                "p_org::text, 'inventory.stock.write');"
            ),
        }
        for label, body in uuid_arg_cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2033)]),
                    ),
                    "UNKNOWN",
                )

        with self.subTest(label="declared_text_parameter"):
            self._assert_status(
                _run_producer(
                    _routine_source(
                        RAISING_GUARD_BODY,
                        args="p_org text",
                    ),
                    _bindings_doc(
                        [
                            _binding(
                                oid=2034,
                                source_arguments="p_org text",
                                identity_arguments="text",
                            )
                        ]
                    ),
                ),
                "UNKNOWN",
            )

    def test_every_signature_family_rejects_type_mismatch(self) -> None:
        """Each helper family is frozen on its own complete signature.

        Closing the mismatch only for ``wardah_assert_org_member(uuid)`` and
        for the permission helper's *first* argument leaves the remaining
        families provable from name plus arity alone.
        """
        assertion_cases = {
            "admin_cast_to_text": (
                "PERFORM public.wardah_assert_org_admin(p_org::text);"
            ),
            "admin_typed_non_uuid_literal": (
                "PERFORM public.wardah_assert_org_admin('abc'::text);"
            ),
            "admin_untyped_literal": (
                "PERFORM public.wardah_assert_org_admin('abc');"
            ),
            "admin_integer_literal": (
                "PERFORM public.wardah_assert_org_admin(1);"
            ),
            "permission_second_arg_is_uuid": (
                "PERFORM public.wardah_178_assert_permission(p_org, p_org);"
            ),
            "permission_second_arg_cast_to_uuid": (
                "PERFORM public.wardah_178_assert_permission("
                "p_org, 'inventory.stock.write'::uuid);"
            ),
            "permission_second_arg_integer": (
                "PERFORM public.wardah_178_assert_permission(p_org, 1);"
            ),
        }
        for label, body in assertion_cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2043)]),
                    ),
                    "UNKNOWN",
                )

        boolean_cases = {
            "member_predicate_cast_to_text": (
                "IF NOT public.wardah_is_org_member(p_org::text) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "member_predicate_typed_non_uuid_literal": (
                "IF NOT public.wardah_is_org_member('abc'::text) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "member_predicate_untyped_literal": (
                "IF NOT public.wardah_is_org_member('abc') THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "member_predicate_wrong_arity": (
                "IF NOT public.wardah_is_org_member(p_org, p_org) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "member_predicate_wrong_schema": (
                "IF NOT attacker.wardah_is_org_member(p_org) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
        }
        for label, body in boolean_cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2044)]),
                    ),
                    "UNKNOWN",
                )

    def test_competing_same_arity_overload_is_not_proven(self) -> None:
        """A same-name/same-arity neighbour must not borrow the identity."""
        competing = _routine_source(
            "RAISE NOTICE 'not a guard';",
            name="wardah_assert_org_member",
            args="p_org text",
        )
        cases = {
            "resolves_to_competing_overload": (
                _routine_source(RAISING_GUARD_BODY, args="p_org text"),
                _binding(
                    oid=2035,
                    statement_index=2,
                    source_arguments="p_org text",
                    identity_arguments="text",
                ),
            ),
            "ambiguous_untyped_literal": (
                _routine_source(
                    "PERFORM public.wardah_assert_org_member('abc');"
                ),
                _binding(oid=2036, statement_index=2),
            ),
        }
        for label, (target, binding) in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        competing + "\n" + target,
                        _bindings_doc([binding]),
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

    def test_deny_branch_structure_mutants_are_unknown(self) -> None:
        """A nearby RAISE is not a denial; the deny branch must abort.

        Carried over from the accepted predecessor's
        ``NEGATED_RAISE_MUTANTS_MUST_REJECT``. Each shape names the real
        predicate with the exact oracle signature and contains a real
        ``RAISE``, yet a non-member walks through every one of them.
        """
        cases = {
            "predicate_not_negated": (
                "IF public.wardah_is_org_member(p_org) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "raise_only_in_else_branch": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "  NULL;\n"
                "ELSE\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "raise_only_in_elsif_branch": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "  NULL;\n"
                "ELSIF p_org IS NULL THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "raise_only_in_nested_if_false": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "  IF false THEN\n"
                "    RAISE EXCEPTION 'DENIED';\n"
                "  END IF;\n"
                "END IF;"
            ),
            "raise_only_in_nested_if_true": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "  IF true THEN\n"
                "    RAISE EXCEPTION 'DENIED';\n"
                "  END IF;\n"
                "END IF;"
            ),
            "raise_only_in_nested_loop": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "  WHILE false LOOP\n"
                "    RAISE EXCEPTION 'DENIED';\n"
                "  END LOOP;\n"
                "END IF;"
            ),
            "raise_after_end_if": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "  NULL;\n"
                "END IF;\n"
                "RAISE NOTICE 'later';"
            ),
            "predicate_in_body_not_condition": (
                "IF true THEN\n"
                "  PERFORM public.wardah_is_org_member(p_org);\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "quoted_identifier_named_raise": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                '  PERFORM 1 AS "RAISE";\n'
                "END IF;"
            ),
            "quoted_identifier_raise_exception": (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                '  PERFORM 1 AS "RAISE EXCEPTION";\n'
                "END IF;"
            ),
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2063)]),
                    ),
                    "UNKNOWN",
                )

    def test_non_membership_must_be_a_sole_top_level_term(self) -> None:
        """Non-membership alone must guarantee entry into the deny branch.

        Carried over from the predecessor's ``SUPPRESSED_DENY_MUST_REJECT``
        and ``test_top_level_term_analysis``. The predicate IS negated and the
        branch DOES abort, but a conjunction means a non-member never reaches
        it. Rejecting only a trailing ``AND false`` leaves the rest open.
        """
        rejected = {
            "negated_predicate_and_false": (
                "IF NOT public.wardah_is_org_member(p_org) AND false THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "false_and_negated_predicate": (
                "IF false AND NOT public.wardah_is_org_member(p_org) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "negated_predicate_and_other_condition": (
                "IF NOT public.wardah_is_org_member(p_org) AND v_flag THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "other_condition_and_negated_predicate": (
                "IF v_flag AND NOT public.wardah_is_org_member(p_org) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "negated_predicate_inside_parenthesised_and": (
                "IF (NOT public.wardah_is_org_member(p_org) AND v_flag) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "or_term_is_itself_a_conjunction": (
                "IF p_org IS NULL\n"
                "   OR (NOT public.wardah_is_org_member(p_org) AND v_flag)\n"
                "THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
        }
        for label, body in rejected.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(
                            _declare_block("v_flag boolean := true;", body),
                            raw_plpgsql=True,
                        ),
                        _bindings_doc([_binding(oid=2064)]),
                    ),
                    "UNKNOWN",
                )

        accepted = {
            "parenthesised_sole_term": (
                "IF (NOT public.wardah_is_org_member(p_org)) THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "spaced_sole_term": (
                "IF   NOT  public.wardah_is_org_member ( p_org )   THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "parenthesised_or_term": (
                "IF p_org IS NULL\n"
                "   OR (NOT public.wardah_is_org_member(p_org))\n"
                "THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
            "or_term_is_last_disjunct": (
                "IF p_org IS NULL OR v_flag\n"
                "   OR NOT public.wardah_is_org_member(p_org)\n"
                "THEN\n"
                "  RAISE EXCEPTION 'DENIED';\n"
                "END IF;"
            ),
        }
        for label, body in accepted.items():
            with self.subTest(accept=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(
                            _declare_block("v_flag boolean := true;", body),
                            raw_plpgsql=True,
                        ),
                        _bindings_doc([_binding(oid=2065)]),
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

    def test_labelled_exit_reads_quoted_and_non_ascii_labels(self) -> None:
        """A block label is an identifier, not a bare ASCII word.

        Carried over from the predecessor's labelled-EXIT corpus. The jump
        lands past the guard, so the routine returns having authorized
        nothing; a producer that can only read ``EXIT outer`` sees no jump and
        calls the guard reachable.
        """
        work = "UPDATE public.bins SET reserved_qty = 0 WHERE org_id = p_org;"
        declare = "v_seen boolean := false;"
        arabic = "\u062d\u0627\u0631\u0633"  # حارس
        cases = {
            "quoted_label": _labelled_block(
                f'{work}\nEXIT "auth_block";\n{RAISING_GUARD_BODY}',
                label='"auth_block"',
                end_label='"auth_block"',
            ),
            "quoted_label_with_a_declare_section": _labelled_block(
                f'{work}\nEXIT "auth_block";\n{RAISING_GUARD_BODY}',
                label='"auth_block"',
                end_label='"auth_block"',
                declare=declare,
            ),
            "non_ascii_unquoted_label": _labelled_block(
                f"{work}\nEXIT {arabic};\n{RAISING_GUARD_BODY}",
                label=arabic,
                end_label=arabic,
            ),
            "non_ascii_label_with_a_declare_section": _labelled_block(
                f"{work}\nEXIT {arabic};\n{RAISING_GUARD_BODY}",
                label=arabic,
                end_label=arabic,
                declare=declare,
            ),
            "ascii_label_with_a_declare_section": _labelled_block(
                f"{work}\nEXIT auth_block;\n{RAISING_GUARD_BODY}",
                declare=declare,
            ),
            "conditional_labelled_exit": _labelled_block(
                f"{work}\nEXIT auth_block WHEN p_org IS NULL;\n"
                f"{RAISING_GUARD_BODY}",
            ),
            "inner_block_exits_the_labelled_outer_block": _labelled_block(
                "BEGIN\n  EXIT auth_block;\nEND;\n"
                f"{RAISING_GUARD_BODY}\n{work}",
            ),
            "comment_between_label_and_begin": _labelled_block(
                f"{work}\nEXIT auth_block;\n{RAISING_GUARD_BODY}",
                between="/* " + ("x" * 400) + " */\n",
            ),
            "labelled_exit_before_boolean_guard": _labelled_block(
                f"EXIT auth_block;\n{BOOLEAN_DENY_GUARD_BODY}\n{work}",
            ),
        }
        for label, block in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(block, raw_plpgsql=True),
                        _bindings_doc([_binding(oid=2076)]),
                    ),
                    "UNKNOWN",
                )

    def test_a_block_that_exits_itself_leaves_a_later_guard_intact(
        self,
    ) -> None:
        """Label identity, not the mere presence of an EXIT."""
        for path_label, (
            guard,
            mechanism,
            proof_class,
        ) in GUARD_PATHS.items():
            cases = {
                "inner_block_exits_itself": _labelled_block(
                    "<<inner>>\nBEGIN\n  EXIT inner;\nEND inner;\n"
                    f"{guard}",
                ),
                "loop_exits_itself": _labelled_block(
                    f"LOOP\n  EXIT;\nEND LOOP;\n{guard}",
                ),
                "labelled_loop_exits_itself": _labelled_block(
                    "<<scan>>\nLOOP\n  EXIT scan;\nEND LOOP;\n"
                    f"{guard}",
                ),
            }
            for label, block in cases.items():
                with self.subTest(path=path_label, label=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(block, raw_plpgsql=True),
                            _bindings_doc([_binding(oid=2077)]),
                        ),
                        "PROVEN",
                        mechanism=mechanism,
                        proof_class=proof_class,
                    )

    def test_label_identity_is_clipped_to_namedatalen(self) -> None:
        """Labels agreeing within 63 BYTES are one label to PL/pgSQL.

        Carried over from the predecessor's labelled-EXIT truncation corpus and
        confirmed there on PostgreSQL 17: the routine is created with a
        truncation notice and the assertion never executes. Comparing the raw
        source spelling sees two names where the database sees one, records no
        jump, and calls the guard reachable.
        """
        self.assertGreater(
            len((LONG_ASCII + "X").encode("utf-8")), NAMEDATALEN_LIMIT
        )
        self.assertGreater(
            len((LONG_MULTIBYTE + "a").encode("utf-8")), NAMEDATALEN_LIMIT
        )
        self.assertGreater(
            len((KELVIN + "a" * 60 + "X").encode("utf-8")), NAMEDATALEN_LIMIT
        )

        declare = "v_seen boolean := false;"
        cases = {
            "ascii_labels_differing_only_after_byte_63": _labelled_block(
                f"EXIT {LONG_ASCII}Y;\n{RAISING_GUARD_BODY}",
                label=f"{LONG_ASCII}X",
                end_label="",
            ),
            "truncation_collision_with_a_declare_section": _labelled_block(
                f"EXIT {LONG_ASCII}Y;\n{RAISING_GUARD_BODY}",
                label=f"{LONG_ASCII}X",
                end_label="",
                declare=declare,
            ),
            "multibyte_labels_differing_after_the_byte_limit": (
                _labelled_block(
                    f"EXIT {LONG_MULTIBYTE}b;\n{RAISING_GUARD_BODY}",
                    label=f"{LONG_MULTIBYTE}a",
                    end_label="",
                )
            ),
            "quoted_labels_colliding_after_byte_63": _labelled_block(
                f'EXIT "{LONG_ASCII}Y";\n{RAISING_GUARD_BODY}',
                label=f'"{LONG_ASCII}X"',
                end_label="",
            ),
            "quoted_label_unquoted_over_long_exit": _labelled_block(
                f"EXIT {LONG_ASCII}Y;\n{RAISING_GUARD_BODY}",
                label=f'"{LONG_ASCII}X"',
                end_label="",
            ),
            "conditional_exit_with_a_truncation_collision": _labelled_block(
                f"EXIT {LONG_ASCII}Y WHEN p_org IS NULL;\n"
                f"{RAISING_GUARD_BODY}",
                label=f"{LONG_ASCII}X",
                end_label="",
            ),
            "boolean_deny_guard_behind_a_colliding_exit": _labelled_block(
                f"EXIT {LONG_ASCII}Y;\n{BOOLEAN_DENY_GUARD_BODY}",
                label=f"{LONG_ASCII}X",
                end_label="",
            ),
            "kelvin_fold_moves_the_namedatalen_clip": _labelled_block(
                f"EXIT {KELVIN}{'a' * 60}Y;\n{RAISING_GUARD_BODY}",
                label=f"{KELVIN}{'a' * 60}X",
                end_label="",
            ),
        }
        for label, block in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(block, raw_plpgsql=True),
                        _bindings_doc([_binding(oid=2080)]),
                    ),
                    "UNKNOWN",
                )

    def test_label_identity_follows_postgresql_folding(self) -> None:
        """One identifier, spelled several legal ways, is one label.

        An unquoted label folds, in ASCII only, and a quoted one keeps
        its case. Both spellings name the same block in either direction, so
        the jump is real and the guard behind it is not an authorization
        boundary.
        """
        declare = "v_seen boolean := false;"
        cases = {
            "unquoted_label_quoted_exit": _labelled_block(
                f'EXIT "auth_block";\n{RAISING_GUARD_BODY}',
            ),
            "quoted_label_unquoted_exit": _labelled_block(
                f"EXIT auth_block;\n{RAISING_GUARD_BODY}",
                label='"auth_block"',
                end_label='"auth_block"',
            ),
            "unquoted_case_differs_on_both_sides": _labelled_block(
                f"EXIT AUTH_BLOCK;\n{RAISING_GUARD_BODY}",
                label="Auth_Block",
                end_label="Auth_Block",
            ),
            "mixed_spelling_across_a_declare_section": _labelled_block(
                f'EXIT "auth_block";\n{RAISING_GUARD_BODY}',
                declare=declare,
            ),
            "mixed_spelling_before_a_boolean_guard": _labelled_block(
                f'EXIT "auth_block";\n{BOOLEAN_DENY_GUARD_BODY}',
            ),
        }
        for label, block in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(block, raw_plpgsql=True),
                        _bindings_doc([_binding(oid=2081)]),
                    ),
                    "UNKNOWN",
                )

    def test_label_identity_reads_astral_plane_identifiers(self) -> None:
        """An identifier above U+FFFF is still one identifier.

        The readable ASCII prefix must not be parsed out as the label: a
        reader that stops at the first byte it cannot classify sees ``auth``
        on one side and ``auth`` on the other for different reasons, or fails
        to record the label at all and never reaches its fail-closed path.
        """
        cases = {
            "astral_label_and_matching_exit": (f"auth{ASTRAL}", ""),
            "astral_suffix_after_an_ascii_prefix": (
                "auth\U0001F600",
                "",
            ),
            "astral_first_character": (f"{ASTRAL}auth", ""),
        }
        declare = "v_seen boolean := false;"
        for label, (name, _) in cases.items():
            for variant, section in (("plain", ""), ("declare", declare)):
                with self.subTest(label=label, variant=variant):
                    block = _labelled_block(
                        f"EXIT {name};\n{RAISING_GUARD_BODY}",
                        label=name,
                        end_label=name,
                        declare=section,
                    )
                    self._assert_status(
                        _run_producer(
                            _routine_source(block, raw_plpgsql=True),
                            _bindings_doc([_binding(oid=2082)]),
                        ),
                        "UNKNOWN",
                    )

    def test_distinct_labels_leave_a_later_guard_provable(self) -> None:
        """Canonical identity must discriminate, not reject every EXIT.

        The counterweight to the three tests above. Each block here is a
        routine PostgreSQL will actually create: the inner block carries its
        own label and the EXIT names that inner label, so the jump never
        leaves the outer block and the guard after it still runs.
        """
        for path_label, (
            guard,
            mechanism,
            proof_class,
        ) in GUARD_PATHS.items():
            cases = {
                # Quoted keeps its case, so these are two different labels and
                # the EXIT resolves to the inner one. A whole-Unicode fold
                # merges them and loses the guard.
                "quoted_outer_case_differs_from_inner": _labelled_block(
                    "<<auth_block>>\nBEGIN\n  EXIT auth_block;\n"
                    f"END auth_block;\n{guard}",
                    label='"Auth_Block"',
                    end_label='"Auth_Block"',
                ),
                # Distinct inside the first 63 bytes: two real labels.
                "distinct_within_the_byte_limit": _labelled_block(
                    "<<beta_block>>\nBEGIN\n  EXIT beta_block;\n"
                    f"END beta_block;\n{guard}",
                    label="alpha_block",
                    end_label="alpha_block",
                ),
                # Over-length, identical, and the inner block exits itself.
                # An over-length outer label must not swallow the block: the
                # inner label is distinct well inside the limit and the EXIT
                # names it, so the jump never leaves the outer block.
                "inner_block_under_an_over_long_outer_label": (
                    _labelled_block(
                        "<<inner_scan>>\nBEGIN\n  EXIT inner_scan;\n"
                        f"END inner_scan;\n{guard}",
                        label=f"{LONG_ASCII}Y",
                        end_label="",
                    )
                ),
                # The guard runs before the colliding jump is issued.
                "guard_precedes_a_colliding_exit": _labelled_block(
                    f"{guard}\nEXIT {LONG_ASCII}Y;",
                    label=f"{LONG_ASCII}X",
                    end_label="",
                ),
            }
            for label, block in cases.items():
                with self.subTest(path=path_label, label=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(block, raw_plpgsql=True),
                            _bindings_doc([_binding(oid=2083)]),
                        ),
                        "PROVEN",
                        mechanism=mechanism,
                        proof_class=proof_class,
                    )

    def test_catching_exception_handlers_block_proof(self) -> None:
        for label, handler in CATCHING_HANDLERS.items():
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
        for label, handler in NONCAPTURING_HANDLERS.items():
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

    def test_catching_exception_handlers_block_boolean_deny_proof(
        self,
    ) -> None:
        """Swallow analysis must cover the boolean-deny proof path too.

        The denial here is an ordinary ``RAISE EXCEPTION`` inside the negated
        predicate, so an enclosing handler that can catch P0001/P0000 lets
        execution continue past the authorization boundary exactly as it does
        for the raising assertions.
        """
        for label, handler in CATCHING_HANDLERS.items():
            with self.subTest(label=label):
                block = (
                    "BEGIN\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    RAISE EXCEPTION 'DENIED';\n"
                    "  END IF;\n"
                    "EXCEPTION\n"
                    f"  WHEN {handler} THEN NULL;\n"
                    "END;"
                )
                self._assert_status(
                    _run_producer(
                        _routine_source(block, raw_plpgsql=True),
                        _bindings_doc([_binding(oid=2037)]),
                    ),
                    "UNKNOWN",
                )

    def test_noncapturing_exception_handler_allows_boolean_deny_proof(
        self,
    ) -> None:
        for label, handler in NONCAPTURING_HANDLERS.items():
            with self.subTest(label=label):
                block = (
                    "BEGIN\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    RAISE EXCEPTION 'DENIED';\n"
                    "  END IF;\n"
                    "EXCEPTION\n"
                    f"  WHEN {handler} THEN NULL;\n"
                    "END;"
                )
                self._assert_status(
                    _run_producer(
                        _routine_source(block, raw_plpgsql=True),
                        _bindings_doc([_binding(oid=2038)]),
                    ),
                    "PROVEN",
                    mechanism="public.wardah_is_org_member",
                    proof_class="negated-boolean-deny-v1",
                )

    def test_inner_handler_around_denial_blocks_boolean_deny_proof(
        self,
    ) -> None:
        """The denial itself must abort, not just the block enclosing the IF.

        Here the predicate is outer-level and correctly shaped, but the
        ``RAISE EXCEPTION`` sits in its own block with a handler, so execution
        continues past the authorization boundary. An implementation that only
        inspects handlers *enclosing* the IF cannot see this.

        No interpreter is required: any denial wrapped in its own exception
        block is conservatively ``UNKNOWN``, capturing or not.
        """
        handlers = dict(CATCHING_HANDLERS)
        handlers.update(NONCAPTURING_HANDLERS)
        for label, handler in handlers.items():
            with self.subTest(label=label):
                body = (
                    "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "  BEGIN\n"
                    "    RAISE EXCEPTION 'DENIED';\n"
                    "  EXCEPTION\n"
                    f"    WHEN {handler} THEN NULL;\n"
                    "  END;\n"
                    "END IF;"
                )
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2047)]),
                    ),
                    "UNKNOWN",
                )

    def test_later_when_clause_still_catches_the_denial(self) -> None:
        """An EXCEPTION section is a list; the first WHEN is not the section.

        P0001 does not match ``unique_violation``, so PostgreSQL moves to the
        next WHEN clause. A parser that inspects only the first one sees an
        unrelated handler and proves a guard whose denial is swallowed.
        """
        blocking = {
            "second_clause_named": ("unique_violation", "raise_exception"),
            "second_clause_others": ("unique_violation", "OTHERS"),
            "second_clause_sqlstate": (
                "unique_violation",
                "SQLSTATE 'P0001'",
            ),
            "third_clause_class_sqlstate": (
                "unique_violation",
                "foreign_key_violation",
                "SQLSTATE 'P0000'",
            ),
            "third_clause_compound": (
                "unique_violation",
                "SQLSTATE '23503'",
                "check_violation OR plpgsql_error",
            ),
        }
        for path_label, (guard, _, _) in GUARD_PATHS.items():
            for label, handlers in blocking.items():
                with self.subTest(path=path_label, handlers=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(
                                _handler_block(guard, *handlers),
                                raw_plpgsql=True,
                            ),
                            _bindings_doc([_binding(oid=2066)]),
                        ),
                        "UNKNOWN",
                    )

        allowing = {
            "two_unrelated_clauses": (
                "unique_violation",
                "foreign_key_violation",
            ),
            "three_unrelated_clauses": (
                "unique_violation",
                "SQLSTATE '23503'",
                "check_violation OR division_by_zero",
            ),
        }
        for path_label, (
            guard,
            mechanism,
            proof_class,
        ) in GUARD_PATHS.items():
            for label, handlers in allowing.items():
                with self.subTest(path=path_label, handlers=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(
                                _handler_block(guard, *handlers),
                                raw_plpgsql=True,
                            ),
                            _bindings_doc([_binding(oid=2067)]),
                        ),
                        "PROVEN",
                        mechanism=mechanism,
                        proof_class=proof_class,
                    )

    def test_compound_exception_handler_conditions(self) -> None:
        """A ``WHEN a OR b`` handler catches the union of its conditions."""
        blocking = {
            "unique_violation_or_raise_exception": (
                "unique_violation OR raise_exception"
            ),
            "sqlstate_23505_or_others": "SQLSTATE '23505' OR OTHERS",
            "foreign_key_or_plpgsql_error": (
                "foreign_key_violation OR plpgsql_error"
            ),
            "unique_violation_or_sqlstate_p0001": (
                "unique_violation OR SQLSTATE 'P0001'"
            ),
        }
        allowing = {
            "unique_violation_or_foreign_key": (
                "unique_violation OR foreign_key_violation"
            ),
        }

        for guard_label, (
            guard,
            mechanism,
            proof_class,
        ) in GUARD_PATHS.items():
            for label, handler in blocking.items():
                with self.subTest(guard=guard_label, handler=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(
                                _handler_block(guard, handler),
                                raw_plpgsql=True
                            ),
                            _bindings_doc([_binding(oid=2039)]),
                        ),
                        "UNKNOWN",
                    )
            for label, handler in allowing.items():
                with self.subTest(guard=guard_label, handler=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(
                                _handler_block(guard, handler),
                                raw_plpgsql=True
                            ),
                            _bindings_doc([_binding(oid=2040)]),
                        ),
                        "PROVEN",
                        mechanism=mechanism,
                        proof_class=proof_class,
                    )

    def test_sqlstate_handler_literal_forms_are_all_decoded(self) -> None:
        """A catching SQLSTATE is a value, not a fixed piece of text.

        Every one of these handlers catches P0001 or its class, so every one
        swallows the denial. The accepted predecessor carries the same corpus
        after these forms produced real false-greens.
        """
        handlers = {
            "escape_string": "SQLSTATE E'P0001'",
            "dollar_quoted": "SQLSTATE $x$P0001$x$",
            "continued_literal": "SQLSTATE 'P00'\n    '01'",
            "comment_between_keyword_and_literal": (
                "SQLSTATE /* documented reason */ 'P0001'"
            ),
            "class_code_dollar_quoted": "SQLSTATE $x$P0000$x$",
            "second_or_term": "SQLSTATE 'P0002' OR SQLSTATE 'P0001'",
            "third_or_term": (
                "SQLSTATE 'P0002' OR SQLSTATE 'P0003' OR SQLSTATE 'P0000'"
            ),
            "after_a_named_condition": (
                "unique_violation OR SQLSTATE 'P0002' OR SQLSTATE 'P0001'"
            ),
        }
        for path_label, (guard, _, _) in GUARD_PATHS.items():
            for label, handler in handlers.items():
                with self.subTest(path=path_label, handler=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(
                                _handler_block(guard, handler),
                                raw_plpgsql=True,
                            ),
                            _bindings_doc([_binding(oid=2055)]),
                        ),
                        "UNKNOWN",
                    )

    def test_undecodable_sqlstate_handler_fails_closed(self) -> None:
        """An unreadable SQLSTATE is not an unrelated SQLSTATE.

        ``U&'...'`` and escape sequences need decoding the producer does not
        do. The unrelated-looking values below are the point: fail closed on
        the form, never on the value it appears to carry.
        """
        handlers = {
            "unicode_string_p0001": "SQLSTATE U&'P0001'",
            "unicode_string_unrelated": "SQLSTATE U&'P0002'",
            "unicode_escape_spells_p0001": (
                "SQLSTATE U&'\\0050\\0030\\0030\\0030\\0031'"
            ),
            "escape_sequence": "SQLSTATE E'P000\\x31'",
            "unicode_in_or_list": (
                "unique_violation OR SQLSTATE U&'P0002'"
            ),
        }
        for path_label, (guard, _, _) in GUARD_PATHS.items():
            for label, handler in handlers.items():
                with self.subTest(path=path_label, handler=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(
                                _handler_block(guard, handler),
                                raw_plpgsql=True,
                            ),
                            _bindings_doc([_binding(oid=2056)]),
                        ),
                        "UNKNOWN",
                    )

    def test_unrelated_sqlstate_literal_forms_still_prove(self) -> None:
        """Decoding must stay exact: an unrelated code is not a catch."""
        handlers = {
            "dollar_quoted": "SQLSTATE $x$23505$x$",
            "escape_string": "SQLSTATE E'23505'",
            "comment_between_keyword_and_literal": (
                "SQLSTATE /* documented reason */ '23505'"
            ),
            "or_list": "SQLSTATE '23505' OR SQLSTATE '23503'",
        }
        for path_label, (
            guard,
            mechanism,
            proof_class,
        ) in GUARD_PATHS.items():
            for label, handler in handlers.items():
                with self.subTest(path=path_label, handler=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(
                                _handler_block(guard, handler),
                                raw_plpgsql=True,
                            ),
                            _bindings_doc([_binding(oid=2057)]),
                        ),
                        "PROVEN",
                        mechanism=mechanism,
                        proof_class=proof_class,
                    )

    def test_nested_boolean_deny_is_unknown(self) -> None:
        """Nesting parity: the boolean path has its own matcher too."""
        cases = {
            "if_false": (
                "IF false THEN\n"
                "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "    RAISE EXCEPTION 'DENIED';\n"
                "  END IF;\n"
                "END IF;"
            ),
            "if_true": (
                "IF true THEN\n"
                "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "    RAISE EXCEPTION 'DENIED';\n"
                "  END IF;\n"
                "END IF;"
            ),
            "never_entered_loop": (
                "WHILE false LOOP\n"
                "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "    RAISE EXCEPTION 'DENIED';\n"
                "  END IF;\n"
                "END LOOP;"
            ),
            "case_branch": (
                "CASE WHEN false THEN\n"
                "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "    RAISE EXCEPTION 'DENIED';\n"
                "  END IF;\n"
                "ELSE NULL;\n"
                "END CASE;"
            ),
            "nested_begin": (
                "BEGIN\n"
                "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "    RAISE EXCEPTION 'DENIED';\n"
                "  END IF;\n"
                "END;"
            ),
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2058)]),
                    ),
                    "UNKNOWN",
                )

    def test_unreachable_boolean_deny_after_terminator_is_unknown(
        self,
    ) -> None:
        """Reachability parity for the boolean path."""
        indented = _indent(BOOLEAN_DENY_GUARD_BODY)
        cases = {
            "return": f"BEGIN\n  RETURN;\n{indented}\nEND;",
            "raise": (
                f"BEGIN\n  RAISE EXCEPTION 'STOP';\n{indented}\nEND;"
            ),
            "raise_using_errcode": (
                "BEGIN\n"
                "  RAISE EXCEPTION 'STOP' USING ERRCODE = '22023';\n"
                f"{indented}\nEND;"
            ),
            "labelled_exit": (
                "<<outer>>\n"
                f"BEGIN\n  EXIT outer;\n{indented}\nEND outer;"
            ),
        }
        for label, block in cases.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(block, raw_plpgsql=True),
                        _bindings_doc([_binding(oid=2059)]),
                    ),
                    "UNKNOWN",
                )

    def test_conditional_raise_before_guard_is_not_a_terminator(self) -> None:
        """A RAISE inside a conditional must not cost a real guard its proof.

        The counterweight to the reachability rules above: only an
        *outer-level* abort makes what follows dead code.
        """
        for path_label, (
            guard,
            mechanism,
            proof_class,
        ) in GUARD_PATHS.items():
            with self.subTest(path=path_label):
                body = (
                    "IF p_org IS NULL THEN\n"
                    "  RAISE EXCEPTION 'ORG_REQUIRED';\n"
                    "END IF;\n"
                    f"{guard}"
                )
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2060)]),
                    ),
                    "PROVEN",
                    mechanism=mechanism,
                    proof_class=proof_class,
                )

    def test_boolean_denial_raise_form_is_frozen(self) -> None:
        """The denial's SQLSTATE is part of the proof, not an assumption.

        ``RAISE EXCEPTION 'DENIED'`` is P0001 only in its bare form. With
        ``USING ERRCODE`` the denial can be re-coded into exactly what an
        enclosing handler catches, and the contract's own non-capturing
        controls then become capturing.

        The contract is deliberately blunt so no producer must parse the
        option list: only a bare ``RAISE EXCEPTION '<message>';`` proves a
        denial. Every other raise form is UNKNOWN, with or without a handler.
        """
        denials = {
            "using_errcode_unique_violation": (
                "RAISE EXCEPTION 'DENIED' USING ERRCODE = '23505';"
            ),
            "using_errcode_condition_name": (
                "RAISE EXCEPTION 'DENIED' "
                "USING ERRCODE = 'unique_violation';"
            ),
            "using_errcode_p0001": (
                "RAISE EXCEPTION 'DENIED' USING ERRCODE = 'P0001';"
            ),
            "using_message_and_errcode": (
                "RAISE EXCEPTION USING MESSAGE = 'DENIED', "
                "ERRCODE = '23505';"
            ),
            "using_hint_only": (
                "RAISE EXCEPTION 'DENIED' USING HINT = 'join the org';"
            ),
            "condition_name_raise": "RAISE unique_violation;",
            "sqlstate_raise": "RAISE SQLSTATE '23505';",
        }
        for label, denial in denials.items():
            body = (
                "IF NOT public.wardah_is_org_member(p_org) THEN\n"
                f"  {denial}\n"
                "END IF;"
            )
            with self.subTest(label=label, handler="none"):
                self._assert_status(
                    _run_producer(
                        _routine_source(body),
                        _bindings_doc([_binding(oid=2061)]),
                    ),
                    "UNKNOWN",
                )
            with self.subTest(label=label, handler="unique_violation"):
                self._assert_status(
                    _run_producer(
                        _routine_source(
                            _handler_block(body, "unique_violation"),
                            raw_plpgsql=True,
                        ),
                        _bindings_doc([_binding(oid=2062)]),
                    ),
                    "UNKNOWN",
                )

    def test_effect_before_authorization_boundary_is_not_proven(self) -> None:
        """A reachable guard is not a boundary if an effect already ran.

        No PL/pgSQL interpreter is required: a conservative UNKNOWN is the
        contract whenever an effectful outer-level statement precedes the
        recognized guard.
        """
        prefixes = {
            "update": (
                "UPDATE public.bins SET reserved_qty = 0 "
                "WHERE org_id = p_org;"
            ),
            "insert": (
                "INSERT INTO public.bins (org_id) VALUES (p_org);"
            ),
            "delete": "DELETE FROM public.bins WHERE org_id = p_org;",
            "dynamic_execute": (
                "EXECUTE 'UPDATE public.bins SET reserved_qty = 0';"
            ),
            "call": "CALL public.unrelated_writer(p_org);",
            "perform_unrelated_function": (
                "PERFORM public.unrelated_writer(p_org);"
            ),
            "perform_unknown_function": (
                "PERFORM public.unknown_function(p_org);"
            ),
            "perform_unqualified_function": (
                "PERFORM unrelated_writer(p_org);"
            ),
            "select_into_from_function": (
                "SELECT public.charge_customer(p_org) INTO STRICT p_org;"
            ),
        }
        guards = {
            "raising_assertion": RAISING_GUARD_BODY,
            "negated_boolean_deny": BOOLEAN_DENY_GUARD_BODY,
        }
        for guard_label, guard in guards.items():
            for label, prefix in prefixes.items():
                with self.subTest(guard=guard_label, prefix=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(f"{prefix}\n{guard}"),
                            _bindings_doc([_binding(oid=2041)]),
                        ),
                        "UNKNOWN",
                    )

    def test_effectful_compound_statement_before_guard_is_unknown(
        self,
    ) -> None:
        """A compound statement is not harmless because it is compound.

        The mirror of ``test_conditional_raise_before_guard_is_not_a_...``:
        that control allows a conditional RAISE, so an implementation may
        treat every outer-level IF/LOOP/CASE/BEGIN before the guard as
        harmless. Each of these performs the privileged write first.
        """
        prefixes = {
            "if_true": (
                "IF true THEN\n"
                "  UPDATE public.bins SET reserved_qty = 0 "
                "WHERE org_id = p_org;\n"
                "END IF;"
            ),
            "if_conditional": (
                "IF p_org IS NOT NULL THEN\n"
                "  UPDATE public.bins SET reserved_qty = 0 "
                "WHERE org_id = p_org;\n"
                "END IF;"
            ),
            "else_branch": (
                "IF p_org IS NULL THEN\n"
                "  NULL;\n"
                "ELSE\n"
                "  DELETE FROM public.bins WHERE org_id = p_org;\n"
                "END IF;"
            ),
            "loop": (
                "FOR i IN 1..1 LOOP\n"
                "  INSERT INTO public.bins (org_id) VALUES (p_org);\n"
                "END LOOP;"
            ),
            "case_branch": (
                "CASE WHEN true THEN\n"
                "  UPDATE public.bins SET reserved_qty = 0 "
                "WHERE org_id = p_org;\n"
                "ELSE NULL;\n"
                "END CASE;"
            ),
            "nested_begin": (
                "BEGIN\n"
                "  UPDATE public.bins SET reserved_qty = 0 "
                "WHERE org_id = p_org;\n"
                "END;"
            ),
            "nested_begin_with_handler": (
                "BEGIN\n"
                "  PERFORM public.unrelated_writer(p_org);\n"
                "EXCEPTION\n"
                "  WHEN unique_violation THEN NULL;\n"
                "END;"
            ),
        }
        for path_label, (guard, _, _) in GUARD_PATHS.items():
            for label, prefix in prefixes.items():
                with self.subTest(path=path_label, prefix=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(f"{prefix}\n{guard}"),
                            _bindings_doc([_binding(oid=2068)]),
                        ),
                        "UNKNOWN",
                    )

    def test_declaration_initializer_before_guard_is_classified(self) -> None:
        """A DECLARE initializer runs before the block's first statement.

        It is therefore on the wrong side of the authorization boundary even
        though no statement precedes the guard. A call in an initializer has
        unknown effects; a parameter or constant does not.
        """
        rejected = {
            "unrelated_writer": (
                "v_x uuid := public.unrelated_writer(p_org);"
            ),
            "unknown_function": (
                "v_x uuid := public.unknown_function(p_org);"
            ),
            "unqualified_call": "v_x uuid := unrelated_writer(p_org);",
            "default_keyword_call": (
                "v_x uuid DEFAULT public.unrelated_writer(p_org);"
            ),
            "second_declaration_calls": (
                "v_a uuid := p_org;\n"
                "v_b uuid := public.unrelated_writer(p_org);"
            ),
        }
        for path_label, (guard, _, _) in GUARD_PATHS.items():
            for label, declarations in rejected.items():
                with self.subTest(path=path_label, declaration=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(
                                _declare_block(declarations, guard),
                                raw_plpgsql=True,
                            ),
                            _bindings_doc([_binding(oid=2069)]),
                        ),
                        "UNKNOWN",
                    )

        accepted = {
            "uninitialised": "v_x uuid;",
            "parameter_copy": "v_x uuid := p_org;",
            "constant": "v_n integer := 1;",
        }
        for path_label, (
            guard,
            mechanism,
            proof_class,
        ) in GUARD_PATHS.items():
            for label, declarations in accepted.items():
                with self.subTest(path=path_label, declaration=label):
                    self._assert_status(
                        _run_producer(
                            _routine_source(
                                _declare_block(declarations, guard),
                                raw_plpgsql=True,
                            ),
                            _bindings_doc([_binding(oid=2070)]),
                        ),
                        "PROVEN",
                        mechanism=mechanism,
                        proof_class=proof_class,
                    )

    def test_effectless_statements_before_guard_still_prove(self) -> None:
        """Ordering must discriminate on effect, not on mere position.

        The contract is not a keyword denylist: any executable outer-level
        statement that cannot be *proven* effectless blocks proof. Only
        constant-expression and no-op statements qualify here — notably not
        ``PERFORM <any function>``, which is covered as UNKNOWN above.
        """
        prefixes = {
            "perform_constant": "PERFORM 1;",
            "null_statement": "NULL;",
            "line_comment": "-- prepare",
            "block_comment": "/* prepare */",
        }
        for label, prefix in prefixes.items():
            with self.subTest(label=label):
                self._assert_status(
                    _run_producer(
                        _routine_source(f"{prefix}\n{RAISING_GUARD_BODY}"),
                        _bindings_doc([_binding(oid=2042)]),
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

    def test_a_routine_cannot_borrow_the_next_routines_body(self) -> None:
        """No readable body of its own means no guard — never a borrowed one.

        Carried over from the predecessor's
        ``test_a_definition_cannot_borrow_the_next_functions_body``. An
        extractor that scans forward for the first dollar-quoted body hands
        the guarded routine's proof to the unreadable one in front of it.
        Each case asserts both halves: the first binding must not borrow, and
        the second must still earn its own proof.
        """
        guarded = _routine_source(RAISING_GUARD_BODY, name="guarded_probe")
        unreadable = {
            "internal_language_body": (
                "CREATE OR REPLACE FUNCTION public.opaque_probe(p_org uuid)\n"
                "RETURNS void\nLANGUAGE internal\nSECURITY DEFINER\n"
                "AS 'boolin';\n"
            ),
            "sql_standard_atomic_body": (
                "CREATE OR REPLACE FUNCTION public.opaque_probe(p_org uuid)\n"
                "RETURNS void\nLANGUAGE sql\nSECURITY DEFINER\n"
                "BEGIN ATOMIC\n"
                "  SELECT 1;\n"
                "END;\n"
            ),
            "c_language_body": (
                "CREATE OR REPLACE FUNCTION public.opaque_probe(p_org uuid)\n"
                "RETURNS void\nLANGUAGE c\nSECURITY DEFINER\n"
                "AS 'MODULE_PATHNAME', 'opaque_probe';\n"
            ),
        }
        for label, head in unreadable.items():
            with self.subTest(label=label):
                payload = self._payload(
                    _run_producer(
                        head + "\n" + guarded,
                        _bindings_doc(
                            [
                                _binding(
                                    oid=2078,
                                    name="opaque_probe",
                                    statement_index=1,
                                ),
                                _binding(
                                    oid=2079,
                                    name="guarded_probe",
                                    statement_index=2,
                                ),
                            ]
                        ),
                    )
                )
                self.assertEqual(len(payload["guard_records"]), 2)
                by_oid = {
                    record["catalog_oid"]: record
                    for record in payload["guard_records"]
                }
                self.assertEqual(set(by_oid), {2078, 2079})
                self.assertEqual(by_oid[2078]["guard_status"], "UNKNOWN")
                self.assertIsNone(by_oid[2078]["guard_mechanism"])
                self.assertIsNone(by_oid[2078]["evidence_location"])
                self.assertIsNone(by_oid[2078]["proof_class"])
                self.assertEqual(by_oid[2079]["guard_status"], "PROVEN")
                self.assertEqual(
                    by_oid[2079]["guard_mechanism"],
                    "public.wardah_assert_org_member",
                )

    def test_statement_binding_identity_mismatch_fails_hard(self) -> None:
        source = _routine_source(
            "PERFORM public.wardah_assert_org_member(p_org);",
            name="actual_probe",
        )
        binding = _binding(oid=2025, name="other_probe")
        self._assert_evidence_error(
            _run_producer(source, _bindings_doc([binding]))
        )

    def test_binding_signature_and_kind_mismatch_fail_hard(self) -> None:
        """Binding integrity is the whole identity, not the routine name.

        Matching a binding to a source statement on ``statement_index`` plus
        bare name lets the producer analyse one overload's body and attribute
        the proof to another overload's OID — a direct bypass of the Slice 2
        exact-identity boundary.
        """
        text_overload = _routine_source(RAISING_GUARD_BODY, args="p_org text")
        procedure_source = _routine_source(
            RAISING_GUARD_BODY, name="review_proc", kind="PROCEDURE"
        )
        function_source = _routine_source(
            RAISING_GUARD_BODY, name="review_proc"
        )
        other_schema_source = text_overload.replace(
            "public.review_probe", "analytics.review_probe"
        )

        signature_mismatch = _binding(oid=2048)

        schema_mismatch = _binding(oid=2049)
        schema_mismatch["source_arguments"] = "p_org text"
        schema_mismatch["catalog_identity"] = "public.review_probe(text)"

        procedure_as_function = _binding(oid=2050, name="review_proc")

        function_as_procedure = _binding(
            oid=2051, name="review_proc", kind="PROCEDURE"
        )

        cases = {
            "argument_signature_mismatch": (
                text_overload,
                signature_mismatch,
            ),
            "schema_mismatch": (
                other_schema_source,
                schema_mismatch,
            ),
            "procedure_source_bound_as_function": (
                procedure_source,
                procedure_as_function,
            ),
            "function_source_bound_as_procedure": (
                function_source,
                function_as_procedure,
            ),
        }
        for label, (source, binding) in cases.items():
            with self.subTest(label=label):
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

        extra_helper = copy.deepcopy(baseline)
        extra_helper["helpers"].append(
            {
                "identity": "public.always_allow(uuid)",
                "guard_kind": "RAISING_ASSERTION",
            }
        )
        extra_helper["helper_count"] = len(extra_helper["helpers"])
        cases["oracle_superset"] = extra_helper

        extra_contract_key = copy.deepcopy(baseline)
        extra_contract_key["recognized_helpers"] = [
            "public.always_allow(uuid)"
        ]
        cases["extra_top_level_key"] = extra_contract_key

        renamed_helper = copy.deepcopy(baseline)
        renamed_helper["helpers"][0]["identity"] = "public.always_allow(uuid)"
        cases["renamed_helper"] = renamed_helper

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
