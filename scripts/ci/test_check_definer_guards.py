#!/usr/bin/env python3
"""Regression tests for the SECURITY DEFINER guard scanner.

These run against check_file() — the function CI actually uses per migration —
rather than against the masker alone, so they prove the verdict, not an
intermediate string.

Two kinds of test live here, and the difference matters when reading a green
run as evidence:

  END-TO-END. Every MUST_REJECT / MUST_ACCEPT fixture goes through
  self.verdict(), which writes a real `999_*.sql` (strict contract) and calls
  check_file(). These are the security acceptance cases; a fixture is only ever
  claimed closed on the strength of one of them.

  PARSER-INTERNAL. A handful assert on an intermediate result instead —
  test_labelled_exit_rule_discriminates, test_label_identity_follows_postgresql_folding,
  test_only_blocks_and_loops_take_a_label, test_effective_identifier_matches_postgresql_clipping
  and test_grant_option_only_is_modelled_on_the_statement. They pin down a
  specific semantic (label identity, statement modelling) more precisely than a
  verdict can, but each one is backed by end-to-end fixtures covering the same
  behaviour. None of them is the sole proof of any security property.

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

Final-review remediation (PR #241, Finding 6): the strict contract modelled
nesting but not function exit, so an outer-level assertion placed after an
earlier terminating RETURN still passed while being dead on at least one path
(`RETURN; PERFORM assert...`, or `IF p_skip THEN RETURN; END IF; PERFORM
assert...`). For migrations >= the cutoff, a candidate guard no longer counts
when any terminating RETURN precedes it textually. RETURN NEXT and RETURN QUERY
do not terminate a set-returning function and are not treated as exits. The rule
is deliberately conservative: it may reject a complex future function whose
returns are all provably guarded, and the remedy there is to move the
authorization boundary earlier, never to weaken the gate.

Final-review remediation (PR #241, Astra findings A/B/C):

  A. `_CATCHING_CONDITION_RE` searched the MASKED body for `SQLSTATE 'P0001'`,
     but the masker blanks literal content, so that condition could never match
     and such a handler was not seen as swallowing. The condition is now
     recovered from the unmasked text, only inside an EXCEPTION handler range.
     The fixture below puts the assertion in the function's OUTER BEGIN so it
     cannot pass merely because of placement.
  B. The recognizer found a call SHAPE and then checked only nesting/return, so
     `PERFORM guard(x) WHERE false;` passed although PostgreSQL never executes
     the call. Under the strict contract the assertion must now be a STANDALONE
     `PERFORM [public.]guard(args);` statement.
  C. The boolean deny branch counted as soon as a RAISE existed in it, while the
     RETURN check ran only before the IF. A terminating RETURN between THEN and
     that RAISE now disqualifies the block, so the aborting RAISE must actually
     be reachable.

Astra acceptance-layer findings D-J. Six classes that were all reproduced
through the real check_file() at afc0272 before a line changed, and none of
which more regex could close - they were consequences of the scanner attributing
by POSITION rather than by IDENTITY, and of modelling only part of what
PostgreSQL actually does:

  D. Exception CATEGORIES. PostgreSQL matches an EXCEPTION handler on the exact
     SQLSTATE or on its class - a code ending in '000'. A bare RAISE EXCEPTION
     is P0001, whose class is P0000, so `WHEN plpgsql_error` and
     `WHEN SQLSTATE 'P0000'` both swallow an authorization failure. Only the
     exact code was recognized. The same rule was matched on RAW text, where a
     block comment between `SQLSTATE` and its literal defeated it; conditions
     are resolved on masked structure now, with only the VALUE recovered raw.
  E. Reachability through an exit the model lacked: an outer-level aborting
     RAISE ends the invocation exactly as a terminating RETURN does, so an
     assertion after one is dead code.
  F. Body attribution: a definition with no dollar-quoted body of its own
     (`LANGUAGE internal AS 'boolin'`, an SQL-standard `BEGIN ATOMIC` body)
     searched FORWARD and swallowed the next function's body, and with it the
     next function's guard.
  G. Privilege attribution: the exemption was a blanket `REVOKE ... FROM PUBLIC`
     anywhere before the next CREATE. It never checked that the statement named
     THIS function or THIS overload, and never noticed a later
     `GRANT ... TO PUBLIC` putting the privilege back.
  H. `ALTER FUNCTION ... SECURITY DEFINER` restates no body, so there was
     nothing to read a guard from - and it was attributed to whatever CREATE
     happened to precede it, or dropped entirely when none did.
  I. Quoted identities. The CREATE pattern read the name off the MASKED text,
     where a quoted identifier's content is blanked by design, so
     `CREATE FUNCTION public."f"(...)` matched no definition at all. Case is
     part of the identity too: a quoted "HAS_PERMISSION" is not `has_permission`.
  J. Overload impersonation, from both directions: KNOWN_EXEMPT is keyed by bare
     NAME, so a new overload of an exempt name inherited an exemption written
     for a different function; and a guard call was matched by name, so a
     locally declared no-op overload of a recognized helper satisfied the gate.
     The third rule - a migration may not redefine a helper it is validated by -
     applies FROM THE CUTOFF ON and must: migrations 123 and 178 both replace a
     recognized helper and both sit inside the scanned set, so a rule applied at
     every age would turn two immutable historical migrations red.

The catalog-side half of D, H, I and J - what the whole chain finally produced,
which no per-file scan can see - is asserted by
scripts/ci/fresh-db/acceptance_definer_guard_contract.sql and proved falsifiable
by scripts/ci/fresh-db/selftest_definer_guard_contract.sh.
"""

from __future__ import annotations

import importlib.util
import pathlib
import re
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
        # Fixture text fed to check_file(); never executed as SQL.
        f"CREATE OR REPLACE FUNCTION public.{name}(p_org uuid)\n"  # nosec B608
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
        # Fixture text fed to check_file(); never executed as SQL.
        f"CREATE OR REPLACE FUNCTION public.{name}(p_org uuid)\n"  # nosec B608
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
WORK_LINE = "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;"

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
        f"  PERFORM {OUTER}(p_org);\n"  # nosec B608 - fixture text, never executed as SQL
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



# Finding 6. The guard is at outer level and is not swallowed, but the function
# can already have returned before reaching it.
RETURN_BEFORE_GUARD_MUST_REJECT = {
    # Unconditional dead code after a bare RETURN.
    "bare_return_before_guard": definer(
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"  # nosec B608 - fixture text, never executed as SQL
        f"  RETURN;\n  PERFORM {OUTER}(p_org);"
    ),
    # Same with a returned expression.
    "return_expression_before_guard": definer(
        "  UPDATE public.bins SET actual_qty = 0;\n"  # nosec B608 - fixture text, never executed as SQL
        f"  RETURN 1;\n  PERFORM {OUTER}(p_org);"
    ),
    # An early exit on some input path skips the guard for those inputs.
    "conditional_early_return_before_guard": definer(
        "  IF p_skip THEN\n    RETURN;\n  END IF;\n"  # nosec B608 - fixture text, never executed as SQL
        f"  PERFORM {OUTER}(p_org);\n"
        "  UPDATE public.bins SET actual_qty = 0;"
    ),
    # The structural boolean guard is subject to the same rule.
    "return_before_boolean_guard": definer(
        "  UPDATE public.bins SET actual_qty = 0;\n  RETURN;\n"  # nosec B608 - fixture text, never executed as SQL
        f"  IF NOT {QPRED}(v_org) THEN\n    RAISE EXCEPTION 'DENIED';\n  END IF;"
    ),
    "conditional_early_return_before_boolean_guard": definer(
        "  IF p_skip THEN\n    RETURN;\n  END IF;\n"  # nosec B608 - fixture text, never executed as SQL
        f"  IF NOT {QPRED}(v_org) THEN\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n"
        "  UPDATE public.bins SET actual_qty = 0;"
    ),
}

MUST_REJECT.update(RETURN_BEFORE_GUARD_MUST_REJECT)

# The guard precedes every exit: still a valid boundary.
GUARD_BEFORE_RETURN_MUST_ACCEPT = {
    "guard_then_bare_return": definer(
        f"  PERFORM {OUTER}(p_org);\n"  # nosec B608 - fixture text, never executed as SQL
        "  UPDATE public.bins SET actual_qty = 0;\n  RETURN;"
    ),
    "guard_then_return_expression": definer(
        f"  PERFORM {OUTER}(p_org);\n  RETURN 1;"
    ),
    "boolean_guard_then_return": definer(
        f"  IF NOT {QPRED}(v_org) THEN\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n"  # nosec B608 - fixture text, never executed as SQL
        "  UPDATE public.bins SET actual_qty = 0;\n  RETURN;"
    ),
    # M191's shape: resolve org, assert, do the work, return at the end.
    "m191_resolve_assert_work_return": definer(
        "  v_org := public.get_current_tenant_id();\n"  # nosec B608 - fixture text, never executed as SQL
        "  IF v_org IS NULL THEN\n    RAISE EXCEPTION 'ORG_NOT_RESOLVED';\n"
        f"  END IF;\n  PERFORM {OUTER}(v_org);\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = v_org;\n"
        "  RETURN;"
    ),
}



# Astra A/B/C. Each is a real, correctly-shaped guard that does not authorize.
ASTRA_MUST_REJECT = {
    # A. Assertion in the function's OUTER BEGIN, caught by SQLSTATE 'P0001'.
    #    Placement is valid here, so only SQLSTATE detection can reject it.
    "outer_assert_caught_by_sqlstate_p0001": (
        "CREATE OR REPLACE FUNCTION public.f_probe(p_org uuid)\n"  # nosec B608 - fixture text, never executed as SQL
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\n"
        "AS $function$\nBEGIN\n"
        f"  PERFORM {OUTER}(p_org);\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "EXCEPTION WHEN SQLSTATE 'P0001' THEN\n  NULL;\n"
        "END;\n$function$;\n"
    ),
    # B. The call is present but PostgreSQL never executes it.
    "perform_assertion_with_where_false": definer(
        f"  PERFORM {OUTER}(p_org) WHERE false;"
    ),
    "select_assertion_with_where_false": definer(
        f"  SELECT {OUTER}(p_org) WHERE false;"
    ),
    "select_assertion_without_perform": definer(f"  SELECT {OUTER}(p_org);"),
    # C. The deny branch exits before it ever denies.
    "boolean_deny_returns_before_raise": definer(
        f"  IF NOT {QPRED}(v_org) THEN\n    RETURN;\n"  # nosec B608 - fixture text, never executed as SQL
        "    RAISE EXCEPTION 'DENIED';\n  END IF;\n"
        "  UPDATE public.bins SET actual_qty = 0;"
    ),
    "boolean_deny_conditional_return_before_raise": definer(
        f"  IF NOT {QPRED}(v_org) THEN\n"  # nosec B608 - fixture text, never executed as SQL
        "    IF p_soft THEN RETURN; END IF;\n"
        "    RAISE EXCEPTION 'DENIED';\n  END IF;\n"
        "  UPDATE public.bins SET actual_qty = 0;"
    ),
}

MUST_REJECT.update(ASTRA_MUST_REJECT)

ASTRA_MUST_ACCEPT = {
    # A control: an unrelated handler in the OUTER BEGIN cannot catch P0001 and
    # must not invalidate the guard.
    "outer_assert_with_unique_violation_handler": (
        "CREATE OR REPLACE FUNCTION public.f_probe(p_org uuid)\n"  # nosec B608 - fixture text, never executed as SQL
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\n"
        "AS $function$\nBEGIN\n"
        f"  PERFORM {OUTER}(p_org);\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "EXCEPTION WHEN unique_violation THEN\n  NULL;\n"
        "END;\n$function$;\n"
    ),
    # C control: the deny branch raises before any return.
    "boolean_deny_raises_then_returns": definer(
        f"  IF NOT {QPRED}(v_org) THEN\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n"  # nosec B608 - fixture text, never executed as SQL
        "  UPDATE public.bins SET actual_qty = 0;\n  RETURN;"
    ),
}


