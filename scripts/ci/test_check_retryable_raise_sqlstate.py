#!/usr/bin/env python3
"""Mutation self-test for check_retryable_raise_sqlstate.py.

Run before trusting the gate. MUST_REJECT bodies are the forms that would make
PostgREST retry a permanent rejection (or hide a real engine conflict); the
frozen M196 function is included end-to-end. MUST_ACCEPT bodies prove that
comments, message text, P0001 and the proposed M197 replacement stay green.
"""
from __future__ import annotations

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from check_retryable_raise_sqlstate import scan_source  # noqa: E402

PACKAGE = pathlib.Path("docs/db/material-issue-release/migrations")


def function_text(path: pathlib.Path, opener: str) -> str:
    source = path.read_text()
    start = source.index(opener)
    return source[start:source.index("END $$;", start) + len("END $$;")]


MUST_REJECT = {
    "using_errcode": "BEGIN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='X'; END",
    "using_errcode_spaced_deadlock": "BEGIN RAISE EXCEPTION USING MESSAGE='X', ERRCODE = '40P01'; END",
    "using_errcode_assign_name": "begin raise exception using errcode := 'serialization_failure'; end",
    "raise_condition": "BEGIN RAISE serialization_failure; END",
    "raise_level_condition": "BEGIN RAISE EXCEPTION deadlock_detected USING MESSAGE='x'; END",
    "raise_sqlstate": "BEGIN RAISE SQLSTATE '40001'; END",
    "raise_level_sqlstate": "BEGIN RAISE EXCEPTION SQLSTATE '40P01'; END",
    "handler_by_name": "BEGIN PERFORM 1; EXCEPTION WHEN serialization_failure THEN RAISE EXCEPTION 'busy'; END",
    "handler_or_sqlstate": "BEGIN PERFORM 1; EXCEPTION WHEN unique_violation OR SQLSTATE '40001' THEN NULL; END",
    "non_literal_errcode": "DECLARE c text:='40001'; BEGIN RAISE EXCEPTION USING ERRCODE=c; END",
    "concatenated_errcode": "BEGIN RAISE EXCEPTION USING ERRCODE='40' || '001',MESSAGE='x'; END",
    "literal_prefixed_expression": "BEGIN RAISE EXCEPTION USING ERRCODE = '40' || suffix; END",
    "after_comment_and_literal": "BEGIN -- note\n PERFORM 'x--y'; /* a /* b */ */ RAISE SQLSTATE '40001'; END",
}

MUST_ACCEPT = {
    "line_comment": "BEGIN -- RAISE EXCEPTION USING ERRCODE='40001';\n RETURN; END",
    "nested_block_comment": "BEGIN /* RAISE serialization_failure; /* WHEN deadlock_detected THEN */ */ RETURN; END",
    "message_text": "BEGIN RAISE EXCEPTION 'retry hint: serialization_failure 40001'; END",
    "p0001": "BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ISSUE_SETUP_STALE_VERSION'; END",
    # Canonical M171/M186 style: spaced and multi-line literal ERRCODE.
    "spaced_literal_errcode": "BEGIN RAISE EXCEPTION 'X'\n    USING ERRCODE = '0A000',\n          HINT = 'h'; END",
    "assign_literal_errcode": "BEGIN RAISE EXCEPTION 'X' USING ERRCODE :=\n '22004'; END",
    "reraise": "BEGIN PERFORM 1; EXCEPTION WHEN unique_violation THEN RAISE; END",
    "escaped_literal": "BEGIN RAISE EXCEPTION E'it\\'s 40001'; END",
}


class RetryableSqlstateGate(unittest.TestCase):
    def test_must_reject(self):
        for name, body in MUST_REJECT.items():
            with self.subTest(name=name):
                self.assertTrue(scan_source(body), f"{name} was not rejected")

    def test_must_accept(self):
        for name, body in MUST_ACCEPT.items():
            with self.subTest(name=name):
                self.assertEqual(scan_source(body), [], name)

    def test_frozen_m196_function_is_rejected_three_times(self):
        body = function_text(PACKAGE / "196_material_issue_maintenance.sql",
                             "CREATE FUNCTION public.rpc_manage_material_issue_setup(")
        self.assertEqual(len(scan_source(body)), 3)

    def test_proposed_m197_replacement_is_accepted(self):
        body = function_text(PACKAGE / "197_material_issue_stale_version.sql",
                             "CREATE OR REPLACE FUNCTION public.rpc_manage_material_issue_setup(")
        self.assertEqual(scan_source(body), [])

    def test_unterminated_literal_fails_closed(self):
        self.assertTrue(scan_source("BEGIN RAISE EXCEPTION 'open; END"))


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=1).result
    if not result.wasSuccessful():
        sys.exit(1)
    print("RETRYABLE_SQLSTATE_GATE_SELFTEST_PASS")
