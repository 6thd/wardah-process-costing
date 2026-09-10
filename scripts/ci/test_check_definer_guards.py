#!/usr/bin/env python3
"""Regression tests for the SECURITY DEFINER guard scanner.

These run against check_file() — the function CI actually uses per migration —
rather than against the masker alone, so they prove the verdict, not an
intermediate string.

Final-review remediation (PR #241, Finding 1): at the reviewed head
fa1de77f07077af97623c34c0a743b5d00000785, mask_sql() masked only `--` comments
once it entered a dollar-quoted function body. An unguarded SECURITY DEFINER
function therefore passed the scanner merely because the guard's NAME appeared
inside non-executable text — a string literal, a block comment, a nested block
comment, or a nested dollar-quoted literal. The MUST_REJECT cases below are that
false green, frozen.

Final-review remediation (PR #241, Finding 2): at head
c926e22185e4c0b6dd34aa92a8a614faff3940af the masking above was correct, but the
verdict still came from `GUARD_RE.search(body)` where GUARD_RE matched the guard
NAME alone. Masking deliberately keeps delimiters and identifiers, so any
non-executable appearance the masker preserves still satisfied the gate: an
outer dollar-quote tag ($wardah_assert_org_member$), a tagged outer or nested
delimiter containing the name, a quoted alias ("wardah_assert_org_member") and a
bare non-call identifier (PERFORM wardah_assert_org_member;) were all accepted
for an unguarded SECURITY DEFINER body. A recognized guard is now an executable
CALL shape — `guard(...)` or `public.guard(...)` — so the name by itself never
passes. The NON_CALL_MUST_REJECT cases below are that false green, frozen, for
two different recognized guards so the correction is not special-cased to one
string.

Final-review remediation (PR #241, Finding 3): `wardah_is_org_member(uuid)`
returns BOOLEAN and does not raise on denial, so a call whose result is
discarded authorizes nothing — yet the generic call-shape matcher accepted it.
It is removed from the generic assertion list, which leaves only the three
helpers that raise. It is still a real guard in the negated raising idiom every
historical caller uses, so that idiom is recognized STRUCTURALLY, never by a
flat regex: the call must sit in an IF condition, and that IF's own deny branch
must raise at its own nesting level. DISCARDED_BOOLEAN_MUST_REJECT freezes the
false green; NEGATED_RAISE_MUTANTS_MUST_REJECT proves the structural check
discriminates rather than rubber-stamping any nearby RAISE.
"""

from __future__ import annotations

import importlib.util
import pathlib
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("check_definer_guards.py")
_spec = importlib.util.spec_from_file_location("check_definer_guards", SCRIPT)
guards = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(guards)


def definer(body: str, name: str = "f_probe") -> str:
    """A SECURITY DEFINER function whose body is exactly `body`."""
    return (
        f"CREATE OR REPLACE FUNCTION public.{name}(p_org uuid)\n"
        "RETURNS void\n"
        "LANGUAGE plpgsql\n"
        "SECURITY DEFINER\n"
        "SET search_path TO 'public', 'pg_temp'\n"
        "AS $function$\n"
        "BEGIN\n"
        f"{body}\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "END;\n"
        "$function$;\n"
    )


GUARD = "wardah_assert_org_member"

MUST_REJECT = {
    # The plain unguarded case: the scanner's original reason for existing.
    "no_guard_at_all": definer("  PERFORM 1;"),
    # Finding 1: guard name inside a single-quoted string literal.
    "guard_only_in_string_literal": definer(f"  PERFORM '{GUARD}';"),
    # Finding 1: guard name inside a block comment in the body.
    "guard_only_in_block_comment": definer(f"  /* {GUARD} */"),
    # Finding 1: guard name inside a NESTED block comment in the body.
    "guard_only_in_nested_block_comment": definer(
        f"  /* outer /* {GUARD} */ still outer */"
    ),
    # Already rejected before the fix; kept so it cannot regress.
    "guard_only_in_line_comment": definer(f"  -- {GUARD}"),
    # Finding 1: guard name inside a nested dollar-quoted literal.
    "guard_only_in_nested_dollar_literal": definer(f"  RAISE NOTICE $${GUARD}$$;"),
    "guard_only_in_tagged_nested_dollar_literal": definer(
        f"  RAISE NOTICE $msg${GUARD}$msg$;"
    ),
    # A doubled quote is literal content, not an early close: the guard named
    # after it is still inside the literal.
    "guard_after_doubled_quote_in_literal": definer(
        f"  PERFORM 'it''s not a call to {GUARD}';"
    ),
    # The original defect, in its most seductive shape: prose that describes the
    # guard next to a body that never calls it.
    "guard_named_in_prose_only": definer(
        f"  -- This RPC relies on {GUARD}() being applied by its caller."
    ),
}