# ---------------------------------------------------------------------------
# Final-review P2-A: a labelled EXIT jumps past the authorization boundary
# ---------------------------------------------------------------------------
# Reproduced through the real check_file() at 337965b, where every fixture in
# LABELLED_EXIT_MUST_REJECT returned []. is_unreachable_at() modelled a
# terminating RETURN and an outer-level aborting RAISE, both of which end the
# whole invocation, but not `EXIT <label>` — which does not end the invocation
# and is exactly why it slipped through. It leaves the block it names and
# resumes after that block's END, so the guard sitting further down inside that
# block is skipped while remaining, textually, a real call at the outer
# statement level with nothing disqualifying before it.
#
# `EXIT` is the shape people do not expect to cross a BEGIN boundary: an
# unlabelled EXIT only ever leaves the innermost LOOP, and PostgreSQL requires
# the label precisely for the block case. The controls below hold that
# distinction — an inner block that exits itself, and a loop that exits itself,
# both leave a later outer-level guard intact.
def labelled_definer(
    body: str,
    label: str = "auth_block",
    declare: str = "",
    end_label: str | None = None,
) -> str:
    """A SECURITY DEFINER function whose OUTER block carries a `<<label>>`.

    `declare` inserts a declaration section between the label and BEGIN, which
    is where PL/pgSQL actually puts it and which the first fix could not see.
    """
    tail = label if end_label is None else end_label
    return (
        "CREATE OR REPLACE FUNCTION public.f_probe(p_org uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\n"
        "SET search_path TO 'public', 'pg_temp'\n"
        f"AS $function$\n<<{label}>>\n{declare}BEGIN\n{body}\nEND {tail};\n"
        "$function$;\n"
    )


DECLARE_SECTION = "DECLARE\n  v_seen boolean := false;\n  v_count integer := 0;\n"


LABELLED_EXIT_MUST_REJECT = {
    # The reported mutant: the privileged write has already happened, the jump
    # skips the assertion, and the function returns having authorized nothing.
    "labelled_exit_before_guard": labelled_definer(
        f"{WORK_LINE}\n  EXIT auth_block;\n  PERFORM {OUTER}(p_org);"
    ),
    # A conditional jump still leaves a path on which the guard never runs —
    # the same reason terminating_return_before() rejects a conditional RETURN.
    "conditional_labelled_exit_before_guard": labelled_definer(
        f"{WORK_LINE}\n  EXIT auth_block WHEN p_org IS NULL;\n"
        f"  PERFORM {OUTER}(p_org);"
    ),
    # The jump is issued from a nested block but NAMES the outer one, so it
    # still lands past the guard.
    "inner_block_exits_the_labelled_outer_block": labelled_definer(
        f"  BEGIN\n    EXIT auth_block;\n  END;\n"
        f"  PERFORM {OUTER}(p_org);\n{WORK_LINE}"
    ),
    # The label is still the block's label with a comment between the two: the
    # masker has turned the comment into whitespace by then, so a fixed-window
    # lookback would be the only thing that could lose it.
    "labelled_exit_with_a_comment_between_label_and_begin": (
        "CREATE OR REPLACE FUNCTION public.f_probe(p_org uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\n"
        "AS $function$\n<<auth_block>>\n/* " + ("x" * 400) + " */\nBEGIN\n"
        f"{WORK_LINE}\n  EXIT auth_block;\n  PERFORM {OUTER}(p_org);\n"
        "END auth_block;\n$function$;\n"
    ),
    # The boolean negated-raising idiom is skipped by the same jump.
    "labelled_exit_before_boolean_guard": labelled_definer(
        "  EXIT auth_block;\n"
        f"  IF NOT {QPRED}(p_org) THEN\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n"
        f"{WORK_LINE}"
    ),
}

# ---------------------------------------------------------------------------
# Second-round P2: the same bypass through shapes the first fix could not see
# ---------------------------------------------------------------------------
# Every fixture below was run through the REAL check_file() at b200591 - after
# the first P2-A fix - and returned [] there. Two independent gaps:
#
#   1. A DECLARE section. The block grammar is
#      `[<<label>>] [DECLARE ...] BEGIN ... END [label];`, so the label precedes
#      the DECLARE. The first fix walked BACKWARD from BEGIN over whitespace,
#      landed on the `;` of the last declaration, and recorded no label at all -
#      so every function with a declaration section, which is the ordinary
#      shape, silently lost its label and the bypass reopened. The original
#      corpus contained no DECLARE fixture, which is why 62 green tests said
#      nothing about it.
#
#   2. Quoted and non-ASCII labels. PostgreSQL accepts a quoted identifier on
#      both sides, and the masker blanks quoted content, so `EXIT "auth_block";`
#      read as `EXIT "          ";` and matched nothing. The ASCII-only pattern
#      also missed the high-range identifier characters _UNQUOTED_IDENT_RE
#      already models elsewhere in the scanner.
LABELLED_EXIT_DECLARE_MUST_REJECT = {
    "declare_section_before_the_labelled_begin": labelled_definer(
        f"{WORK_LINE}\n  EXIT auth_block;\n  PERFORM {OUTER}(p_org);",
        declare=DECLARE_SECTION,
    ),
    # The trailing `END;` carries no label, so nothing downstream can recover it.
    "declare_section_with_an_unlabelled_end": labelled_definer(
        f"{WORK_LINE}\n  EXIT auth_block;\n  PERFORM {OUTER}(p_org);",
        declare=DECLARE_SECTION,
        end_label="",
    ),
    "declare_section_with_the_boolean_deny_guard": labelled_definer(
        f"{WORK_LINE}\n  EXIT auth_block;\n"
        f"  IF NOT {QPRED}(p_org) THEN\n    RAISE EXCEPTION 'DENIED';\n  END IF;",
        declare=DECLARE_SECTION,
    ),
    "declare_section_with_a_conditional_exit": labelled_definer(
        f"{WORK_LINE}\n  EXIT auth_block WHEN p_org IS NULL;\n"
        f"  PERFORM {OUTER}(p_org);",
        declare=DECLARE_SECTION,
    ),
    "declare_section_with_an_inner_block_exiting_the_outer_label": labelled_definer(
        "  BEGIN\n    EXIT auth_block;\n  END;\n"
        f"  PERFORM {OUTER}(p_org);\n{WORK_LINE}",
        declare=DECLARE_SECTION,
    ),
    # A comment between the label and the DECLARE is whitespace after masking.
    "comment_then_declare_then_begin": labelled_definer(
        f"{WORK_LINE}\n  EXIT auth_block;\n  PERFORM {OUTER}(p_org);",
        declare="/* resolve the caller's org first */\n" + DECLARE_SECTION,
    ),
}

LABELLED_EXIT_IDENTIFIER_MUST_REJECT = {
    "quoted_exit_target_against_an_unquoted_label": labelled_definer(
        f'{WORK_LINE}\n  EXIT "auth_block";\n  PERFORM {OUTER}(p_org);'
    ),
    "quoted_block_label_against_an_unquoted_exit": labelled_definer(
        f"{WORK_LINE}\n  EXIT auth_block;\n  PERFORM {OUTER}(p_org);",
        label='"auth_block"',
        end_label='"auth_block"',
    ),
    "both_sides_quoted": labelled_definer(
        f'{WORK_LINE}\n  EXIT "auth_block";\n  PERFORM {OUTER}(p_org);',
        label='"auth_block"',
        end_label='"auth_block"',
    ),
    # A quoted label keeps its case on BOTH sides, so this is one label.
    "both_sides_quoted_mixed_case": labelled_definer(
        f'{WORK_LINE}\n  EXIT "Auth_Block";\n  PERFORM {OUTER}(p_org);',
        label='"Auth_Block"',
        end_label='"Auth_Block"',
    ),
    "quoted_label_with_a_declare_section": labelled_definer(
        f'{WORK_LINE}\n  EXIT "auth_block";\n  PERFORM {OUTER}(p_org);',
        label='"auth_block"',
        end_label='"auth_block"',
        declare=DECLARE_SECTION,
    ),
    # PostgreSQL identifiers are not ASCII-only, and neither is this scanner's
    # own _UNQUOTED_IDENT_RE.
    "non_ascii_unquoted_label": labelled_definer(
        f"{WORK_LINE}\n  EXIT حارس;\n  PERFORM {OUTER}(p_org);",
        label="حارس",
        end_label="حارس",
    ),
    "non_ascii_label_with_a_declare_section": labelled_definer(
        f"{WORK_LINE}\n  EXIT حارس;\n  PERFORM {OUTER}(p_org);",
        label="حارس",
        end_label="حارس",
        declare=DECLARE_SECTION,
    ),
}

# ---------------------------------------------------------------------------
# Third-round P2-C: identifiers collide once PostgreSQL clips them
# ---------------------------------------------------------------------------
# Every fixture below was run through the REAL check_file() at 407ffa1 - after
# the DECLARE and quoted/non-ASCII round - and returned [] there.
#
# PostgreSQL clips every identifier to NAMEDATALEN-1 = 63 BYTES, so a block
# label and an EXIT target that differ only PAST byte 63 are ONE label to
# PL/pgSQL. Comparing the untruncated text sees two names where the database
# sees one, records no jump, and accepts the function. Confirmed at run time on
# PostgreSQL 17: the function is created with a truncation notice and the
# assertion never executes.
#
# The limit is in BYTES, so a multibyte label collides sooner in characters than
# an ASCII one, and the clip must fall on a character boundary.
_LONG = "a" * 63                     # 63 ASCII bytes; +1 char overflows
_LONG_MB = "م" * 32             # 64 bytes: over the limit in 32 characters


def collide_definer(label: str, target: str, declare: str = "",
                    guard: str | None = None, exit_stmt: str | None = None) -> str:
    """A SECURITY DEFINER function whose label and EXIT target may collide."""
    guard = f"  PERFORM {OUTER}(p_org);" if guard is None else guard
    exit_stmt = f"  EXIT {target};" if exit_stmt is None else exit_stmt
    return (
        "CREATE OR REPLACE FUNCTION public.f_probe(p_org uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\n"
        f"AS $function$\n<<{label}>>\n{declare}BEGIN\n{WORK_LINE}\n"
        f"{exit_stmt}\n{guard}\nEND;\n$function$;\n"
    )


LABELLED_EXIT_TRUNCATION_MUST_REJECT = {
    "ascii_labels_differing_only_after_byte_63": collide_definer(
        _LONG + "X", _LONG + "Y"
    ),
    "truncation_collision_with_a_declare_section": collide_definer(
        _LONG + "X", _LONG + "Y", declare=DECLARE_SECTION
    ),
    # 32 two-byte characters already exceed 63 bytes, so these differ only past
    # the limit even though they are short in characters.
    "multibyte_labels_differing_only_after_the_byte_limit": collide_definer(
        _LONG_MB + "a", _LONG_MB + "b"
    ),
    # Quoting preserves case but does not exempt an identifier from the clip.
    "quoted_labels_colliding_only_after_byte_63": collide_definer(
        f'"{_LONG}X"', f'"{_LONG}Y"'
    ),
    "conditional_exit_with_a_truncation_collision": collide_definer(
        _LONG + "X", _LONG + "Y",
        exit_stmt=f"  EXIT {_LONG}Y WHEN p_org IS NULL;",
    ),
    "boolean_deny_guard_behind_a_colliding_exit": collide_definer(
        _LONG + "X", _LONG + "Y",
        guard=(f"  IF NOT {QPRED}(p_org) THEN\n"
               "    RAISE EXCEPTION 'DENIED';\n  END IF;"),
    ),
}

