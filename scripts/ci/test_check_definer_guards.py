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

Final-review remediation (PR #241, Finding 4): the structural recognizer above
accepted the negated predicate anywhere in an IF condition, so a conjunction
could make the deny branch unreachable while the text still read as a guard
(`IF NOT pred(...) AND false THEN RAISE`). Non-membership must by itself
guarantee entry into the raising branch, so the negated predicate must now be an
entire top-level condition term — the whole condition, or one complete top-level
OR disjunct. Separately, the masker did not blank "quoted identifiers", so a
column aliased `"RAISE"` satisfied the structural RAISE detector; quoted
identifier CONTENT is now masked like any other non-executable text.

Final-review remediation (PR #241, Finding 5): two execution-reachability
classes remained. A guard could sit in dead code (`IF false THEN PERFORM
assert...`), and a guard could be called and actually raise while an enclosing
block swallowed the failure (`EXCEPTION WHEN OTHERS THEN NULL`). Both are closed
here, and neither by trying to prove arbitrary control flow:

  A. Swallowing (all migrations): a guard does not count when an ENCLOSING block
     has EXCEPTION handlers able to catch a PL/pgSQL P0001 assertion - WHEN
     OTHERS, WHEN raise_exception, WHEN SQLSTATE 'P0001'. An unrelated handler
     such as unique_violation cannot catch it and must not cause a false red,
     and a later non-enclosing nested handler must not invalidate a guard.

  B. Reachability (migrations >= MIGRATION_STRICT_CUTOFF): the guard must sit at
     the function's OUTER PL/pgSQL statement level - not under IF/ELSIF/ELSE,
     LOOP/WHILE/FOR/FOREACH, CASE, a nested BEGIN or an EXCEPTION handler. This
     is a forward syntactic contract, not a theorem prover: new SECURITY DEFINER
     code must use an authorization shape the scanner can actually prove.
     Migrations at or below the cutoff are immutable historical inputs and keep
     their previously validated compatibility. The cutoff is a migration NUMBER,
     so nothing is exempted by function name.

The guard need not be the literal first statement: identity and org-resolution
reads before it are legitimate and are covered by a positive control.
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


# Finding 4. The predicate IS negated and the branch DOES raise, but the
# conjunction means non-membership alone never enters that branch.
SUPPRESSED_DENY_MUST_REJECT = {
    # The deny branch is unreachable: non-members fall straight through.
    "negated_predicate_and_false": definer(
        f"  IF NOT {QPRED}(p_org) AND false THEN\n"
        "    RAISE EXCEPTION 'DENIED';\n  END IF;"
    ),
    # Same, with the operands swapped.
    "false_and_negated_predicate": definer(
        f"  IF false AND NOT {QPRED}(p_org) THEN\n"
        "    RAISE EXCEPTION 'DENIED';\n  END IF;"
    ),
    # A second condition can suppress the deny path for a non-member.
    "negated_predicate_and_other_condition": definer(
        f"  IF NOT {QPRED}(p_org) AND v_flag THEN\n"
        "    RAISE EXCEPTION 'DENIED';\n  END IF;"
    ),
    # Buried inside a parenthesised conjunction rather than a top-level term.
    "negated_predicate_inside_parenthesised_and": definer(
        f"  IF (NOT {QPRED}(p_org) AND v_flag) THEN\n"
        "    RAISE EXCEPTION 'DENIED';\n  END IF;"
    ),
    # Finding 4 (second class): a quoted identifier is not executable syntax, so
    # a column aliased "RAISE" must not satisfy the structural RAISE detector.
    "quoted_identifier_named_raise": definer(
        f"  IF NOT {QPRED}(p_org) THEN\n"
        '    PERFORM 1 AS "RAISE";\n  END IF;'
    ),
    "quoted_identifier_raise_exception": definer(
        f"  IF NOT {QPRED}(p_org) THEN\n"
        '    PERFORM 1 AS "RAISE EXCEPTION";\n  END IF;'
    ),
}

MUST_REJECT.update(SUPPRESSED_DENY_MUST_REJECT)



def definer_named(number: int, body: str, name: str = "f_probe") -> tuple[str, str]:
    """A fixture plus the migration filename stem that decides strictness."""
    return f"{number}_reachability_probe", definer(body, name=name)


OUTER = "public.wardah_assert_org_member"

# Finding 5A/5B. Each names a real guard and calls it correctly; none of them
# authorizes the privileged write that follows.
UNREACHABLE_OR_SWALLOWED_MUST_REJECT = {
    # 1. dead code
    "guard_inside_if_false": definer(
        f"  IF false THEN\n    PERFORM {OUTER}(p_org);\n  END IF;"
    ),
    # 2. a loop that never iterates
    "guard_inside_never_entered_loop": definer(
        f"  WHILE false LOOP\n    PERFORM {OUTER}(p_org);\n  END LOOP;"
    ),
    # 3. a CASE branch
    "guard_inside_case_branch": definer(
        f"  CASE WHEN false THEN\n    PERFORM {OUTER}(p_org);\n"
        "  ELSE NULL;\n  END CASE;"
    ),
    # 4. a nested BEGIN block
    "guard_inside_nested_begin": definer(
        f"  BEGIN\n    PERFORM {OUTER}(p_org);\n  END;"
    ),
    # 5-7. the guard runs and raises, but the failure is swallowed
    "guard_swallowed_by_when_others": definer(
        f"  BEGIN\n    PERFORM {OUTER}(p_org);\n"
        "  EXCEPTION WHEN OTHERS THEN\n    NULL;\n  END;"
    ),
    "guard_swallowed_by_raise_exception": definer(
        f"  BEGIN\n    PERFORM {OUTER}(p_org);\n"
        "  EXCEPTION WHEN raise_exception THEN\n    NULL;\n  END;"
    ),
    "guard_swallowed_by_sqlstate_p0001": definer(
        f"  BEGIN\n    PERFORM {OUTER}(p_org);\n"
        "  EXCEPTION WHEN SQLSTATE 'P0001' THEN\n    NULL;\n  END;"
    ),
    # 8. the structural boolean guard, nested in dead code
    "boolean_guard_nested_under_if_false": definer(
        "  IF false THEN\n"
        f"    IF NOT {QPRED}(v_org) THEN\n      RAISE EXCEPTION 'DENIED';\n"
        "    END IF;\n  END IF;"
    ),
    # The boolean guard's own denial, swallowed by an enclosing handler.
    "boolean_guard_swallowed_by_when_others": definer(
        "  BEGIN\n"
        f"    IF NOT {QPRED}(v_org) THEN\n      RAISE EXCEPTION 'DENIED';\n"
        "    END IF;\n  EXCEPTION WHEN OTHERS THEN\n    NULL;\n  END;"
    ),
}

MUST_REJECT.update(UNREACHABLE_OR_SWALLOWED_MUST_REJECT)

# Shapes that must keep passing under the strict contract.
OUTER_LEVEL_MUST_ACCEPT = {
    "outer_level_member_assert": definer(f"  PERFORM {OUTER}(p_org);"),
    "outer_level_admin_assert": definer(
        "  PERFORM public.wardah_assert_org_admin(p_org);"
    ),
    "outer_level_permission_assert": definer(
        "  PERFORM wardah_178_assert_permission(p_org, 'reports.financial.read');"
    ),
    "outer_level_boolean_negated_raise": definer(
        f"  IF NOT {QPRED}(v_org) THEN\n    RAISE EXCEPTION 'DENIED';\n  END IF;"
    ),
    # M191's real shape: resolve identity/org first, then assert. The contract is
    # about execution level, not textual first-line placement.
    "org_resolution_before_assert": definer(
        "  v_org := public.get_current_tenant_id();\n"
        "  IF v_org IS NULL THEN\n    RAISE EXCEPTION 'ORG_NOT_RESOLVED';\n"
        f"  END IF;\n  PERFORM {OUTER}(v_org);"
    ),
    # An unrelated handler cannot catch a P0001 assertion: no false red.
    "unrelated_unique_violation_handler": definer(
        f"  PERFORM {OUTER}(p_org);\n"
        "  BEGIN\n    INSERT INTO public.t VALUES (1);\n"
        "  EXCEPTION WHEN unique_violation THEN\n    NULL;\n  END;"
    ),
    # A later, NON-ENCLOSING nested handler must not invalidate the guard.
    "later_non_enclosing_when_others": definer(
        f"  PERFORM {OUTER}(p_org);\n"
        "  BEGIN\n    PERFORM 1;\n"
        "  EXCEPTION WHEN OTHERS THEN\n    NULL;\n  END;"
    ),
}


MUST_ACCEPT = {
    **OUTER_LEVEL_MUST_ACCEPT,
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
    # Finding 4: the predicate as the sole condition, and as a complete
    # top-level OR disjunct, are both safe — either one alone denies.
    "negated_predicate_is_whole_condition": definer(
        f"  IF NOT {QPRED}(p_org) THEN\n    RAISE EXCEPTION 'X';\n  END IF;"
    ),
    "negated_predicate_or_disjunct_first": definer(
        f"  IF NOT {QPRED}(v_org) OR v_org IS NULL THEN\n"
        "    RAISE EXCEPTION 'X';\n  END IF;"
    ),
    "negated_predicate_or_disjunct_parenthesised": definer(
        f"  IF v_org IS NULL OR (NOT {QPRED}(v_org)) THEN\n"
        "    RAISE EXCEPTION 'X';\n  END IF;"
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

    def test_suppressed_deny_branch_is_rejected(self) -> None:
        """Finding 4: non-membership alone must guarantee the raise."""
        for name, sql in SUPPRESSED_DENY_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: unreachable or non-executable deny branch accepted",
                )

    def test_top_level_term_analysis(self) -> None:
        """The term test itself, independent of check_file()."""
        for term in (
            f"NOT {QPRED}(v_org) AND false",
            f"false AND NOT {QPRED}(v_org)",
            f"NOT {QPRED}(v_org) AND v_flag",
            f"{QPRED}(v_org)",
            "v_org IS NULL",
        ):
            with self.subTest(reject=term):
                self.assertFalse(guards._is_sole_negated_predicate(term), term)
        for term in (
            f"NOT {QPRED}(v_org)",
            f"  NOT {QPRED}( v_org )  ",
            f"(NOT {QPRED}(v_org))",
            f"NOT {BOOL_PRED}(public.get_current_tenant_id())",
        ):
            with self.subTest(accept=term):
                self.assertTrue(guards._is_sole_negated_predicate(term), term)

    def test_quoted_identifier_content_is_masked(self) -> None:
        """Finding 4: quoted identifiers are not executable syntax."""
        sql = definer('  PERFORM 1 AS "RAISE";')
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        self.assertEqual(len(masked), len(sql), "mask changed offsets")
        self.assertEqual(masked.count("\n"), sql.count("\n"), "mask ate a newline")
        self.assertNotIn("RAISE", masked)
        self.assertIn('""', masked.replace(" ", ""))

    def test_unterminated_quoted_identifier_fails_closed(self) -> None:
        errors = self.verdict("unterminated_qid", definer('  PERFORM 1 AS "RAISE;'))
        self.assertTrue(errors)
        self.assertIn("cannot be scanned safely", errors[0])

    def test_unreachable_or_swallowed_guards_are_rejected(self) -> None:
        """Finding 5: dead code and swallowed denials are not authorization."""
        for name, sql in UNREACHABLE_OR_SWALLOWED_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: unreachable or swallowed guard accepted",
                )

    def test_strict_contract_applies_from_the_cutoff(self) -> None:
        """The cutoff is a migration NUMBER, tested through real filenames."""
        nested = UNREACHABLE_OR_SWALLOWED_MUST_REJECT["guard_inside_if_false"]
        at_cutoff = self.root / f"{guards.MIGRATION_STRICT_CUTOFF}_probe.sql"
        at_cutoff.write_text(nested, encoding="utf-8")
        self.assertTrue(
            guards.check_file(at_cutoff),
            "the contract must apply AT the cutoff, not only above it",
        )
        above = self.root / f"{guards.MIGRATION_STRICT_CUTOFF + 1}_probe.sql"
        above.write_text(nested, encoding="utf-8")
        self.assertTrue(guards.check_file(above))

    def test_historical_migrations_keep_their_compatibility(self) -> None:
        """<= cutoff is lenient on placement — by NUMBER, not by function name."""
        nested = UNREACHABLE_OR_SWALLOWED_MUST_REJECT["guard_inside_if_false"]
        for number in (150, guards.MIGRATION_STRICT_CUTOFF - 1):
            path = self.root / f"{number}_probe.sql"
            path.write_text(nested, encoding="utf-8")
            with self.subTest(migration=number):
                self.assertEqual(
                    guards.check_file(path),
                    [],
                    f"{number}: historical placement compatibility was broken",
                )

    def test_swallowing_rule_is_not_cutoff_scoped(self) -> None:
        """A swallowed denial is never an authorization boundary, at any age."""
        swallowed = UNREACHABLE_OR_SWALLOWED_MUST_REJECT[
            "guard_swallowed_by_when_others"
        ]
        for number in (150, guards.MIGRATION_STRICT_CUTOFF):
            path = self.root / f"{number}_swallow.sql"
            path.write_text(swallowed, encoding="utf-8")
            with self.subTest(migration=number):
                self.assertTrue(guards.check_file(path))

    def test_migration_191_passes_the_strict_contract_unchanged(self) -> None:
        """The contract begins AT 191, so 191 itself must satisfy it as shipped."""
        path = pathlib.Path(
            "sql/migrations/191_f2_stock_write_concurrency_closure.sql"
        )
        if not path.exists():
            self.skipTest("migration 191 not present")
        self.assertGreaterEqual(
            guards.migration_number(path), guards.MIGRATION_STRICT_CUTOFF
        )
        self.assertEqual(guards.check_file(path), [])

    def test_no_new_known_exempt_entries(self) -> None:
        """The closures must not have been bought with exemptions."""
        self.assertEqual(
            guards.KNOWN_EXEMPT,
            {
                "rpc_get_invitation_preview",
                "wardah_guard_allocation_immutability",
                "wardah_receipt_line_uninvoiced_base",
                "has_permission",
                "wardah_178_assert_permission",
                "rpc_batch_post_manual_journal_entries",
            },
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