ADMIN_GUARD = "wardah_assert_org_admin"


def definer_delim(delim: str, body: str = "", name: str = "f_probe") -> str:
    """A SECURITY DEFINER function whose OUTER dollar-quote tag is `delim`."""
    return (
        f"CREATE OR REPLACE FUNCTION public.{name}(p_org uuid)\n"
        "RETURNS void\n"
        "LANGUAGE plpgsql\n"
        "SECURITY DEFINER\n"
        "SET search_path TO 'public', 'pg_temp'\n"
        f"AS {delim}\n"
        "BEGIN\n"
        f"{body}\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "END;\n"
        f"{delim};\n"
    )


# Finding 2. Every entry names a recognized guard somewhere the masker keeps
# intact, but never calls it. Each one returned [] before the call-shape
# matcher landed.
NON_CALL_MUST_REJECT = {
    # 1. Outer function delimiter is exactly the guard name.
    "outer_delimiter_is_guard_name": definer_delim(f"${GUARD}$"),
    # 2. Tagged outer delimiter containing the guard name.
    "outer_delimiter_tagged_contains_guard": definer_delim(f"$body_{GUARD}_end$"),
    # 3. Nested dollar-quote DELIMITER carries the name; its content does not.
    "nested_dollar_tag_contains_guard": definer(
        f"  RAISE NOTICE ${GUARD}$opaque${GUARD}$;"
    ),
    # 4. Quoted alias — a quoted identifier, not a call.
    "guard_only_as_quoted_alias": definer(f'  PERFORM 1 AS "{GUARD}";'),
    # 5. Bare non-call identifier.
    "guard_only_as_bare_identifier": definer(f"  PERFORM {GUARD};"),
    # 6. The same six classes for a second recognized guard, so the fix is a
    #    semantic class closure rather than a special case for one string.
    "admin_outer_delimiter_is_guard_name": definer_delim(f"${ADMIN_GUARD}$"),
    "admin_outer_delimiter_tagged_contains_guard": definer_delim(
        f"$body_{ADMIN_GUARD}_end$"
    ),
    "admin_nested_dollar_tag_contains_guard": definer(
        f"  RAISE NOTICE ${ADMIN_GUARD}$opaque${ADMIN_GUARD}$;"
    ),
    "admin_guard_only_as_quoted_alias": definer(f'  PERFORM 1 AS "{ADMIN_GUARD}";'),
    "admin_guard_only_as_bare_identifier": definer(f"  PERFORM {ADMIN_GUARD};"),
    # A longer identifier that merely ENDS with the guard name is not the guard.
    "guard_name_is_identifier_suffix": definer(f"  PERFORM fake_{GUARD}(p_org);"),
}

MUST_REJECT.update(NON_CALL_MUST_REJECT)


BOOL_PRED = "wardah_is_org_member"
QPRED = f"public.{BOOL_PRED}"

# Finding 3. The boolean predicate is called correctly, but its result is
# discarded and a privileged write follows. Each returned [] before the
# predicate was removed from the generic assertion list.
DISCARDED_BOOLEAN_MUST_REJECT = {
    "boolean_perform_qualified_result_ignored": definer(f"  PERFORM {QPRED}(p_org);"),
    "boolean_select_qualified_result_ignored": definer(f"  SELECT {QPRED}(p_org);"),
    "boolean_perform_unqualified_result_ignored": definer(
        f"  PERFORM {BOOL_PRED}(p_org);"
    ),
    "boolean_select_into_discarded": definer(f"  SELECT {BOOL_PRED}(p_org) INTO v_ok;"),
}