LABELLED_EXIT_TRUNCATION_MUST_ACCEPT = {
    # Different inside the first 63 bytes: two real labels, no jump proven.
    "labels_genuinely_different_within_the_limit": collide_definer(
        "alpha_block", "beta_block"
    ),
    # Over-length but identical, with the guard ahead of the jump.
    "guard_before_a_colliding_exit": collide_definer(
        _LONG + "X", _LONG + "X",
        guard=WORK_LINE,
        exit_stmt=f"  PERFORM {OUTER}(p_org);\n  EXIT {_LONG}X;",
    ),
    # An inner over-length block that exits ITSELF leaves the outer guard live.
    "inner_long_labelled_block_exits_itself": definer(
        f"  <<{_LONG}X>>\n  BEGIN\n    EXIT {_LONG}X;\n  END;\n"
        f"  PERFORM {OUTER}(p_org);"
    ),
    # Quoted identifiers keep their case, and both fit inside the limit, so
    # PostgreSQL keeps these distinct and the guard stays reachable.
    "quoted_mixed_case_stays_distinct_within_the_limit": collide_definer(
        '"Auth_Block"', '"auth_block"'
    ),
}

LABELLED_EXIT_MUST_REJECT.update(LABELLED_EXIT_DECLARE_MUST_REJECT)
LABELLED_EXIT_MUST_REJECT.update(LABELLED_EXIT_IDENTIFIER_MUST_REJECT)
LABELLED_EXIT_MUST_REJECT.update(LABELLED_EXIT_TRUNCATION_MUST_REJECT)

MUST_REJECT.update(LABELLED_EXIT_MUST_REJECT)

LABELLED_EXIT_MUST_ACCEPT = {
    # The guard precedes the jump, so every path through the block is authorized.
    "guard_before_labelled_exit": labelled_definer(
        f"  PERFORM {OUTER}(p_org);\n  EXIT auth_block;\n{WORK_LINE}"
    ),
    # An inner labelled block that exits ITSELF completes before the outer-level
    # guard, which therefore still runs. Rejecting this would be a false red.
    "inner_labelled_block_exits_itself": definer(
        "  <<inner>>\n  BEGIN\n    EXIT inner;\n  END inner;\n"
        f"  PERFORM {OUTER}(p_org);"
    ),
    # An UNLABELLED EXIT can only leave the innermost loop; the guard after the
    # loop is untouched.
    "unlabelled_loop_exit_then_guard": definer(
        "  WHILE true LOOP\n    EXIT;\n  END LOOP;\n"
        f"  PERFORM {OUTER}(p_org);"
    ),
    # `EXIT WHEN <predicate>` carries no label: WHEN must not be read as one.
    "exit_when_without_a_label_then_guard": definer(
        "  WHILE true LOOP\n    EXIT WHEN p_org IS NOT NULL;\n  END LOOP;\n"
        f"  PERFORM {OUTER}(p_org);"
    ),
    # `>>` is also the inet/box shift operator. Text that merely ends in `>>`
    # before a block must not be read as a label.
    "shift_operator_is_not_a_block_label": definer(
        "  PERFORM inet '10.0.0.0/8' >> inet '10.1.1.1';\n"
        f"  PERFORM {OUTER}(p_org);"
    ),
    # A labelled loop that exits itself, with the guard after it.
    #
    # NOTE, so this is not read as more than it proves: the labelled-LOOP
    # fixtures are NOT isolation proofs. A guard inside a loop is already
    # rejected by is_outer_statement_level(), so these reject with the EXIT
    # removed too. The loop branch of _labelled_opener() is belt-and-braces;
    # only the BEGIN-block branch is load-bearing for this contract.
    "labelled_loop_exits_itself_then_guard": definer(
        "  <<scan>>\n  WHILE true LOOP\n    EXIT scan;\n  END LOOP;\n"
        f"  PERFORM {OUTER}(p_org);"
    ),
    # Second-round controls: the DECLARE and identifier work must not turn any
    # of these into a false red.
    "declare_section_with_the_guard_before_the_exit": labelled_definer(
        f"  PERFORM {OUTER}(p_org);\n  EXIT auth_block;\n{WORK_LINE}",
        declare=DECLARE_SECTION,
    ),
    "declare_section_with_an_inner_block_exiting_itself": labelled_definer(
        "  <<inner>>\n  BEGIN\n    EXIT inner;\n  END inner;\n"
        f"  PERFORM {OUTER}(p_org);\n{WORK_LINE}",
        declare=DECLARE_SECTION,
    ),
    "declare_section_with_an_unlabelled_loop_exit": labelled_definer(
        "  WHILE true LOOP\n    EXIT;\n  END LOOP;\n"
        f"  PERFORM {OUTER}(p_org);\n{WORK_LINE}",
        declare=DECLARE_SECTION,
    ),
    "declare_section_with_exit_when_and_no_label": labelled_definer(
        "  WHILE true LOOP\n    EXIT WHEN p_org IS NOT NULL;\n  END LOOP;\n"
        f"  PERFORM {OUTER}(p_org);\n{WORK_LINE}",
        declare=DECLARE_SECTION,
    ),
    # `exit` is not a reserved word in SQL. A column of that name followed by a
    # comma is not an EXIT statement and must not be read as an unreadable jump.
    "a_column_named_exit_is_not_a_jump": definer(
        "  PERFORM (SELECT exit, p_org FROM public.probe_rows LIMIT 1);\n"  # nosec B608
        f"  PERFORM {OUTER}(p_org);"
    ),
    # An inner block labelled the same word as an OUTER loop must not let the
    # inner self-exit be read against the outer construct.
    "inner_block_exits_itself_beside_a_same_named_loop": definer(
        "  <<inner>>\n  BEGIN\n    EXIT inner;\n  END inner;\n"
        f"  PERFORM {OUTER}(p_org);\n"
        "  <<inner>>\n  WHILE false LOOP\n    NULL;\n  END LOOP;"
    ),
}