# Finding 3. The predicate IS negated and a RAISE IS present, but the raise does
# not actually deny this call. A flat "NOT pred ... RAISE" regex would accept
# every one of these; the structural check must not.
NEGATED_RAISE_MUTANTS_MUST_REJECT = {
    # Not negated: this raises FOR members, and lets non-members through.
    "predicate_not_negated": definer(
        f"  IF {QPRED}(p_org) THEN\n    RAISE EXCEPTION 'X';\n  END IF;"
    ),
    # The raise is in the ELSE branch, so the deny path does nothing.
    "raise_only_in_else_branch": definer(
        f"  IF NOT {QPRED}(p_org) THEN\n    NULL;\n"
        "  ELSE\n    RAISE EXCEPTION 'X';\n  END IF;"
    ),
    # The raise is inside a nested IF, so it is conditional on something else.
    "raise_only_in_nested_if": definer(
        f"  IF NOT {QPRED}(p_org) THEN\n    IF false THEN\n"
        "      RAISE EXCEPTION 'X';\n    END IF;\n  END IF;"
    ),
    # RAISE NOTICE reports; it does not abort.
    "raise_is_only_a_notice": definer(
        f"  IF NOT {QPRED}(p_org) THEN\n    RAISE NOTICE 'X';\n  END IF;"
    ),
    # The raise is after END IF, outside the deny branch entirely.
    "raise_after_end_if": definer(
        f"  IF NOT {QPRED}(p_org) THEN\n    NULL;\n  END IF;\n"
        "  RAISE NOTICE 'later';"
    ),
    # The predicate is in the THEN body, not in the condition.
    "predicate_in_body_not_condition": definer(
        f"  IF true THEN\n    PERFORM {QPRED}(p_org);\n"
        "    RAISE NOTICE 'x';\n  END IF;"
    ),
}

MUST_REJECT.update(DISCARDED_BOOLEAN_MUST_REJECT)
MUST_REJECT.update(NEGATED_RAISE_MUTANTS_MUST_REJECT)


MUST_ACCEPT = {
    # The real thing, in statement position.
    "executable_guard_call": definer(f"  PERFORM public.{GUARD}(p_org);"),
    # Same, with the non-executable decoys present as well: an executable call
    # anywhere in the body is still a pass.
    "executable_guard_plus_decoys": definer(
        f"  /* {GUARD} */\n"
        f"  PERFORM 'log {GUARD}';\n"
        f"  PERFORM public.{GUARD}(p_org);"
    ),
    # The unqualified form some migrations use.
    "unqualified_guard_call": definer(f"  PERFORM {GUARD}(p_org);"),
    # An admin guard is equally recognized.
    "admin_guard_call": definer("  PERFORM public.wardah_assert_org_admin(p_org);"),
    # Finding 3: the boolean predicate counts only in the negated raising
    # idiom — the shape migrations 153/166/167/168/169 actually use.
    "is_org_member_negated_raise": definer(
        "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
        "    RAISE EXCEPTION 'NOT_ORG_MEMBER';\n"
        "  END IF;"
    ),
    # Migration 178's recognized permission assertion.
    "permission_assertion_call": definer(
        "  PERFORM wardah_178_assert_permission(p_org, 'reports.financial.read');"
    ),
    # Finding 3: the exact shapes migrations 153 and 169 use.
    "negated_raise_multiline_condition_169": definer(
        "  IF public.get_current_tenant_id() IS NULL\n"
        f"     OR NOT {QPRED}(public.get_current_tenant_id()) THEN\n"
        "    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';\n  END IF;"
    ),
    "negated_raise_single_line_condition_153": definer(
        f"  IF v_org IS NULL OR NOT {QPRED}(v_org) THEN\n"
        "    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';\n  END IF;"
    ),
    # A bare RAISE with no level still aborts.
    "negated_raise_bare_level": definer(
        f"  IF NOT {QPRED}(p_org) THEN\n    RAISE 'DENIED';\n  END IF;"
    ),
    # Whitespace between the name and the parenthesis is still a call.
    "call_with_space_before_paren": definer(f"  PERFORM public.{GUARD} (p_org);"),
    # A real call still passes when the outer delimiter carries the guard name.
    "real_call_inside_guard_named_delimiter": definer_delim(
        f"${GUARD}$", f"  PERFORM public.{GUARD}(p_org);"
    ),
}

# Constructs the masker cannot follow. These must fail closed rather than be
# scanned as executable text.
MUST_FAIL_CLOSED = {
    "unterminated_block_comment": definer(f"  /* {GUARD}"),
    "unterminated_string_literal": definer(f"  PERFORM '{GUARD};"),
    "unterminated_nested_dollar": definer(f"  RAISE NOTICE $${GUARD};"),
}


class DefinerScannerTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    def test_non_executable_guard_mentions_are_rejected(self) -> None:
        for name, sql in MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: SECURITY DEFINER function accepted with no "
                    f"executable authorization guard",
                )

    def test_real_executable_guards_are_accepted(self) -> None:
        for name, sql in MUST_ACCEPT.items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.verdict(name, sql),
                    [],
                    f"{name}: a real executable guard was rejected",
                )

    def test_unmaskable_constructs_fail_closed(self) -> None:
        for name, sql in MUST_FAIL_CLOSED.items():
            with self.subTest(case=name):
                errors = self.verdict(name, sql)
                self.assertTrue(errors, f"{name}: unmaskable construct not reported")
                self.assertIn("cannot be scanned safely", errors[0])

    def test_non_call_guard_occurrences_are_rejected(self) -> None:
        """Finding 2: a recognized guard NAME that is not an executable call."""
        for name, sql in NON_CALL_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: guard name accepted without a function-call shape",
                )

    def test_guard_matcher_requires_call_shape(self) -> None:
        """The matcher itself, independent of check_file()."""
        for text in (
            f"${GUARD}$",
            f"$msg_{GUARD}$",
            f'SELECT 1 AS "{GUARD}";',
            f"PERFORM {GUARD};",
            f"PERFORM fake_{GUARD}(p_org);",
            f"PERFORM other_schema.{GUARD}(p_org);",
            f"${ADMIN_GUARD}$",
            f"PERFORM {ADMIN_GUARD};",
            # Finding 3: the boolean predicate is not a generic assertion, so
            # even a well-formed call to it must not satisfy GUARD_RE.
            f"PERFORM public.{BOOL_PRED}(p_org);",
            f"IF NOT public.{BOOL_PRED}(p_org) THEN",
        ):
            with self.subTest(reject=text):
                self.assertIsNone(guards.GUARD_RE.search(text), text)
        for text in (
            f"PERFORM {GUARD}(p_org);",
            f"PERFORM public.{GUARD}(p_org);",
            f"PERFORM public.{ADMIN_GUARD}(p_org);",
            "PERFORM wardah_178_assert_permission(p_org, 'k');",
            f"PERFORM public.{GUARD}\n    (p_org);",
        ):
            with self.subTest(accept=text):
                self.assertIsNotNone(guards.GUARD_RE.search(text), text)

    def test_discarded_boolean_predicate_is_rejected(self) -> None:
        """Finding 3: a boolean predicate whose result is thrown away."""
        for name, sql in DISCARDED_BOOLEAN_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: discarded boolean result accepted as an assertion",
                )

    def test_negated_raise_structure_discriminates(self) -> None:
        """Finding 3: a nearby RAISE is not enough — the deny branch must raise."""
        for name, sql in NEGATED_RAISE_MUTANTS_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: non-denying RAISE accepted as an assertion",
                )

    def test_boolean_predicate_is_not_a_generic_assertion(self) -> None:
        """It must be gone from the generic list, not merely handled elsewhere."""
        self.assertNotIn(BOOL_PRED, guards.GUARD_NAMES)
        self.assertIn(BOOL_PRED, guards.BOOLEAN_PREDICATES)
        for helper in (
            "wardah_assert_org_member",
            "wardah_assert_org_admin",
            "wardah_178_assert_permission",
        ):
            self.assertIn(helper, guards.GUARD_NAMES)

    def test_unbalanced_if_block_is_not_recognized(self) -> None:
        """An IF that never closes yields no recognized block (fails closed)."""
        self.assertFalse(
            guards.has_negated_raising_predicate(
                f"IF NOT {QPRED}(p_org) THEN RAISE EXCEPTION 'X';"
            )
        )

    def test_revoke_from_public_still_exempts(self) -> None:
        sql = definer("  PERFORM 1;", name="f_revoked") + (
            "REVOKE EXECUTE ON FUNCTION public.f_revoked(uuid) FROM PUBLIC;\n"
        )
        self.assertEqual(self.verdict("revoked", sql), [])

    def test_mask_preserves_offsets_and_keeps_body_executable(self) -> None:
        sql = definer(f"  PERFORM '{GUARD}';\n  PERFORM public.{GUARD}(p_org);")
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        self.assertEqual(len(masked), len(sql), "mask changed offsets")
        self.assertEqual(masked.count("\n"), sql.count("\n"), "mask ate a newline")
        # The executable body must survive: exactly one guard occurrence left,
        # and it is the call, not the literal.
        self.assertEqual(masked.count(GUARD), 1)
        self.assertIn(f"PERFORM public.{GUARD}(p_org);", masked)
        self.assertIn("UPDATE public.bins", masked)

    def test_repository_migrations_remain_scannable(self) -> None:
        """No committed migration or baseline may trip the fail-closed path."""
        files = sorted(pathlib.Path("sql/migrations").glob("*.sql")) + sorted(
            pathlib.Path("sql/baseline").glob("*.sql")
        )
        self.assertTrue(files, "no migrations found - run from the repository root")
        for path in files:
            _, problems = guards.mask_sql_checked(path.read_text(encoding="utf-8"))
            self.assertEqual(problems, [], f"{path.name}: {problems}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