MUST_ACCEPT = {
    **OUTER_LEVEL_MUST_ACCEPT,
    **ASTRA_MUST_ACCEPT,
    **GUARD_BEFORE_RETURN_MUST_ACCEPT,
    **LABELLED_EXIT_MUST_ACCEPT,
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


# ---------------------------------------------------------------------------
# Astra findings D-I: acceptance-layer gaps in the scanner itself
# ---------------------------------------------------------------------------
# Every fixture below was run through the REAL check_file() at the reviewed head
# before any change. Most returned [] - that is the false green, frozen. Six did
# NOT, and they are marked as controls where they appear:
#
#   4 in EXCEPTION_CATEGORY_MUST_REJECT - OTHERS and raise_exception, which the
#     old condition regex already matched by name, plus SQLSTATE 'P0001' alone
#     and inside an OR list, which the old raw-text SQLSTATE search already found
#     anywhere in the handler range;
#   2 in REVOKE_ATTRIBUTION_MUST_REJECT - a REVOKE before the definition, which
#     the old window (starting at the definition) never saw, and ON ALL FUNCTIONS
#     IN SCHEMA, which the old pattern's required ON FUNCTION never matched.
#
# Each group therefore contributes 4 closures and its controls. They are kept
# because the rewrite could easily have started accepting them; they are not
# closed findings and must not be counted as any.


def definer_outer_handler(handler: str, name: str = "f_probe") -> str:
    """A guard at the OUTER statement level whose own block handles `handler`.

    The handler is on the FUNCTION's own BEGIN, so the fixture cannot pass or
    fail for placement reasons: the only thing under test is whether that
    handler can catch the assertion's P0001.
    """
    return (
        # Fixture text fed to check_file(); never executed as SQL.
        f"CREATE OR REPLACE FUNCTION public.{name}(p_org uuid)\n"  # nosec B608
        "RETURNS void\n"
        "LANGUAGE plpgsql\n"
        "SECURITY DEFINER\n"
        "SET search_path TO 'public', 'pg_temp'\n"
        "AS $function$\n"
        "BEGIN\n"
        f"  PERFORM {OUTER}(p_org);\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        f"EXCEPTION WHEN {handler} THEN\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "END;\n"
        "$function$;\n"
    )


# D. PostgreSQL matches an EXCEPTION handler either on the exact SQLSTATE or on
#    its CATEGORY - a condition whose code ends in '000'. A bare RAISE EXCEPTION
#    is P0001, whose category is P0000, so `plpgsql_error` and
#    `SQLSTATE 'P0000'` both catch an authorization failure. Only the exact code
#    was recognized, so the category door stood open. The comment-separated form
#    is the same defect from the other side: the condition was matched on RAW
#    text, where a block comment between the keyword and the literal defeated the
#    separator; it is resolved on masked structure now, with only the VALUE
#    recovered from the raw source.
EXCEPTION_CATEGORY_MUST_REJECT = {
    "handler_catches_by_category_name": definer_outer_handler("plpgsql_error"),
    "handler_catches_by_category_code": definer_outer_handler("SQLSTATE 'P0000'"),
    "handler_catches_with_comment_separator": definer_outer_handler(
        "SQLSTATE /* documented reason */ 'P0001'"
    ),
    "handler_catches_as_later_or_term": definer_outer_handler(
        "unique_violation OR plpgsql_error"
    ),
    # Controls that were already rejected at the reviewed head, kept so they
    # cannot regress. The old SQLSTATE search scanned the whole handler range,
    # so it matched inside an OR list too - which is why the OR form below is a
    # control while its plpgsql_error twin above is a closure.
    "handler_catches_as_later_or_sqlstate": definer_outer_handler(
        "unique_violation OR SQLSTATE 'P0001'"
    ),
    "handler_catches_when_others": definer_outer_handler("OTHERS"),
    "handler_catches_raise_exception": definer_outer_handler("raise_exception"),
    "handler_catches_sqlstate_p0001": definer_outer_handler("SQLSTATE 'P0001'"),
}

# The other half of the same rule: a condition that CANNOT catch a P0001 must
# not invalidate a real guard. PostgreSQL resolves every condition name at
# compile time, so an unrecognized one is a hard error rather than an attacker's
# invention - which is why treating an unknown name as non-catching is sound.
EXCEPTION_CATEGORY_MUST_ACCEPT = {
    "unique_violation_does_not_catch": definer_outer_handler("unique_violation"),
    "fk_violation_does_not_catch": definer_outer_handler("foreign_key_violation"),
    "unrelated_category_does_not_catch": definer_outer_handler("data_exception"),
}


# E. Reachability again, but through an exit the model did not have. A
#    terminating RETURN was understood; an aborting RAISE at the OUTER statement
#    level ends the invocation just as surely, so an assertion after one is dead
#    code no caller ever reaches. A raise inside a conditional is NOT an exit,
#    and must not cost a real guard its recognition.
UNREACHABLE_ABORT_MUST_REJECT = {
    "guard_after_outer_level_raise": definer(
        f"  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n  PERFORM {OUTER}(p_org);"
    ),
    "guard_after_outer_level_raise_using": definer(
        "  RAISE EXCEPTION 'X' USING ERRCODE = '22023';\n"
        f"  PERFORM {OUTER}(p_org);"
    ),
    "boolean_guard_after_outer_level_raise": definer(
        "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
        f"  IF NOT {QPRED}(p_org) THEN\n    RAISE EXCEPTION 'DENIED';\n  END IF;"
    ),
}

UNREACHABLE_ABORT_MUST_ACCEPT = {
    "conditional_raise_before_guard_is_not_an_exit": definer(
        "  IF p_org IS NULL THEN\n    RAISE EXCEPTION 'ORG_REQUIRED';\n  END IF;\n"
        f"  PERFORM {OUTER}(p_org);"
    ),
    "raise_notice_before_guard_is_not_an_exit": definer(
        f"  RAISE NOTICE 'starting';\n  PERFORM {OUTER}(p_org);"
    ),
}


# F. Body attribution. `extract_function_body_span` looked FORWARD from the
#    CREATE for the first `AS $tag$`, so a definition with no dollar-quoted body
#    of its own swallowed the NEXT function's - and with it the next function's
#    guard. A definition is now bounded by its own statement, and a SECURITY
#    DEFINER routine the scanner cannot read a body from is rejected rather than
#    given someone else's.
GUARDED_NEXT = (
    # Scanner fixture only: written to a temporary file, never executed as SQL.
    "CREATE OR REPLACE FUNCTION public.f_guarded(p_org uuid)\n"  # nosec B608
    "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\n"
    "SET search_path TO 'public', 'pg_temp'\n"
    "AS $guarded$\nBEGIN\n"
    f"  PERFORM {OUTER}(p_org);\n"
    "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
    "END;\n$guarded$;\n"
)

BODY_ATTRIBUTION_MUST_REJECT = {
    "unreadable_body_borrows_the_next_guard": (
        "CREATE OR REPLACE FUNCTION public.f_unreadable(p_org uuid)\n"
        "RETURNS void\nLANGUAGE internal\nSECURITY DEFINER\nAS 'boolin';\n"
        + GUARDED_NEXT
    ),
    "sql_standard_body_is_not_readable": (
        # Scanner fixture only; concatenation tests body attribution, not DB execution.
        "CREATE OR REPLACE FUNCTION public.f_atomic(p_org uuid)\n"  # nosec B608
        "RETURNS void\nLANGUAGE sql\nSECURITY DEFINER\n"
        "BEGIN ATOMIC\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "END;\n"
        + GUARDED_NEXT
    ),
}


# G. Privilege attribution. The exemption was a blanket
#    `REVOKE ... FROM PUBLIC` anywhere before the next CREATE: it never checked
#    that the statement named THIS function, and never noticed a later GRANT
#    putting the grant back. It is now an ACL replay against this identity.
def closed(name: str = "f_c") -> str:
    return (
        f"REVOKE EXECUTE ON FUNCTION public.{name}(uuid) "
        "FROM PUBLIC, anon, authenticated;\n"
    )


REVOKE_ATTRIBUTION_MUST_REJECT = {
    "revoke_names_another_function": definer("  PERFORM 1;", name="f_c")
    + closed("f_somewhere_else"),
    "revoke_names_another_overload": definer("  PERFORM 1;", name="f_c")
    + "REVOKE EXECUTE ON FUNCTION public.f_c(text) FROM PUBLIC, anon, authenticated;\n",
    "grant_to_public_reopens_the_revoke": definer("  PERFORM 1;", name="f_c")
    + closed()
    + "GRANT EXECUTE ON FUNCTION public.f_c(uuid) TO PUBLIC;\n",
    # Controls, not closures: the old window started at the definition so an
    # earlier REVOKE was never in it, and the old pattern required ON FUNCTION so
    # ON ALL FUNCTIONS IN SCHEMA never matched. Both were already rejected; both
    # are kept because the identity rewrite could easily have started crediting
    # them, and neither should ever be credited.
    "revoke_precedes_the_definition": closed() + definer("  PERFORM 1;", name="f_c"),
    "all_functions_in_schema_is_not_attribution": definer("  PERFORM 1;", name="f_c")
    + "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;\n",
    "closing_public_while_granting_authenticated": definer("  PERFORM 1;", name="f_c")
    + "REVOKE EXECUTE ON FUNCTION public.f_c(uuid) FROM PUBLIC, anon;\n"
    + "GRANT EXECUTE ON FUNCTION public.f_c(uuid) TO authenticated;\n",
}

REVOKE_ATTRIBUTION_MUST_ACCEPT = {
    "named_closure_of_this_identity": definer("  PERFORM 1;", name="f_c") + closed(),
    "closure_split_over_lines": definer("  PERFORM 1;", name="f_c")
    + "REVOKE EXECUTE\n  ON FUNCTION public.f_c(uuid)\n"
      "  FROM PUBLIC, anon, authenticated;\n",
    "closure_with_all_privileges": definer("  PERFORM 1;", name="f_c")
    + "REVOKE ALL PRIVILEGES ON FUNCTION public.f_c(uuid) "
      "FROM PUBLIC, anon, authenticated;\n",
    "closure_naming_parameter_names": definer("  PERFORM 1;", name="f_c")
    + "REVOKE EXECUTE ON FUNCTION public.f_c(p_org uuid) "
      "FROM PUBLIC, anon, authenticated;\n",
    "closure_listing_several_targets": definer("  PERFORM 1;", name="f_a")
    + definer("  PERFORM 1;", name="f_b")
    + "REVOKE EXECUTE ON FUNCTION public.f_a(uuid), public.f_b(uuid)\n"
      "  FROM PUBLIC, anon, authenticated;\n",
    "grant_to_service_role_is_not_a_reopen": definer("  PERFORM 1;", name="f_c")
    + closed()
    + "GRANT EXECUTE ON FUNCTION public.f_c(uuid) TO service_role;\n",
}


# H. `ALTER FUNCTION ... SECURITY DEFINER` makes an existing function run as its
#    owner while restating nothing, so there is no body to read a guard from. The
#    positional scan blamed the occurrence on whatever CREATE preceded it - or,
#    with none before it, dropped it entirely.
ALTER_DEFINER_MUST_REJECT = {
    "alter_alone_in_the_migration": (
        "ALTER FUNCTION public.f_legacy(uuid) SECURITY DEFINER;\n"
    ),
    "alter_borrows_an_earlier_guard": GUARDED_NEXT
    + "ALTER FUNCTION public.f_legacy(uuid) SECURITY DEFINER;\n",
    "alter_then_regrant_to_public": (
        "ALTER FUNCTION public.f_legacy(uuid) SECURITY DEFINER;\n"
        "REVOKE EXECUTE ON FUNCTION public.f_legacy(uuid) "
        "FROM PUBLIC, anon, authenticated;\n"
        "GRANT EXECUTE ON FUNCTION public.f_legacy(uuid) TO PUBLIC;\n"
    ),
}

ALTER_DEFINER_MUST_ACCEPT = {
    "alter_to_security_invoker_is_not_a_finding": GUARDED_NEXT
    + "ALTER FUNCTION public.calculate_planned_load(uuid, date, date) "
      "SECURITY INVOKER;\n",
    "alter_of_a_function_defined_and_guarded_here": GUARDED_NEXT
    + "ALTER FUNCTION public.f_guarded(uuid) SECURITY DEFINER;\n",
    "alter_with_a_named_closure": (
        "ALTER FUNCTION public.f_legacy(uuid) SECURITY DEFINER;\n"
        "REVOKE EXECUTE ON FUNCTION public.f_legacy(uuid) "
        "FROM PUBLIC, anon, authenticated;\n"
    ),
}


# I. Identity. `DEFINER_FUNC_RE` read `(?:public\.)?(\w+)` off the MASKED text,
#    where a quoted identifier's content is blanked by design. A quoted identity
#    therefore matched no CREATE at all: its SECURITY DEFINER was attributed to
#    an earlier function or dropped. Case is part of the identity too - a quoted
#    "HAS_PERMISSION" is not `has_permission` and must not inherit its
#    exemption - and neither is another schema's same-named function.
def quoted_definer(header: str) -> str:
    return (
        # Test-owned header: this SQL is input to check_file(), never a DB driver.
        f"{header}\n"  # nosec B608
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\n"
        "SET search_path TO 'public', 'pg_temp'\n"
        "AS $q$\nBEGIN\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "END;\n$q$;\n"
    )


# The security mode itself. parse_definitions() decides `is_definer` from the
# statement's HEADER and its TRAILER while excluding the dollar-quoted body, so
# that a `SECURITY DEFINER` written in the body's own text cannot make an INVOKER
# function look like a definer, and an options clause placed AFTER the body is
# still seen. Both directions are load-bearing and neither had a control: only
# the fact that many other fixtures would fail protected them.
SECURITY_MODE_MUST_REJECT = {
    # Options may follow the AS clause, so a definer declared there is real.
    "definer_declared_after_the_body": (
        "CREATE OR REPLACE FUNCTION public.f_trailer(p_org uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\n"
        "AS $t$\nBEGIN\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "END;\n$t$\n"
        "SECURITY DEFINER;\n"
    ),
}

SECURITY_MODE_MUST_ACCEPT = {
    # An unguarded SECURITY INVOKER function is not this scanner's business.
    "invoker_function_is_not_scanned": (
        "CREATE OR REPLACE FUNCTION public.f_invoker(p_org uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY INVOKER\n"
        "AS $i$\nBEGIN\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "END;\n$i$;\n"
    ),
    # Neither is one that simply omits the clause - INVOKER is the default.
    "function_with_no_security_clause_is_not_scanned": (
        "CREATE OR REPLACE FUNCTION public.f_default(p_org uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\n"
        "AS $d$\nBEGIN\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "END;\n$d$;\n"
    ),
    # A body that merely MENTIONS the phrase does not make the function a
    # definer. Two layers hold this and the test does not claim otherwise: the
    # masker blanks the literal's content first, and is_definer excludes the body
    # span second. Verified: the phrase is already absent from the masked body,
    # so this fixture evidences the combined behaviour, not the span exclusion on
    # its own - that one is evidenced by definer_declared_after_the_body, which
    # only passes because the TRAILER is read.
    "the_phrase_inside_the_body_is_not_a_clause": (
        "CREATE OR REPLACE FUNCTION public.f_mentions(p_org uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY INVOKER\n"
        "AS $m$\nBEGIN\n"
        "  RAISE NOTICE 'this RPC is deliberately not SECURITY DEFINER';\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "END;\n$m$;\n"
    ),
}


QUOTED_IDENTITY_MUST_REJECT = {
    "quoted_function_name": quoted_definer(
        'CREATE OR REPLACE FUNCTION public."f_quoted"(p_org uuid)'
    ),
    "quoted_schema_and_name": quoted_definer(
        'CREATE OR REPLACE FUNCTION "public"."f_quoted"(p_org uuid)'
    ),
    "quoted_after_a_guarded_function": GUARDED_NEXT
    + quoted_definer('CREATE OR REPLACE FUNCTION public."f_quoted"(p_org uuid)'),
    "quoted_uppercase_impersonates_an_exempt_name": quoted_definer(
        'CREATE OR REPLACE FUNCTION public."HAS_PERMISSION"(p_org uuid)'
    ),
    "another_schema_same_name": quoted_definer(
        "CREATE OR REPLACE FUNCTION other_schema.f_elsewhere(p_org uuid)"
    ),
}


# J. Overload impersonation. KNOWN_EXEMPT is keyed by bare NAME, so under the
#    strict contract a brand-new overload of an exempt name would inherit an
#    exemption written for a different function; and a recognized guard call is
#    matched by name, so a locally declared no-op overload of that name would
#    satisfy the gate through the same match as the real helper.
OVERLOAD_IMPERSONATION_MUST_REJECT = {
    "new_overload_of_an_exempt_name": quoted_definer(
        "CREATE OR REPLACE FUNCTION public.has_permission(p_org uuid)"
    ),
    "migration_redefines_the_guard_it_leans_on": (
        "CREATE OR REPLACE FUNCTION public.wardah_assert_org_member(p_org text)\n"
        "RETURNS void\nLANGUAGE plpgsql\nAS $shadow$\nBEGIN\n  NULL;\nEND;\n$shadow$;\n"
        + GUARDED_NEXT
    ),
    "guard_called_with_the_wrong_arity": definer(f"  PERFORM {OUTER}();"),
    "guard_called_with_too_many_arguments": definer(
        f"  PERFORM {OUTER}(p_org, p_org);"
    ),
    "boolean_predicate_called_with_the_wrong_arity": definer(
        f"  IF NOT {QPRED}(p_org, p_org) THEN\n    RAISE EXCEPTION 'D';\n  END IF;"
    ),
}


# ---------------------------------------------------------------------------
# Codex findings K-O: the second hardening pass
# ---------------------------------------------------------------------------
# Every fixture below was run through the REAL check_file() at 97eb585 - after
# the first hardening pass - and returned [] there, except where a row is marked
# a control. Two of them were regressions the first pass itself introduced, and
# they are called out as such rather than presented as pre-existing.


def routine(name: str, mode: str, body: str = WORK_LINE, args: str = "p_org uuid") -> str:
    """A function whose declared security mode is exactly `mode`."""
    return (
        f"CREATE OR REPLACE FUNCTION public.{name}({args})\n"
        f"RETURNS void\nLANGUAGE plpgsql\n{mode}\n"
        f"AS ${name}$\nBEGIN\n{body}\nEND;\n${name}$;\n"
    )


# K. Security mode is a STATE, not a property of the CREATE statement.
#    PostgreSQL lets ALTER FUNCTION change it afterwards, and the first pass
#    modelled only half of that: a promotion of a function defined in the SAME
#    file was skipped with the comment "its CREATE was checked above" - but when
#    that CREATE is SECURITY INVOKER, nothing checks it, because an invoker
#    function is not this scanner's business. The result was a privileged,
#    unguarded, client-callable function passing with no error at all. This is a
#    regression the identity rewrite introduced, not a pre-existing gap.
SECURITY_STATE_MUST_REJECT = {
    "invoker_promoted_by_a_later_alter": (
        routine("f_promoted", "SECURITY INVOKER")
        + "ALTER FUNCTION public.f_promoted(uuid) SECURITY DEFINER;\n"
    ),
    "default_mode_promoted_by_a_later_alter": (
        "CREATE OR REPLACE FUNCTION public.f_default(p_org uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\nAS $d$\nBEGIN\n"
        f"{WORK_LINE}\nEND;\n$d$;\n"
        + "ALTER FUNCTION public.f_default(uuid) SECURITY DEFINER;\n"
    ),
    # The promotion still counts when the ALTER is the last statement and the
    # closure names a DIFFERENT overload.
    "promotion_with_a_closure_on_another_overload": (
        routine("f_promoted", "SECURITY INVOKER")
        + "REVOKE EXECUTE ON FUNCTION public.f_promoted(text) "
          "FROM PUBLIC, anon, authenticated;\n"
        + "ALTER FUNCTION public.f_promoted(uuid) SECURITY DEFINER;\n"
    ),
}

SECURITY_STATE_MUST_ACCEPT = {
    # The mirror regression: a definer DEMOTED in the same file ends the
    # migration unprivileged, so there is nothing to guard. The first pass
    # judged the declared mode and reported it.
    "definer_demoted_by_a_later_alter": (
        routine("f_demoted", "SECURITY DEFINER")
        + "ALTER FUNCTION public.f_demoted(uuid) SECURITY INVOKER;\n"
    ),
    # A promotion followed by a real closure is still a closure.
    "promotion_closed_to_every_client": (
        routine("f_promoted", "SECURITY INVOKER")
        + "ALTER FUNCTION public.f_promoted(uuid) SECURITY DEFINER;\n"
        + "REVOKE EXECUTE ON FUNCTION public.f_promoted(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # A promotion of a function that IS defined and guarded here.
    "promotion_of_a_guarded_definition": (
        routine(
            "f_guarded",
            "SECURITY DEFINER",
            body=f"  PERFORM {OUTER}(p_org);\n{WORK_LINE}",
        )
        + "ALTER FUNCTION public.f_guarded(uuid) SECURITY DEFINER;\n"
    ),
    # An ALTER that precedes the CREATE does not decide the CREATE's state: the
    # CREATE is the later statement and wins.
    "alter_before_the_create_does_not_demote_it": (
        "ALTER FUNCTION public.f_late(uuid) SECURITY INVOKER;\n"
        + routine(
            "f_late",
            "SECURITY DEFINER",
            body=f"  PERFORM {OUTER}(p_org);\n{WORK_LINE}",
        )
    ),
}


# L. SQLSTATE values were read at the wrong offset inside an OR list. Masking
#    blanks literal CONTENT but keeps the delimiters, so two SQLSTATE terms in
#    one condition mask to textually IDENTICAL text; the term's offset was then
#    recovered with str.index(), which returns the FIRST match. The second term
#    was therefore read out of the first term's raw bytes - so a handler that
#    really catches P0001 could be read as catching something else.
SQLSTATE_OFFSET_MUST_REJECT = {
    "catching_sqlstate_is_the_second_or_term": definer_outer_handler(
        "SQLSTATE 'P0002' OR SQLSTATE 'P0001'"
    ),
    "catching_sqlstate_is_the_third_or_term": definer_outer_handler(
        "SQLSTATE 'P0002' OR SQLSTATE 'P0003' OR SQLSTATE 'P0000'"
    ),
    "catching_sqlstate_after_a_named_condition": definer_outer_handler(
        "unique_violation OR SQLSTATE 'P0002' OR SQLSTATE 'P0001'"
    ),
}

SQLSTATE_OFFSET_MUST_ACCEPT = {
    # None of these codes can catch P0001; reading any of them at the wrong
    # offset would have produced a false red instead.
    "no_or_term_catches": definer_outer_handler(
        "SQLSTATE 'P0002' OR SQLSTATE 'P0003'"
    ),
    "repeated_identical_non_catching_codes": definer_outer_handler(
        "SQLSTATE '23505' OR SQLSTATE '23505'"
    ),
}


# M. GRANT/REVOKE grantees were scanned on MASKED text, where a quoted
#    identifier's content is blanked - so `GRANT ... TO "authenticated"` named no
#    grantee at all and the re-open was invisible while the closure still looked
#    intact. Grantees are read from RAW now, quoted and unquoted alike.
QUOTED_GRANTEE_MUST_REJECT = {
    "quoted_authenticated_regrant": (
        routine("f_c", "SECURITY DEFINER")
        + "REVOKE EXECUTE ON FUNCTION public.f_c(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
        + 'GRANT EXECUTE ON FUNCTION public.f_c(uuid) TO "authenticated";\n'
    ),
    "quoted_anon_regrant": (
        routine("f_c", "SECURITY DEFINER")
        + "REVOKE EXECUTE ON FUNCTION public.f_c(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
        + 'GRANT EXECUTE ON FUNCTION public.f_c(uuid) TO "anon";\n'
    ),
    "quoted_public_regrant": (
        routine("f_c", "SECURITY DEFINER")
        + "REVOKE EXECUTE ON FUNCTION public.f_c(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
        + 'GRANT EXECUTE ON FUNCTION public.f_c(uuid) TO "public";\n'
    ),
}

QUOTED_GRANTEE_MUST_ACCEPT = {
    # A quoted closure is a closure: the content matches the folded role name.
    "quoted_grantees_in_the_revoke": (
        routine("f_c", "SECURITY DEFINER")
        + 'REVOKE EXECUTE ON FUNCTION public.f_c(uuid) '
          'FROM PUBLIC, "anon", "authenticated";\n'
    ),
    # service_role is not a client role, quoted or not.
    "quoted_service_role_is_not_a_client": (
        routine("f_c", "SECURITY DEFINER")
        + "REVOKE EXECUTE ON FUNCTION public.f_c(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
        + 'GRANT EXECUTE ON FUNCTION public.f_c(uuid) TO "service_role";\n'
    ),
}


# N. A quoted TYPE name is part of the identity, and masking blanks it. Two
#    overloads taking public."TypeA" and public."TypeB" normalized to the same
#    signature, so a REVOKE naming one credited the other. Argument lists are
#    read from RAW now and folded everywhere EXCEPT inside quotes.
QUOTED_TYPE_MUST_REJECT = {
    "quoted_type_overloads_must_not_collapse": (
        routine("f_t", "SECURITY DEFINER", args='p_x public."TypeA"')
        + routine("f_t", "SECURITY DEFINER", args='p_x public."TypeB"')
        + 'REVOKE EXECUTE ON FUNCTION public.f_t(public."TypeA")\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    "quoted_type_is_not_its_unquoted_spelling": (
        routine("f_t", "SECURITY DEFINER", args='p_x public."TypeA"')
        + "REVOKE EXECUTE ON FUNCTION public.f_t(public.typea) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
}

QUOTED_TYPE_MUST_ACCEPT = {
    "matching_quoted_type_closes_it": (
        routine("f_t", "SECURITY DEFINER", args='p_x public."TypeA"')
        + 'REVOKE EXECUTE ON FUNCTION public.f_t(public."TypeA") '
          "FROM PUBLIC, anon, authenticated;\n"
    ),
}


# O. An omitted schema is resolved by PostgreSQL through search_path; it is not
#    a wildcard. Treating it as matching any schema let a REVOKE with no schema
#    exempt a SECURITY DEFINER function in a DIFFERENT schema.
OMITTED_SCHEMA_MUST_REJECT = {
    "unqualified_revoke_does_not_reach_another_schema": (
        "CREATE OR REPLACE FUNCTION other_schema.f_s(p_org uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\nAS $s$\nBEGIN\n"
        f"{WORK_LINE}\nEND;\n$s$;\n"
        + "REVOKE EXECUTE ON FUNCTION f_s(uuid) FROM PUBLIC, anon, authenticated;\n"
    ),
    "qualified_revoke_does_not_reach_another_schema": (
        "CREATE OR REPLACE FUNCTION other_schema.f_d(p_org uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\nAS $a$\nBEGIN\n"
        f"{WORK_LINE}\nEND;\n$a$;\n"
        + routine("f_d", "SECURITY DEFINER")
        + "REVOKE EXECUTE ON FUNCTION public.f_d(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
}

OMITTED_SCHEMA_MUST_ACCEPT = {
    # Both sides resolve to public, so the closure is real.
    "unqualified_revoke_closes_a_public_definition": (
        routine("f_p", "SECURITY DEFINER")
        + "REVOKE EXECUTE ON FUNCTION f_p(uuid) FROM PUBLIC, anon, authenticated;\n"
    ),
    "qualified_revoke_closes_an_unqualified_definition": (
        "CREATE OR REPLACE FUNCTION f_u(p_org uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\nAS $u$\nBEGIN\n"
        f"{WORK_LINE}\nEND;\n$u$;\n"
        + "REVOKE EXECUTE ON FUNCTION public.f_u(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
}


# ---------------------------------------------------------------------------
# Final-review P2-B: REVOKE GRANT OPTION FOR EXECUTE is not a closure
# ---------------------------------------------------------------------------
# Reproduced through the real check_file() at 337965b, where every fixture in
# GRANT_OPTION_MUST_REJECT returned []. _REVOKE_HEAD_RE already TOLERATED the
# optional `GRANT OPTION FOR` clause — which is how the statement parsed at all
# and how its privilege list read `EXECUTE` — but the parse then collapsed into
# `is_revoke=True`, indistinguishable from a real revoke. The ACL replay closed
# the executable surface on the strength of a statement that withdraws only the
# right to RE-GRANT execute: `authenticated` keeps EXECUTE and can still call
# the unguarded SECURITY DEFINER function.
GRANT_OPTION_MUST_REJECT = {
    "grant_option_revoke_does_not_close_the_default_public_grant": (
        routine("f_go", "SECURITY DEFINER")
        + "REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.f_go(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    "grant_option_revoke_leaves_an_explicit_grant_standing": (
        routine("f_go2", "SECURITY DEFINER")
        + "GRANT EXECUTE ON FUNCTION public.f_go2(uuid) TO authenticated;\n"
        + "REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.f_go2(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # ALL is the same statement with a wider privilege list, and just as
    # ineffective when it is only the grant option being withdrawn.
    "grant_option_revoke_of_all_privileges": (
        routine("f_go3", "SECURITY DEFINER")
        + "REVOKE GRANT OPTION FOR ALL ON FUNCTION public.f_go3(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # Ordering: a real closure, re-opened by a later GRANT, is NOT re-closed by
    # a grant-option-only revoke. `authenticated` ends the migration holding
    # EXECUTE.
    "grant_option_revoke_cannot_re_close_a_later_grant": (
        routine("f_go4", "SECURITY DEFINER")
        + "REVOKE EXECUTE ON FUNCTION public.f_go4(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
        + "GRANT EXECUTE ON FUNCTION public.f_go4(uuid) TO authenticated;\n"
        + "REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.f_go4(uuid) "
          "FROM authenticated;\n"
    ),
    # A quoted grantee resolves to the same role, so it must not close either.
    "grant_option_revoke_with_a_quoted_grantee": (
        routine("f_go5", "SECURITY DEFINER")
        + 'REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.f_go5(uuid) '
          'FROM PUBLIC, anon, "authenticated";\n'
    ),
}

GRANT_OPTION_MUST_ACCEPT = {
    # The real statement still closes exactly as before.
    "real_revoke_execute_still_closes": (
        routine("f_ok", "SECURITY DEFINER")
        + "REVOKE EXECUTE ON FUNCTION public.f_ok(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # A grant-option-only revoke after a real closure changes nothing: the
    # correction must not turn it into a re-opening either.
    "grant_option_revoke_after_a_real_closure_keeps_it_closed": (
        routine("f_ok2", "SECURITY DEFINER")
        + "REVOKE EXECUTE ON FUNCTION public.f_ok2(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
        + "REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.f_ok2(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # `WITH GRANT OPTION` on a GRANT is a trailer, not a second statement; the
    # real revoke that follows still closes the surface.
    "grant_with_grant_option_then_real_revoke": (
        routine("f_ok3", "SECURITY DEFINER")
        + "GRANT EXECUTE ON FUNCTION public.f_ok3(uuid) TO authenticated "
          "WITH GRANT OPTION;\n"
        + "REVOKE EXECUTE ON FUNCTION public.f_ok3(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
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

    def test_guard_after_a_terminating_return_is_rejected(self) -> None:
        """Finding 6: an assertion past an exit is dead on at least one path."""
        for name, sql in RETURN_BEFORE_GUARD_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: guard after a terminating RETURN accepted",
                )

    def test_return_next_and_query_are_not_exits(self) -> None:
        """They continue a set-returning function, so they must not disqualify."""
        self.assertFalse(
            guards.terminating_return_before("RETURN NEXT r; PERFORM x", 40)
        )
        self.assertFalse(
            guards.terminating_return_before("RETURN QUERY SELECT 1; PERFORM x", 40)
        )
        self.assertTrue(guards.terminating_return_before("RETURN; PERFORM x", 40))
        self.assertTrue(guards.terminating_return_before("RETURN 1; PERFORM x", 40))
        # `RETURNS` in the function header is not a RETURN statement.
        self.assertFalse(
            guards.terminating_return_before("RETURNS void LANGUAGE plpgsql", 40)
        )

    def test_return_rule_is_strict_contract_only(self) -> None:
        """<= cutoff keeps its validated compatibility for placement."""
        sql = RETURN_BEFORE_GUARD_MUST_REJECT["bare_return_before_guard"]
        historical = self.root / "150_return_probe.sql"
        historical.write_text(sql, encoding="utf-8")
        self.assertEqual(guards.check_file(historical), [])
        strict = self.root / f"{guards.MIGRATION_STRICT_CUTOFF}_return_probe.sql"
        strict.write_text(sql, encoding="utf-8")
        self.assertTrue(guards.check_file(strict))

    def test_astra_findings_are_rejected(self) -> None:
        """SQLSTATE swallowing, non-executing calls, unreachable denial."""
        for name, sql in ASTRA_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: non-authorizing guard accepted",
                )

    def test_sqlstate_p0001_is_detected_despite_masking(self) -> None:
        """A: the condition lives in a literal the masker necessarily blanks."""
        sql = ASTRA_MUST_REJECT["outer_assert_caught_by_sqlstate_p0001"]
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        # Proof the masked text alone cannot see it, so recovery is required.
        self.assertNotIn("P0001", masked)
        self.assertIn("P0001", sql)
        self.assertTrue(self.verdict("sqlstate_probe", sql))

    def test_standalone_perform_contract(self) -> None:
        """B: the assertion statement itself, independent of check_file()."""
        for text in (
            f"PERFORM {OUTER}(p_org) WHERE false;",
            f"SELECT {OUTER}(p_org);",
            f"SELECT {OUTER}(p_org) WHERE false;",
            f"v_ok := {OUTER}(p_org);",
            f"PERFORM {OUTER}(p_org) FROM t;",
        ):
            m = guards.GUARD_RE.search(text)
            self.assertIsNotNone(m, text)
            with self.subTest(reject=text):
                self.assertFalse(
                    guards.is_standalone_perform_assertion(text, m), text
                )
        for text in (
            f"PERFORM {OUTER}(p_org);",
            "PERFORM wardah_assert_org_admin(p_org);",
            f"  PERFORM  {OUTER} ( p_org ) ;",
            "PERFORM wardah_178_assert_permission(p_org, 'k');",
        ):
            m = guards.GUARD_RE.search(text)
            self.assertIsNotNone(m, text)
            with self.subTest(accept=text):
                self.assertTrue(
                    guards.is_standalone_perform_assertion(text, m), text
                )

    def test_deny_branch_raise_must_be_reachable(self) -> None:
        """C: a RETURN between THEN and the RAISE disqualifies the block."""
        reachable = (
            f"IF NOT {QPRED}(v_org) THEN RAISE EXCEPTION 'D'; END IF;"
        )
        self.assertTrue(guards.has_negated_raising_predicate(reachable))
        unreachable = (
            f"IF NOT {QPRED}(v_org) THEN RETURN; RAISE EXCEPTION 'D'; END IF;"
        )
        self.assertFalse(guards.has_negated_raising_predicate(unreachable))

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

    # -- Astra findings D-I -------------------------------------------------

    def test_exception_categories_that_catch_p0001_are_rejected(self) -> None:
        """D: P0001 is caught by its own code AND by its class code P0000."""
        for name, sql in EXCEPTION_CATEGORY_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: the denial is swallowed by this handler",
                )

    def test_unrelated_exception_conditions_do_not_false_red(self) -> None:
        """D: a condition that cannot catch P0001 must not cost a real guard."""
        for name, sql in EXCEPTION_CATEGORY_MUST_ACCEPT.items():
            with self.subTest(case=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_condition_resolver_discriminates(self) -> None:
        """D: the resolver itself, independent of check_file()."""
        def catches(condition: str) -> bool:
            masked, problems = guards.mask_sql_checked(f"WHEN {condition} THEN")
            self.assertEqual(problems, [])
            raw = f"WHEN {condition} THEN"
            spans = guards._handler_condition_spans(masked, 0, len(masked))
            return any(
                guards._condition_catches_p0001(masked, raw, s, e) for s, e in spans
            )

        for condition in (
            "OTHERS",
            "raise_exception",
            "plpgsql_error",
            "SQLSTATE 'P0001'",
            "SQLSTATE 'P0000'",
            "SQLSTATE /* why */ 'P0001'",
            "unique_violation OR plpgsql_error",
        ):
            with self.subTest(catches=condition):
                self.assertTrue(catches(condition), condition)
        for condition in (
            "unique_violation",
            "foreign_key_violation",
            "data_exception",
            "SQLSTATE '23505'",
            "no_data_found",
        ):
            with self.subTest(passes=condition):
                self.assertFalse(catches(condition), condition)

    def test_guard_after_an_outer_level_abort_is_rejected(self) -> None:
        """E: an aborting RAISE at outer level ends the invocation."""
        for name, sql in UNREACHABLE_ABORT_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in UNREACHABLE_ABORT_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_abort_rule_is_strict_contract_only(self) -> None:
        """E: historical migrations keep their validated placement."""
        sql = UNREACHABLE_ABORT_MUST_REJECT["guard_after_outer_level_raise"]
        historical = self.root / "150_abort.sql"
        historical.write_text(sql, encoding="utf-8")
        self.assertEqual(guards.check_file(historical), [])
        strict = self.root / f"{guards.MIGRATION_STRICT_CUTOFF}_abort.sql"
        strict.write_text(sql, encoding="utf-8")
        self.assertTrue(guards.check_file(strict))

    # -- Final-review P2-A: labelled EXIT ------------------------------------

    def test_labelled_exit_past_a_guard_is_rejected(self) -> None:
        """P2-A: `EXIT <label>` leaves the block, skipping the assertion."""
        for name, sql in LABELLED_EXIT_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: guard skipped by a labelled EXIT accepted",
                )

    def test_labelled_exit_rule_discriminates(self) -> None:
        """The jump must cross the candidate's own block, and nothing else."""
        body = (
            "<<auth_block>>\nBEGIN\n"
            "  EXIT auth_block;\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            "END auth_block;\n"
        )
        frames = guards.parse_blocks(body)
        guard_pos = body.index("PERFORM")
        self.assertTrue(guards.labelled_exit_before(body, frames, guard_pos))
        # The label must be the one on the block that CONTAINS the position.
        other = body.replace("EXIT auth_block;", "EXIT some_other_block;")
        self.assertFalse(
            guards.labelled_exit_before(
                other, guards.parse_blocks(other), other.index("PERFORM")
            )
        )
        # An EXIT after the candidate cannot skip it.
        after = (
            "<<auth_block>>\nBEGIN\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            "  EXIT auth_block;\n"
            "END auth_block;\n"
        )
        self.assertFalse(
            guards.labelled_exit_before(
                after, guards.parse_blocks(after), after.index("PERFORM")
            )
        )
        # `EXIT WHEN <predicate>` carries no label at all.
        unlabelled = "BEGIN\n  EXIT WHEN p_x;\n  PERFORM g(p_org);\nEND;\n"
        self.assertFalse(
            guards.labelled_exit_before(
                unlabelled,
                guards.parse_blocks(unlabelled),
                unlabelled.index("PERFORM"),
            )
        )

    def test_labelled_exit_survives_a_declare_section(self) -> None:
        """P2-A round 2: the label precedes DECLARE, not BEGIN."""
        for name, sql in LABELLED_EXIT_DECLARE_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: labelled EXIT lost because of a DECLARE section",
                )

    def test_labelled_exit_reads_quoted_and_non_ascii_labels(self) -> None:
        """P2-A round 2: a label is an identifier, not an ASCII word."""
        for name, sql in LABELLED_EXIT_IDENTIFIER_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: labelled EXIT lost because of the label's spelling",
                )

    def test_truncated_identifiers_cannot_hide_a_labelled_exit(self) -> None:
        """P2-C: PostgreSQL clips identifiers to 63 bytes, so labels that differ
        only past the limit are one label and the jump is real.

        End-to-end through check_file(), not the canonicalizer alone.
        """
        for name, sql in LABELLED_EXIT_TRUNCATION_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: labels collide once PostgreSQL clips them",
                )
        for name, sql in LABELLED_EXIT_TRUNCATION_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_effective_identifier_matches_postgresql_clipping(self) -> None:
        """The canonicalizer itself: NAMEDATALEN-1 bytes, character-aligned."""
        eff = guards._effective_identifier
        # Exactly at the limit: untouched.
        at_limit = "a" * 63
        self.assertEqual(eff(at_limit), at_limit)
        self.assertEqual(len(eff(at_limit).encode("utf-8")), 63)
        # Over the limit in ASCII: clipped to 63 bytes.
        self.assertEqual(eff("a" * 64), at_limit)
        self.assertEqual(eff("a" * 200), at_limit)
        # The limit is BYTES, not characters: 32 two-byte characters overflow.
        mb = "م" * 32
        self.assertEqual(len(mb), 32)
        self.assertEqual(len(mb.encode("utf-8")), 64)
        clipped = eff(mb)
        # Clipped on a character boundary - never a partial code point.
        self.assertEqual(clipped, "م" * 31)
        self.assertLessEqual(len(clipped.encode("utf-8")), 63)
        self.assertEqual(clipped.encode("utf-8").decode("utf-8"), clipped)
        # Two identifiers PostgreSQL aliases after clipping normalize EQUAL.
        self.assertEqual(eff("a" * 63 + "X"), eff("a" * 63 + "Y"))
        self.assertEqual(eff(mb + "a"), eff(mb + "b"))
        # Two that differ BEFORE the limit stay distinct.
        self.assertNotEqual(eff("a" * 62 + "X"), eff("a" * 62 + "Y"))
        self.assertNotEqual(eff("alpha_block"), eff("beta_block"))
        # Clipping decides length only; folding and quoting were already
        # applied by the identifier parser, so case is untouched here.
        self.assertEqual(eff("Auth_Block"), "Auth_Block")

    def test_label_identity_follows_postgresql_folding(self) -> None:
        """Unquoted folds, quoted keeps its case, and the two must not be
        conflated in either direction."""
        def jumps(label: str, target: str, declare: str = "") -> bool:
            body = (
                f"<<{label}>>\n{declare}BEGIN\n"
                f"  EXIT {target};\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                f"END;\n"
            )
            frames = guards.parse_blocks(body, body)
            return guards.labelled_exit_before(
                body, frames, body.index("PERFORM"), body
            )

        # Same identifier, spelled four legal ways: all resolve to one label.
        self.assertTrue(jumps("auth_block", "auth_block"))
        self.assertTrue(jumps("auth_block", '"auth_block"'))
        self.assertTrue(jumps('"auth_block"', "auth_block"))
        self.assertTrue(jumps('"auth_block"', '"auth_block"'))
        # An unquoted label folds, so case is irrelevant on the unquoted side.
        self.assertTrue(jumps("Auth_Block", "AUTH_BLOCK"))
        # A quoted label keeps its case, so these are DIFFERENT labels and the
        # jump does not leave that block. Treating them as equal would be a
        # false red; treating a real match as unequal would be a false green.
        self.assertFalse(jumps('"Auth_Block"', "auth_block"))
        self.assertFalse(jumps('"Auth_Block"', '"auth_block"'))
        self.assertFalse(jumps("auth_block", '"Auth_Block"'))
        # Non-ASCII identifiers behave like any other unquoted identifier.
        self.assertTrue(jumps("حارس", "حارس"))
        # And every one of these still holds across a declaration section.
        self.assertTrue(jumps("auth_block", '"auth_block"', DECLARE_SECTION))
        self.assertFalse(jumps('"Auth_Block"', "auth_block", DECLARE_SECTION))

    def test_label_support_discriminates(self) -> None:
        """Mutation proof: removing either half of the round-2 fix must bring
        the corresponding RED back, so these fixtures cannot be passing for an
        unrelated reason."""
        never = re.compile(r"(?!)")
        original_declare = guards._DECLARE_KW_RE
        try:
            guards._DECLARE_KW_RE = never  # drop DECLARE-section support
            for name, sql in LABELLED_EXIT_DECLARE_MUST_REJECT.items():
                with self.subTest(mutation="no_declare_support", case=name):
                    self.assertEqual(
                        self.verdict(name, sql), [],
                        f"{name}: expected the pre-fix false green to return",
                    )
        finally:
            guards._DECLARE_KW_RE = original_declare

        # The identifier work has two halves - the block label and the EXIT
        # target - and the mutation restores the pre-fix ASCII-unquoted reader
        # on BOTH sides. Only the identifier reader is mutated; DECLARE
        # attribution stays intact so the two mutations cannot mask each other.
        #
        # Correcting an imprecise claim made when this test was written: the two
        # halves are NOT symmetric. Reverting only the EXIT-target reader does
        # not reopen these fixtures - an unresolvable target falls through to
        # _UNREADABLE_EXIT_TARGET and fails closed, which still rejects. The
        # BLOCK-LABEL side is the load-bearing half; the EXIT side is what keeps
        # the failure mode closed rather than open. Mutating both together is
        # what actually restores the pre-fix behaviour, which is what this does.
        ascii_exit = re.compile(
            r"\bEXIT\s+(?!WHEN\b)([A-Za-z_][A-Za-z0-9_$]*)", re.IGNORECASE
        )
        ascii_label = re.compile(r"<<\s*([A-Za-z_][A-Za-z0-9_$]*)\s*>>")

        def ascii_exit_targets(body, raw_body, end):
            return [(m.start(), m.group(1).lower())
                    for m in ascii_exit.finditer(body, 0, end)]

        def ascii_block_labels(body, raw_body):
            found = {}
            for m in ascii_label.finditer(body):
                opener = guards._labelled_opener(body, m.end())
                if opener is not None:
                    found[opener] = m.group(1).lower()
            return found

        original_targets = guards._exit_targets
        original_labels = guards._block_labels
        try:
            guards._exit_targets = ascii_exit_targets
            guards._block_labels = ascii_block_labels
            for name, sql in LABELLED_EXIT_IDENTIFIER_MUST_REJECT.items():
                with self.subTest(mutation="ascii_only_labels", case=name):
                    self.assertEqual(
                        self.verdict(name, sql), [],
                        f"{name}: expected the pre-fix false green to return",
                    )
        finally:
            guards._exit_targets = original_targets
            guards._block_labels = original_labels

        # Third half: drop the NAMEDATALEN clip and the truncation collisions
        # become invisible again, because the two labels compare unequal.
        original_effective = guards._effective_identifier
        try:
            guards._effective_identifier = lambda name: name
            for name, sql in LABELLED_EXIT_TRUNCATION_MUST_REJECT.items():
                with self.subTest(mutation="no_identifier_clip", case=name):
                    self.assertEqual(
                        self.verdict(name, sql), [],
                        f"{name}: expected the pre-fix false green to return",
                    )
        finally:
            guards._effective_identifier = original_effective

        # The fixtures reject again once every half is restored.
        for name, sql in {**LABELLED_EXIT_DECLARE_MUST_REJECT,
                          **LABELLED_EXIT_IDENTIFIER_MUST_REJECT,
                          **LABELLED_EXIT_TRUNCATION_MUST_REJECT}.items():
            with self.subTest(restored=name):
                self.assertTrue(self.verdict(name, sql), name)

    def test_only_blocks_and_loops_take_a_label(self) -> None:
        """PL/pgSQL labels blocks and loops; CASE and IF are not label targets,
        and the parser must not invent one for them."""
        body = (
            "<<auth_block>>\nBEGIN\n"
            "  CASE WHEN p_org IS NULL THEN NULL ELSE NULL END CASE;\n"
            "  EXIT auth_block;\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            "END auth_block;\n"
        )
        frames = guards.parse_blocks(body, body)
        labelled = {f.kind for f in frames if f.label == "auth_block"}
        self.assertEqual(labelled, {"BEGIN"})
        self.assertTrue(
            guards.labelled_exit_before(body, frames, body.index("PERFORM"), body)
        )

    def test_labelled_exit_rule_is_strict_contract_only(self) -> None:
        """P2-A: historical migrations keep their validated placement."""
        sql = LABELLED_EXIT_MUST_REJECT["labelled_exit_before_guard"]
        historical = self.root / "150_labelled_exit.sql"
        historical.write_text(sql, encoding="utf-8")
        self.assertEqual(guards.check_file(historical), [])
        strict = self.root / f"{guards.MIGRATION_STRICT_CUTOFF}_labelled_exit.sql"
        strict.write_text(sql, encoding="utf-8")
        self.assertTrue(guards.check_file(strict))

    # -- Final-review P2-B: REVOKE GRANT OPTION FOR --------------------------

    def test_grant_option_revoke_is_not_a_closure(self) -> None:
        """P2-B: withdrawing delegation leaves EXECUTE, and the surface, open."""
        for name, sql in GRANT_OPTION_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: grant-option-only revoke accepted as a closure",
                )
        for name, sql in GRANT_OPTION_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_grant_option_only_is_modelled_on_the_statement(self) -> None:
        """P2-B: the distinction is carried, not re-derived at each use site."""
        sql = (
            "REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.f(uuid) "
            "FROM authenticated;\n"
            "REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM authenticated;\n"
            "GRANT EXECUTE ON FUNCTION public.f(uuid) TO authenticated "
            "WITH GRANT OPTION;\n"
        )
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        stmts = sorted(
            guards.parse_privilege_statements(sql, masked), key=lambda s: s.start
        )
        # Exactly three statements: the `GRANT OPTION FOR` clause inside the
        # first REVOKE is part of that revoke, not a fourth (phantom) GRANT.
        self.assertEqual(
            [(s.is_revoke, s.grant_option_only) for s in stmts],
            [(True, True), (True, False), (False, False)],
        )
        # `WITH GRANT OPTION` is a trailer on a GRANT, never a revoke of one.
        self.assertFalse(stmts[2].is_revoke)
        self.assertEqual(stmts[2].grantees & set(guards.CLIENT_ROLES),
                         {"authenticated"})

    def test_a_definition_cannot_borrow_the_next_functions_body(self) -> None:
        """F: no dollar-quoted body of its own means no guard, at any age."""
        for name, sql in BODY_ATTRIBUTION_MUST_REJECT.items():
            for number in (150, guards.MIGRATION_STRICT_CUTOFF):
                path = self.root / f"{number}_{name}.sql"
                path.write_text(sql, encoding="utf-8")
                with self.subTest(case=name, migration=number):
                    self.assertTrue(guards.check_file(path), name)

    def test_revoke_must_name_the_function_it_exempts(self) -> None:
        """G: attribution by identity, and the closure must survive the file."""
        for name, sql in REVOKE_ATTRIBUTION_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in REVOKE_ATTRIBUTION_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_client_closure_rule_is_scoped_to_the_strict_contract(self) -> None:
        """G: 123, 175 and 186 close PUBLIC and grant authenticated; they stay
        green, and the same shape is rejected from the cutoff on."""
        sql = REVOKE_ATTRIBUTION_MUST_REJECT["closing_public_while_granting_authenticated"]
        historical = self.root / "150_closure.sql"
        historical.write_text(sql, encoding="utf-8")
        self.assertEqual(guards.check_file(historical), [])
        strict = self.root / f"{guards.MIGRATION_STRICT_CUTOFF}_closure.sql"
        strict.write_text(sql, encoding="utf-8")
        self.assertTrue(guards.check_file(strict))
        # A PUBLIC re-grant is never acceptable, at any age.
        reopened = self.root / "150_reopened.sql"
        reopened.write_text(
            REVOKE_ATTRIBUTION_MUST_REJECT["grant_to_public_reopens_the_revoke"],
            encoding="utf-8",
        )
        self.assertTrue(guards.check_file(reopened))

    def test_argument_type_normalization(self) -> None:
        """G: the overload comparison itself, independent of check_file()."""
        cases = {
            "p_org uuid": "uuid",
            "uuid": "uuid",
            "OUT p_total numeric": "numeric",
            "VARIADIC p_ids uuid[]": "uuid[]",
            "p_meta jsonb DEFAULT '{}'::jsonb": "jsonb",
            "p_at timestamp with time zone": "timestamp with time zone",
            "timestamp with time zone": "timestamp with time zone",
            "p_name character varying": "character varying",
            "character varying": "character varying",
            "p_rate numeric(10,2)": "numeric(10,2)",
            "p_x double precision": "double precision",
        }
        for param, expected in cases.items():
            with self.subTest(param=param):
                self.assertEqual(guards._normalize_arg_type(param), expected)

    def test_alter_function_security_definer_is_a_finding(self) -> None:
        """H: flipping an existing function to definer restates no guard."""
        for name, sql in ALTER_DEFINER_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in ALTER_DEFINER_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_security_mode_is_read_from_header_and_trailer_only(self) -> None:
        """The definer decision itself: options before AND after the body count,
        the body's own text does not, and an INVOKER function is left alone."""
        for name, sql in SECURITY_MODE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in SECURITY_MODE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_is_definer_flag_matches_the_declared_mode(self) -> None:
        """The flag itself, independent of check_file()."""
        cases = {
            "definer_declared_after_the_body": True,
            "invoker_function_is_not_scanned": False,
            "function_with_no_security_clause_is_not_scanned": False,
            "the_phrase_inside_the_body_is_not_a_clause": False,
        }
        fixtures = {**SECURITY_MODE_MUST_REJECT, **SECURITY_MODE_MUST_ACCEPT}
        for name, expected in cases.items():
            raw = fixtures[name]
            masked, problems = guards.mask_sql_checked(raw)
            self.assertEqual(problems, [])
            definitions = guards.parse_definitions(raw, masked)
            self.assertEqual(len(definitions), 1, name)
            with self.subTest(case=name):
                self.assertIs(definitions[0].is_definer, expected, name)

    def test_quoted_identities_are_scanned(self) -> None:
        """I: a quoted identity used to match no CREATE at all."""
        for name, sql in QUOTED_IDENTITY_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(self.verdict(name, sql), name)

    def test_overload_impersonation_is_rejected(self) -> None:
        """J: neither the exemption list nor a guard name is a free pass."""
        for name, sql in OVERLOAD_IMPERSONATION_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(self.verdict(name, sql), name)

    def test_known_exempt_is_historical_only(self) -> None:
        """J: the ledger still applies below the cutoff, never at or above it."""
        sql = quoted_definer(
            "CREATE OR REPLACE FUNCTION public.rpc_get_invitation_preview(p_org uuid)"
        )
        historical = self.root / "150_exempt.sql"
        historical.write_text(sql, encoding="utf-8")
        self.assertEqual(guards.check_file(historical), [])
        strict = self.root / f"{guards.MIGRATION_STRICT_CUTOFF}_exempt.sql"
        strict.write_text(sql, encoding="utf-8")
        self.assertTrue(guards.check_file(strict))

    def test_identity_comparison(self) -> None:
        """The overload equality rule itself."""
        raw = (
            "CREATE FUNCTION public.f(p_org uuid) RETURNS void LANGUAGE sql AS $$"
            "SELECT 1$$;\n"
            "REVOKE EXECUTE ON FUNCTION public.f(text) FROM PUBLIC;\n"
            "REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM PUBLIC;\n"
        )
        masked, problems = guards.mask_sql_checked(raw)
        self.assertEqual(problems, [])
        definition = guards.parse_definitions(raw, masked)[0]
        targets = [
            t for stmt in guards.parse_privilege_statements(raw, masked)
            for t in stmt.targets
        ]
        self.assertFalse(definition.identity.same_function(targets[0]))
        self.assertTrue(definition.identity.same_function(targets[1]))

    def test_migration_191_still_relies_on_no_exemption(self) -> None:
        """191 must pass on guards and real closures, never on KNOWN_EXEMPT."""
        path = pathlib.Path(
            "sql/migrations/191_f2_stock_write_concurrency_closure.sql"
        )
        if not path.exists():
            self.skipTest("migration 191 not present")
        raw = path.read_text(encoding="utf-8")
        masked, problems = guards.mask_sql_checked(raw)
        self.assertEqual(problems, [])
        definitions = guards.parse_definitions(raw, masked)
        privileges = guards.parse_privilege_statements(raw, masked)
        definers = [d for d in definitions if d.is_definer]
        self.assertTrue(definers, "191 defines no SECURITY DEFINER function")
        for definition in definers:
            closed = guards.revoke_closes_client_surface(
                definition.identity, definition.end, privileges, strict=True
            )
            body = masked[definition.start: definition.body_span[1]]
            raw_body = raw[definition.start: definition.body_span[1]]
            guarded = guards.has_recognized_guard(body, strict=True, raw_body=raw_body)
            self.assertTrue(
                closed or guarded,
                f"{definition.identity.qualified} rests on neither a guard nor a "
                f"closure",
            )
            self.assertNotIn(definition.identity.name, guards.KNOWN_EXEMPT)
        self.assertEqual(guards.redefined_guard_names(definitions), [])
    # -- Codex findings K-O -------------------------------------------------

    def test_security_mode_is_a_state_not_a_declaration(self) -> None:
        """K: an ALTER after the CREATE decides the mode, in both directions."""
        for name, sql in SECURITY_STATE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in SECURITY_STATE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_promotion_is_named_in_the_error(self) -> None:
        """K: the author must be told WHY an invoker function is being judged."""
        errors = self.verdict(
            "promoted", SECURITY_STATE_MUST_REJECT["invoker_promoted_by_a_later_alter"]
        )
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("made SECURITY DEFINER by a later ALTER", errors[0])

    def test_resolve_security_state_transitions(self) -> None:
        """K: the state machine itself, independent of check_file()."""
        raw = (
            SECURITY_STATE_MUST_REJECT["invoker_promoted_by_a_later_alter"]
            + "ALTER FUNCTION public.f_promoted(uuid) SECURITY INVOKER;\n"
            + "ALTER FUNCTION public.f_elsewhere(uuid) SECURITY DEFINER;\n"
        )
        masked, problems = guards.mask_sql_checked(raw)
        self.assertEqual(problems, [])
        definitions = guards.parse_definitions(raw, masked)
        alters = guards.parse_alter_security(raw, masked)
        self.assertEqual([a.sets_definer for a in alters], [True, False, True])
        external = guards.resolve_security_state(definitions, alters)
        # Last ALTER on the defined function wins: promoted, then demoted again.
        self.assertFalse(definitions[0].final_definer)
        self.assertTrue(definitions[0].is_definer is False)
        # The ALTER naming a function this file never defines stays external.
        self.assertEqual(len(external), 1)
        self.assertEqual(external[0].identity.name, "f_elsewhere")

    def test_sqlstate_values_are_read_at_their_own_offset(self) -> None:
        """L: masking makes two SQLSTATE terms textually identical."""
        for name, sql in SQLSTATE_OFFSET_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in SQLSTATE_OFFSET_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_or_term_spans_are_distinct(self) -> None:
        """L: the span splitter itself - identical masked terms, own offsets."""
        raw = "SQLSTATE 'P0002' OR SQLSTATE 'P0001'"
        masked, problems = guards.mask_sql_checked(raw)
        self.assertEqual(problems, [])
        spans = guards._split_top_level_or_spans(masked, 0)
        self.assertEqual(len(spans), 2)
        self.assertNotEqual(spans[0][0], spans[1][0], "both terms share an offset")
        # The two terms are the SAME text after masking - that is the whole trap.
        self.assertEqual(
            masked[spans[0][0]:spans[0][1]].strip(),
            masked[spans[1][0]:spans[1][1]].strip(),
        )
        self.assertTrue(guards._condition_catches_p0001(masked, raw, 0, len(masked)))

    def test_quoted_grantees_are_seen(self) -> None:
        """M: masking blanks a quoted grantee, so grantees are read from raw."""
        for name, sql in QUOTED_GRANTEE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in QUOTED_GRANTEE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_comments_cannot_close_client_privileges(self) -> None:
        """Commented role names must never exempt an unguarded definer."""
        definition = """
CREATE FUNCTION public.review_probe(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN DELETE FROM public.bins WHERE org_id = p_org; END $$;
"""
        for comment in (
            '/* PUBLIC, anon, authenticated */',
            '-- PUBLIC, anon, authenticated\n',
            '/* outer /* PUBLIC */ anon, "authenticated" */',
            '/* unmatched quote " PUBLIC, anon, authenticated */',
        ):
            with self.subTest(comment=comment):
                sql = definition + (
                    'REVOKE EXECUTE ON FUNCTION public.review_probe(uuid) '
                    f'FROM service_role {comment};'
                )
                self.assertTrue(self.verdict('commented_roles', sql))
                # A real quoted client grant after closure still reopens it,
                # even when a comment contains an unmatched double quote.
                sql = definition + (
                    'REVOKE EXECUTE ON FUNCTION public.review_probe(uuid) '
                    'FROM PUBLIC, anon, authenticated; '
                    'GRANT EXECUTE ON FUNCTION public.review_probe(uuid) '
                    f'TO {comment} "authenticated";'
                )
                self.assertTrue(self.verdict('comment_before_grant', sql))
                sql = definition + (
                    'REVOKE EXECUTE ON FUNCTION public.review_probe(uuid) '
                    f'FROM {comment} PUBLIC, "anon", "authenticated";'
                )
                self.assertEqual(self.verdict('real_commented_closure', sql), [])

    def test_grantee_name_resolution(self) -> None:
        """M: the grantee reader itself."""
        self.assertEqual(
            guards._grantee_names('PUBLIC, "anon", authenticated'),
            {"public", "anon", "authenticated"},
        )
        self.assertEqual(guards._grantee_names("GROUP service_role"), {"service_role"})
        # A quoted name that differs in CASE is a different role.
        self.assertEqual(guards._grantee_names('"Authenticated"'), {"Authenticated"})

    def test_quoted_type_names_keep_overloads_distinct(self) -> None:
        """N: a quoted type is part of the identity and masking blanks it."""
        for name, sql in QUOTED_TYPE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in QUOTED_TYPE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_type_folding_preserves_quoted_segments(self) -> None:
        """N: fold everything except what PostgreSQL would not fold."""
        self.assertEqual(guards._normalize_arg_type('p_x public."TypeA"'), 'public."TypeA"')
        self.assertEqual(guards._normalize_arg_type('public."TypeA"'), 'public."TypeA"')
        self.assertNotEqual(
            guards._normalize_arg_type('p_x public."TypeA"'),
            guards._normalize_arg_type('p_x public."TypeB"'),
        )
        self.assertNotEqual(
            guards._normalize_arg_type('p_x public."TypeA"'),
            guards._normalize_arg_type("p_x public.typea"),
        )
        self.assertEqual(guards._normalize_arg_type("p_x PUBLIC.TypeA"), "public.typea")

    def test_an_omitted_schema_is_not_a_wildcard(self) -> None:
        """O: an unqualified name resolves through search_path, to public."""
        for name, sql in OMITTED_SCHEMA_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in OMITTED_SCHEMA_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

if __name__ == "__main__":
    unittest.main(verbosity=2)
