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
import json
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

# ---------------------------------------------------------------------------
# Fourth-round: ONE PostgreSQL identifier identity
# ---------------------------------------------------------------------------
# Every fixture below was run through the REAL check_file() at 4acd2ac and
# returned [] there. They are not five unrelated bugs: the scanner carried
# THREE different notions of "the same identifier" - an unquoted alphabet that
# stopped at U+FFFF, a fold that used Python's whole-Unicode str.lower() where
# PostgreSQL downcases ASCII only, and a NAMEDATALEN clip applied to labels and
# EXIT targets but not to routine, schema or type names. Each round of review
# found one more instance; the fix is one canonicalizer, _pg_identifier(), that
# every security-bearing comparison is built on.
_ASTRAL = "auth\U0001D400"           # U+1D400: 4-byte UTF-8, above the BMP
_KELVIN = "K"                   # U+212A: 3 bytes, str.lower() -> 1-byte 'k'
_LONG_NAME_X = "rpc_" + "a" * 60 + "X"   # 65 bytes: clipped to the same 63 as
_LONG_NAME_Y = "rpc_" + "a" * 60 + "Y"   # ... this one
_LONG_SCHEMA_X = "sch_" + "a" * 60 + "X"
_LONG_SCHEMA_Y = "sch_" + "a" * 60 + "Y"


def definer_named_routine(name: str, args: str = "p_org uuid",
                          mode: str = "SECURITY DEFINER",
                          body: str | None = None, schema: str = "public") -> str:
    """A routine with an arbitrary (possibly non-ASCII or over-length) name."""
    return (
        f"CREATE OR REPLACE FUNCTION {schema}.{name}({args})\n"
        f"RETURNS void\nLANGUAGE plpgsql\n{mode}\n"
        f"AS $rt$\nBEGIN\n{body or WORK_LINE}\nEND;\n$rt$;\n"
    )


# P1-1: an identifier above U+FFFF was unparseable, so the block label was
# never recorded at all and the EXIT target read as a truncated ASCII prefix -
# which never even reached the fail-closed path.
IDENTITY_ASTRAL_MUST_REJECT = {
    "astral_label_and_matching_exit": labelled_definer(
        f"{WORK_LINE}\n  EXIT {_ASTRAL};\n  PERFORM {OUTER}(p_org);",
        label=_ASTRAL, end_label=_ASTRAL,
    ),
    "astral_label_with_a_declare_section": labelled_definer(
        f"{WORK_LINE}\n  EXIT {_ASTRAL};\n  PERFORM {OUTER}(p_org);",
        label=_ASTRAL, end_label=_ASTRAL, declare=DECLARE_SECTION,
    ),
    # The readable ASCII prefix must not be accepted as the identifier: the
    # scanner may not silently parse `auth` out of `auth<astral>`.
    "astral_suffix_after_a_readable_ascii_prefix": labelled_definer(
        f"{WORK_LINE}\n  EXIT auth\U0001F600;\n  PERFORM {OUTER}(p_org);",
        label="auth\U0001F600", end_label="auth\U0001F600",
    ),
    "astral_first_character": labelled_definer(
        f"{WORK_LINE}\n  EXIT \U0001D400auth;\n  PERFORM {OUTER}(p_org);",
        label="\U0001D400auth", end_label="\U0001D400auth",
    ),
}

# P1-2 / P2-3 / P2-5: PostgreSQL downcases ASCII only in a multibyte encoding.
# Python's str.lower() folds everything, which both MERGES identifiers
# PostgreSQL keeps apart and, when the fold shortens the UTF-8 encoding, moves
# the 63-byte clip so a pair PostgreSQL has already merged comes apart.
IDENTITY_FOLD_MUST_REJECT = {
    # U+212A folds to a one-byte `k`, dropping the identifier under the limit.
    "kelvin_fold_moves_the_namedatalen_clip": labelled_definer(
        f"{WORK_LINE}\n  EXIT {_KELVIN}{'a' * 60}Y;\n  PERFORM {OUTER}(p_org);",
        label=_KELVIN + "a" * 60 + "X", end_label="",
    ),
    # Two distinct routines in PostgreSQL; a REVOKE on one must not exempt the
    # other.
    "non_ascii_case_twin_routine_names": (
        definer_named_routine("rpc_bÄd")
        + definer_named_routine("rpc_bäd", mode="", body="  NULL;")
        + "REVOKE ALL ON FUNCTION public.rpc_bäd(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # The same twin, one schema level up.
    "non_ascii_case_twin_schema_names": (
        definer_named_routine("rpc_s", schema="schÄ")
        + "REVOKE ALL ON FUNCTION schä.rpc_s(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # ... and in the argument TYPE, which decides the overload.
    "non_ascii_case_twin_argument_types": (
        definer_named_routine("rpc_t", args="p_org public.TypeÄ")
        + "REVOKE ALL ON FUNCTION public.rpc_t(public.Typeä) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
}

# P2-4: the clip existed for labels but not for routine, schema or type names,
# so a later GRANT spelled differently past byte 63 reopened a closed surface
# without the scanner noticing.
IDENTITY_CLIP_MUST_REJECT = {
    "over_long_routine_name_reopened_by_a_grant": (
        definer_named_routine(_LONG_NAME_X)
        + f"REVOKE ALL ON FUNCTION public.{_LONG_NAME_X}(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
        + f"GRANT EXECUTE ON FUNCTION public.{_LONG_NAME_Y}(uuid) "
          "TO authenticated;\n"
    ),
    "over_long_schema_name_reopened_by_a_grant": (
        definer_named_routine("rpc_s", schema=_LONG_SCHEMA_X)
        + f"REVOKE ALL ON FUNCTION {_LONG_SCHEMA_X}.rpc_s(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
        + f"GRANT EXECUTE ON FUNCTION {_LONG_SCHEMA_Y}.rpc_s(uuid) "
          "TO authenticated;\n"
    ),
    # An over-length TYPE name decides the overload the same way.
    "over_long_type_name_exempted_by_another_overload": (
        definer_named_routine("rpc_u", args="p_org public.t_" + "a" * 60 + "X")
        + "REVOKE ALL ON FUNCTION public.rpc_u(public.t_" + "a" * 60 + "Y) "
          "FROM PUBLIC, anon, authenticated;\n"
        + "GRANT EXECUTE ON FUNCTION public.rpc_u(public.t_" + "a" * 60 + "Y) "
          "TO authenticated;\n"
    ),
    # A quoted over-length label collides after clipping just as an unquoted
    # one does; quoting exempts nothing from NAMEDATALEN.
    "quoted_over_long_label_collision": labelled_definer(
        f'{WORK_LINE}\n  EXIT "{"a" * 63}Y";\n  PERFORM {OUTER}(p_org);',
        label=f'"{"a" * 63}X"', end_label="",
    ),
}

IDENTITY_MUST_ACCEPT = {
    # Distinct inside the first effective 63 bytes: two real identifiers.
    "routine_names_distinct_within_the_limit": (
        definer_named_routine("rpc_alpha")
        + "REVOKE ALL ON FUNCTION public.rpc_alpha(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # PostgreSQL keeps a quoted identifier's case, so these are two types and
    # the REVOKE naming the actual one is a real closure.
    "quoted_type_case_is_preserved": (
        definer_named_routine("rpc_q", args='p_org public."TypeA"')
        + 'REVOKE ALL ON FUNCTION public.rpc_q(public."TypeA") '
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # An unquoted ASCII type folds, so these two spellings ARE one type.
    "unquoted_ascii_type_folds": (
        definer_named_routine("rpc_f", args="p_org public.MyType")
        + "REVOKE ALL ON FUNCTION public.rpc_f(public.mytype) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # A non-ASCII routine name is one identifier, and the REVOKE naming that
    # same spelling closes it.
    "non_ascii_routine_closed_by_its_own_revoke": (
        definer_named_routine("rpc_bÄd")
        + "REVOKE ALL ON FUNCTION public.rpc_bÄd(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # An astral-plane routine name likewise.
    "astral_routine_closed_by_its_own_revoke": (
        definer_named_routine("rpc_\U0001D400")
        + "REVOKE ALL ON FUNCTION public.rpc_\U0001D400(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
    # Over-length names that agree inside the effective identifier still close.
    "over_long_routine_closed_by_the_same_effective_name": (
        definer_named_routine(_LONG_NAME_X)
        + f"REVOKE ALL ON FUNCTION public.{_LONG_NAME_Y}(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
    ),
}

LABELLED_EXIT_MUST_REJECT.update(LABELLED_EXIT_DECLARE_MUST_REJECT)
LABELLED_EXIT_MUST_REJECT.update(LABELLED_EXIT_IDENTIFIER_MUST_REJECT)
LABELLED_EXIT_MUST_REJECT.update(LABELLED_EXIT_TRUNCATION_MUST_REJECT)
LABELLED_EXIT_MUST_REJECT.update(IDENTITY_ASTRAL_MUST_REJECT)
LABELLED_EXIT_MUST_REJECT.update(IDENTITY_FOLD_MUST_REJECT)
LABELLED_EXIT_MUST_REJECT.update(IDENTITY_CLIP_MUST_REJECT)

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
    **IDENTITY_MUST_ACCEPT,
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


# P. A third independent-review round found three more shapes the fixes above
#    did not cover, each reproduced against the real check_file() before this
#    fix landed:
#
#   1. A labelled EXIT strictly INSIDE a boolean deny branch - between THEN
#      and the aborting RAISE - was never checked. `_if_blocks_with_raising_
#      deny_branch()` only rejected a terminating RETURN in that span, and
#      the labelled-EXIT reachability test elsewhere runs at the IF's OWN
#      position, which cannot see an EXIT written AFTER it. The privileged
#      write already ran by the time the EXIT fires; it then jumps past the
#      RAISE and the function returns having denied nothing.
#   2. `_condition_catches_p0001()` located a SQLSTATE literal by searching
#      for a bare `'`, so a dollar-quoted `SQLSTATE $tag$P0001$tag$` and an
#      E'' escape string like `SQLSTATE E'P000\x31'` (PostgreSQL decodes
#      `\x31` to `1`) both hid a real P0001 swallow.
#   3. `_normalize_arg_type()` collapsed ALL whitespace before folding a type,
#      so `"Type A"` and `"Type  A"` - two distinct PostgreSQL identifiers -
#      normalized to the same text, letting a REVOKE naming only the
#      double-space overload exempt the single-space one too.
BOOLEAN_DENY_EXIT_MUST_REJECT = {
    "exit_between_then_and_raise": labelled_definer(
        f"  IF NOT {QPRED}(p_org) THEN\n{WORK_LINE}\n"
        "    EXIT auth_block;\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n"
    ),
    "conditional_exit_between_then_and_raise": labelled_definer(
        f"  IF NOT {QPRED}(p_org) THEN\n{WORK_LINE}\n"
        "    EXIT auth_block WHEN true;\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n"
    ),
}

BOOLEAN_DENY_EXIT_MUST_ACCEPT = {
    "ordinary_boolean_deny_branch_reaches_raise": labelled_definer(
        f"  IF NOT {QPRED}(p_org) THEN\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n"
        f"{WORK_LINE}"
    ),
    # An EXIT written AFTER the RAISE cannot skip it.
    "exit_after_the_raise_is_unreachable_code": labelled_definer(
        f"  IF NOT {QPRED}(p_org) THEN\n    RAISE EXCEPTION 'DENIED';\n"
        "    EXIT auth_block;\n  END IF;\n"
    ),
    # An inner labelled block that exits only ITSELF leaves the outer RAISE
    # reachable.
    "inner_block_exits_itself_not_the_outer_raise": labelled_definer(
        f"  IF NOT {QPRED}(p_org) THEN\n"
        "    <<inner_block>>\n    BEGIN\n      EXIT inner_block;\n"
        "    END inner_block;\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n"
    ),
}


SQLSTATE_LITERAL_FORM_MUST_REJECT = {
    "dollar_quoted_p0001": definer_outer_handler("SQLSTATE $tag$P0001$tag$"),
    "dollar_quoted_p0001_double_dollar_tag": definer_outer_handler(
        "SQLSTATE $$P0001$$"
    ),
    "escape_string_hex_encoded_p0001": definer_outer_handler(
        r"SQLSTATE E'P000\x31'"
    ),
}

SQLSTATE_LITERAL_FORM_MUST_ACCEPT = {
    "plain_literal_unrelated_code": definer_outer_handler("SQLSTATE '22012'"),
    "dollar_quoted_unrelated_code": definer_outer_handler("SQLSTATE $tag$22012$tag$"),
    "escape_string_unrelated_code": definer_outer_handler(r"SQLSTATE E'2\x3012'"),
}


# Astra round 2: two further gaps in the SQLSTATE-literal swallow model itself,
# both reproduced against the real check_file() on the #246 head that closed
# the three findings above.
#
#   1. `\ooo` in an E'' string is a PostgreSQL BYTE escape, not a Unicode code
#      point. `chr(int(digits, 8))` on a 3-digit octal escape whose value
#      exceeds 255 (`\461` = octal 305) produced an unrelated high-range
#      character instead of the wrapped byte 0x31 = '1', so `E'P000\461'` -
#      which PostgreSQL reads as P0001 - did not compare equal to it.
#   2. PostgreSQL's lexer concatenates two adjacent string constants when the
#      whitespace between them contains a newline: `SQLSTATE 'P00'\n'01'` is
#      the single value P0001. The reader stopped at the first literal's
#      closing quote, so a swallow spelled across a line break was invisible.
SQLSTATE_OCTAL_ESCAPE_MUST_REJECT = {
    "octal_escape_wraps_to_p0001": definer_outer_handler(
        "SQLSTATE E'P000\\461'"
    ),
}

SQLSTATE_CONTINUATION_MUST_REJECT = {
    "newline_continuation_spells_p0001": definer_outer_handler(
        "SQLSTATE 'P00'\n'01'"
    ),
}

SQLSTATE_CONTINUATION_MUST_ACCEPT = {
    "newline_continuation_unrelated_code": definer_outer_handler(
        "SQLSTATE '235'\n'05'"
    ),
    # No newline in the separating whitespace: PostgreSQL does NOT concatenate
    # these, so the scanner must not invent a continuation either. The first
    # segment alone ('P00') does not catch P0001.
    "same_line_adjacent_literals_are_not_concatenated": definer_outer_handler(
        "SQLSTATE 'P00' '01'"
    ),
}


# Astra round 3: the continuation fix above decoded each segment
# independently through its OWN prefix, losing the chain's effective escape
# mode. Reproduced against the real check_file() on the #246 head that closed
# the newline-continuation gap: `_read_sqlstate_literal()` returned
# ('P000\x31', False) for `E'P00'\n'0\x31'` - the bare continuation segment
# was read as an ORDINARY string instead of inheriting the leading E'' mode,
# so the effective P0001 (confirmed live: PostgreSQL 17/16 both evaluate this
# to P0001) went undetected. A live server also confirms a continuation
# segment can NEVER carry its own E/e prefix - `'P0'\nE'01'` and
# `E'P0'\nE'01'` are both hard parse errors (`invalid SQLSTATE code` /
# `syntax error`) regardless of the first segment's mode - so that shape
# fails closed rather than being silently truncated to the first segment.
SQLSTATE_CHAINED_ESCAPE_MODE_MUST_REJECT = {
    # Astra's exact reproducer: E'' then a bare continuation, hex escape only
    # resolves under the inherited escape mode.
    "escape_then_ordinary_hex_resolves_to_p0001": definer_outer_handler(
        "SQLSTATE E'P00'\n'0\\x31'"
    ),
    # Triple chain: the mode must survive through every hop, not just one.
    "triple_chain_escape_then_ordinary_then_ordinary": definer_outer_handler(
        "SQLSTATE E'P0'\n'00'\n'\\x31'"
    ),
    # Existing single-segment forms must not regress under the refactor.
    "single_segment_hex_still_resolves": definer_outer_handler(
        r"SQLSTATE E'P000\x31'"
    ),
    "single_segment_octal_still_wraps": definer_outer_handler(
        "SQLSTATE E'P000\\461'"
    ),
    "plain_two_segment_continuation_still_works": definer_outer_handler(
        "SQLSTATE 'P00'\n'01'"
    ),
}

SQLSTATE_CHAINED_ESCAPE_MODE_MUST_ACCEPT = {
    # The inherited mode must decode the RIGHT value, not just any value:
    # E'235' + escaped '0\x35' is 23505, not P0001.
    "escape_then_ordinary_unrelated_code": definer_outer_handler(
        "SQLSTATE E'235'\n'0\\x35'"
    ),
    # With NO leading E'', a continuation's backslash is never an escape -
    # PostgreSQL keeps it as two literal characters, confirmed live.
    "ordinary_chain_keeps_backslash_literal": definer_outer_handler(
        "SQLSTATE 'P00'\n'0\\x31'"
    ),
    # An E-prefixed continuation segment never compiles on a real server, in
    # either direction - the scanner must still fail CLOSED on it (tested via
    # the MUST_REJECT dict below, not here); these two confirm the escape
    # MODE itself, not the illegal-continuation shape.
}

# A continuation segment can never carry its own E/e prefix; PostgreSQL
# rejects both orderings outright. This scanner cannot confidently attribute
# such text to a real, compilable statement, so it fails closed instead of
# quietly keeping only the first segment.
SQLSTATE_ILLEGAL_CONTINUATION_PREFIX_MUST_REJECT = {
    "ordinary_then_escape_prefixed_continuation": definer_outer_handler(
        "SQLSTATE 'P0'\nE'01'"
    ),
    "escape_then_escape_prefixed_continuation": definer_outer_handler(
        "SQLSTATE E'P0'\nE'01'"
    ),
}


QUOTED_TYPE_WHITESPACE_MUST_REJECT = {
    # The REVOKE below names ONLY the double-space overload. If the scanner
    # collapses `"Type  A"` to `"Type A"` before comparing, it wrongly treats
    # the single-space DEFINER overload as ACL-closed too.
    "double_space_revoke_does_not_close_single_space_overload": (
        routine("f_w", "SECURITY DEFINER", args='p_x public."Type A"')
        + routine("f_w", "SECURITY DEFINER", args='p_x public."Type  A"')
        + 'REVOKE EXECUTE ON FUNCTION public.f_w(public."Type  A")\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
}

QUOTED_TYPE_WHITESPACE_MUST_ACCEPT = {
    "matching_double_space_quoted_type_closes_it": (
        routine("f_w", "SECURITY DEFINER", args='p_x public."Type  A"')
        + 'REVOKE EXECUTE ON FUNCTION public.f_w(public."Type  A") '
          "FROM PUBLIC, anon, authenticated;\n"
    ),
}


# Q. A fifth independent-review round found two more shapes, each reproduced
#    against the real check_file() before this fix landed:
#
#   1. A condition name may be written as a QUOTED identifier, and PostgreSQL
#      resolves `WHEN "raise_exception"` to exactly the condition the bare name
#      names. The masker blanks quoted-identifier CONTENT, so the term reached
#      `_condition_catches_p0001()` as `"              "` and matched nothing:
#      a handler that really does swallow an assertion's authorization failure
#      left the function reported as guarded.
#   2. Array bounds may be separated from their element type by whitespace
#      (`"Type A" []`, `uuid [4]`), so a multi-token parameter does not imply a
#      leading argument NAME. `_normalize_arg_type()` dropped that first token
#      anyway, normalizing every such parameter to the bounds alone - which
#      merged distinct overloads and let a REVOKE naming one of them exempt an
#      unguarded SECURITY DEFINER function declared with the other.
QUOTED_CONDITION_MUST_REJECT = {
    "handler_catches_quoted_raise_exception": definer_outer_handler(
        '"raise_exception"'
    ),
    "handler_catches_quoted_others": definer_outer_handler('"others"'),
    "handler_catches_quoted_category_name": definer_outer_handler(
        '"plpgsql_error"'
    ),
    "handler_catches_quoted_name_as_later_or_term": definer_outer_handler(
        'unique_violation OR "raise_exception"'
    ),
    # Fail-closed by design: PostgreSQL keeps a quoted identifier's case, so
    # this resolves to no condition at all and cannot compile. The reader must
    # not invent a third folding rule to "prove" it harmless.
    "handler_catches_quoted_name_in_another_case": definer_outer_handler(
        '"RAISE_EXCEPTION"'
    ),
}

QUOTED_CONDITION_MUST_ACCEPT = {
    # The other half of the rule: a quoted name that cannot catch a P0001 must
    # not invalidate a real guard either.
    "quoted_unique_violation_does_not_catch": definer_outer_handler(
        '"unique_violation"'
    ),
    "quoted_fk_violation_does_not_catch": definer_outer_handler(
        '"foreign_key_violation"'
    ),
}

ARRAY_BOUND_TYPE_MUST_REJECT = {
    # The REVOKE names a DIFFERENT quoted element type. Reading `"Type A" []`
    # as a name plus the type `[]` normalizes both signatures to the same text,
    # so the unguarded definer is reported as ACL-closed while PostgreSQL still
    # lets clients execute it.
    "quoted_array_revoke_does_not_close_another_element_type": (
        routine("f_a", "SECURITY DEFINER", args='public."Type A" []')
        + 'REVOKE EXECUTE ON FUNCTION public.f_a(public."Type B"[])\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    # The same defect on the unquoted branch, where a bare element type was
    # dropped as if it were a parameter name.
    "spaced_array_revoke_does_not_close_another_element_type": (
        routine("f_b", "SECURITY DEFINER", args="uuid []")
        + "REVOKE EXECUTE ON FUNCTION public.f_b(text[])\n"
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
}

# R. A seventh independent-review round found three more shapes. Each was
#    reproduced against the real check_file() on `7f3f2a8` before this fix, and
#    the two ACL-identity ones were confirmed on a live PostgreSQL 17.11 server:
#    the REVOKE naming the other overload left the unguarded definer executable
#    by `authenticated`, which then performed the protected write.
#
#   1. A condition name spelled as a Unicode delimited identifier
#      (`WHEN U&"raise_exception"`) matched nothing, because the Round 6 reader
#      recognized only the ordinary `"..."` spelling. PostgreSQL 17.11's plpgsql
#      grammar in fact REFUSES a UIDENT in that position (`syntax error at or
#      near "U&""raise_exception"""`), so this was not a live swallow - but a
#      reader that cannot resolve an identity must fail CLOSED rather than wave
#      it through, and the same U& spelling IS accepted in the SQL-level
#      surfaces this scanner also parses (type names, routine names), which is
#      why one shared reader now decodes it everywhere.
#   2. `"Schema A" . "T" []` was read as the NAME `"Schema A"` plus the type
#      `. "T" []`, so `"Schema A"` and `"Schema B"` normalized identically.
#   3. `DEFAULT`/`=` were located by a regex over the UNPARSED parameter, so
#      `"Type DEFAULT A" []` and `"Type=A" []` were truncated INSIDE a quoted
#      identifier, leaving the fragment `"type` as the whole type identity.
UNICODE_CONDITION_MUST_REJECT = {
    "handler_catches_unicode_raise_exception": definer_outer_handler(
        'U&"raise_exception"'
    ),
    "handler_catches_unicode_others": definer_outer_handler('U&"others"'),
    "handler_catches_unicode_category_name": definer_outer_handler(
        'U&"plpgsql_error"'
    ),
    # The same name written through the escape itself: \006E is `n`.
    "handler_catches_unicode_escaped_name": definer_outer_handler(
        'U&"raise_excepti\\006Fn"'
    ),
    "handler_catches_unicode_escaped_name_plus_form": definer_outer_handler(
        'U&"raise_excepti\\+00006Fn"'
    ),
    "handler_catches_unicode_custom_uescape": definer_outer_handler(
        'U&"raise_excepti!006Fn" UESCAPE \'!\''
    ),
    "handler_catches_unicode_as_later_or_term": definer_outer_handler(
        'unique_violation OR U&"raise_exception"'
    ),
    "handler_catches_unicode_as_first_or_term": definer_outer_handler(
        'U&"raise_exception" OR unique_violation'
    ),
    # Unresolvable spellings: a truncated escape, and a UESCAPE character
    # PostgreSQL forbids (a hex digit). Identity cannot be proven, so the
    # reader must fail closed instead of reporting the function as guarded.
    "handler_condition_with_truncated_escape": definer_outer_handler(
        'U&"raise_exceptio\\00"'
    ),
    "handler_condition_with_forbidden_uescape": definer_outer_handler(
        'U&"raise_exception" UESCAPE \'a\''
    ),
}

UNICODE_CONDITION_MUST_ACCEPT = {
    # An unrelated condition, in every spelling, still cannot catch a P0001.
    "unicode_unique_violation_does_not_catch": definer_outer_handler(
        'U&"unique_violation"'
    ),
    "unicode_escaped_unique_violation_does_not_catch": definer_outer_handler(
        'U&"uniqu\\0065_violation"'
    ),
    "unicode_fk_violation_does_not_catch": definer_outer_handler(
        'U&"foreign_key_violation"'
    ),
}

QUALIFIED_TYPE_MUST_REJECT = {
    # Two distinct qualified types; only the B overload is revoked. Confirmed
    # on PostgreSQL 17.11: the A overload stays executable by `authenticated`.
    "spaced_qualification_keeps_quoted_schemas_distinct": (
        routine("f_q", "SECURITY DEFINER", args='"Schema A" . "T" []')
        + routine("f_q", "SECURITY DEFINER", args='"Schema B" . "T" []')
        + 'REVOKE EXECUTE ON FUNCTION public.f_q("Schema B" . "T" [])\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    "spaced_qualification_keeps_bare_schemas_distinct": (
        routine("f_q", "SECURITY DEFINER", args="sch_a . t []")
        + routine("f_q", "SECURITY DEFINER", args="sch_b . t []")
        + "REVOKE EXECUTE ON FUNCTION public.f_q(sch_b . t [])\n"
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    "spaced_qualification_mixed_quoting_stays_distinct": (
        routine("f_q", "SECURITY DEFINER", args='"Schema A" . t []')
        + routine("f_q", "SECURITY DEFINER", args='"Schema B" . t []')
        + 'REVOKE EXECUTE ON FUNCTION public.f_q("Schema B" . t [])\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    "multi_dimensional_bounds_stay_with_their_element_type": (
        routine("f_q", "SECURITY DEFINER", args='public."Type A" [] []')
        + routine("f_q", "SECURITY DEFINER", args='public."Type B" [] []')
        + 'REVOKE EXECUTE ON FUNCTION public.f_q(public."Type B"[][])\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
}

QUALIFIED_TYPE_MUST_ACCEPT = {
    # Spacing around `.` and the bounds is NOT part of the identity: the same
    # overload written either way must still be recognized as closed.
    "spaced_qualification_matches_tight_revoke": (
        routine("f_q", "SECURITY DEFINER", args='"Schema A" . "T" []')
        + 'REVOKE EXECUTE ON FUNCTION public.f_q("Schema A"."T"[])\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    "bare_spaced_qualification_matches_tight_revoke": (
        routine("f_q", "SECURITY DEFINER", args="sch_a . t []")
        + "REVOKE EXECUTE ON FUNCTION public.f_q(sch_a.t[])\n"
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    "named_argument_with_qualified_array_type_matches": (
        routine("f_q", "SECURITY DEFINER", args='p_x public."Type A" []')
        + 'REVOKE EXECUTE ON FUNCTION public.f_q(public."Type A"[])\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
}

DEFAULT_IN_QUOTED_TYPE_MUST_REJECT = {
    # `DEFAULT` and `=` inside a quoted type name are part of the NAME.
    # Confirmed on PostgreSQL 17.11 for both pairs.
    "quoted_type_containing_default_keyword_stays_distinct": (
        routine("f_d", "SECURITY DEFINER", args='public."Type DEFAULT A" []')
        + routine("f_d", "SECURITY DEFINER", args='public."Type DEFAULT B" []')
        + 'REVOKE EXECUTE ON FUNCTION public.f_d(public."Type DEFAULT B" [])\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    "quoted_type_containing_equals_stays_distinct": (
        routine("f_d", "SECURITY DEFINER", args='public."Type=A" []')
        + routine("f_d", "SECURITY DEFINER", args='public."Type=B" []')
        + 'REVOKE EXECUTE ON FUNCTION public.f_d(public."Type=B" [])\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    "quoted_type_with_doubled_quote_stays_distinct": (
        routine("f_d", "SECURITY DEFINER", args='public."Ty""pe DEFAULT A"')
        + routine("f_d", "SECURITY DEFINER", args='public."Ty""pe DEFAULT B"')
        + 'REVOKE EXECUTE ON FUNCTION public.f_d(public."Ty""pe DEFAULT B")\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
}

DEFAULT_IN_QUOTED_TYPE_MUST_ACCEPT = {
    "quoted_type_containing_default_keyword_matches_itself": (
        routine("f_d", "SECURITY DEFINER", args='public."Type DEFAULT A" []')
        + 'REVOKE EXECUTE ON FUNCTION public.f_d(public."Type DEFAULT A"[])\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    # A REAL default expression is still stripped: the parameter's type is what
    # is compared, and the REVOKE form never carries the default.
    "real_default_expression_is_still_stripped": (
        routine("f_d", "SECURITY DEFINER",
                args='p_x public."Type DEFAULT A" [] DEFAULT NULL')
        + 'REVOKE EXECUTE ON FUNCTION public.f_d(public."Type DEFAULT A"[])\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    "real_equals_default_expression_is_still_stripped": (
        routine("f_d", "SECURITY DEFINER", args="p_meta jsonb = '{}'::jsonb")
        + "REVOKE EXECUTE ON FUNCTION public.f_d(jsonb)\n"
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
}

# S. An eighth independent-review round found two more shapes, both confirmed
#    on a live PostgreSQL 17.11 server - the unguarded definer stayed reachable
#    by a client role while the scanner reported no finding:
#
#   1. `Identity.args = None` carried TWO meanings: "no argument list was
#      written" and "an argument list was written and could not be parsed".
#      `same_function()` answers TRUE for the first, so every signature the
#      scanner could not read became a WILDCARD matching any overload of the
#      same name - and a comment inside the argument list was enough, because
#      the parameter tokenizer ran on RAW bytes. A REVOKE on `f(text)` then
#      exempted an unguarded `f(uuid /* why */)`. The third state is explicit
#      now (UNRESOLVED_ARGS) and matches nothing, and parameter STRUCTURE is
#      read from the masked span where a comment is already whitespace.
#   2. `_grantee_names()` still had its own quote regex after Round 7 gave the
#      scanner one shared delimited-identifier reader. `U&"authenticate\0064"`
#      is the role `authenticated` to PostgreSQL, so a GRANT spelled that way
#      reopens a closed function; the private reader saw a bare role `u` plus a
#      role literally named `authenticate\0064`, and no reopen at all.


def commented_definer(args: str, name: str = "rpc_p") -> str:
    return (
        f"CREATE OR REPLACE FUNCTION public.{name}({args})\n"
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\n"
        f"AS ${name}$\nBEGIN\n{WORK_LINE}\nEND;\n${name}$;\n"
    )


def revoke_clients(args: str, name: str = "rpc_p") -> str:
    return (
        f"REVOKE EXECUTE ON FUNCTION public.{name}({args})\n"
        "  FROM PUBLIC, anon, authenticated;\n"
    )


def grant_to(grantee: str, args: str = "uuid", name: str = "rpc_p") -> str:
    return (
        f"GRANT EXECUTE ON FUNCTION public.{name}({args})\n  TO {grantee};\n"
    )


# A second overload exists in each rejecting fixture, so the REVOKE below names
# a REAL function and the file is valid PostgreSQL - confirmed on 17.11, where
# the commented overload stays client-executable.
OTHER_OVERLOAD = commented_definer("p_y text", name="rpc_p")

UNPARSEABLE_ARGS_MUST_REJECT = {
    "create_side_block_comment_is_not_a_wildcard": (
        commented_definer("p_x uuid /* why */") + OTHER_OVERLOAD
        + revoke_clients("text")
    ),
    "revoke_side_block_comment_is_not_a_wildcard": (
        commented_definer("p_x uuid") + OTHER_OVERLOAD
        + revoke_clients("text /* why */")
    ),
    "comment_around_qualification_dot": (
        commented_definer("p_x public /* c */ . t") + OTHER_OVERLOAD
        + revoke_clients("text")
    ),
    "comment_before_array_bounds": (
        commented_definer("p_x public.t /* c */ []") + OTHER_OVERLOAD
        + revoke_clients("text")
    ),
    "comment_after_array_bounds": (
        commented_definer("p_x uuid [] /* c */") + OTHER_OVERLOAD
        + revoke_clients("text")
    ),
    "line_comment_inside_argument_list": (
        commented_definer("p_x uuid -- why\n") + OTHER_OVERLOAD
        + revoke_clients("text")
    ),
    "nested_block_comment_inside_argument_list": (
        commented_definer("p_x uuid /* a /* nested */ b */") + OTHER_OVERLOAD
        + revoke_clients("text")
    ),
    # PostgreSQL-valid type syntax this scanner does not model. Option B of the
    # contract: mark the PRESENT list unresolved and fail closed - never turn
    # unsupported syntax into omitted-argument (wildcard) semantics.
    "percent_type_is_unresolved_not_omitted": (
        commented_definer("p_x public.audit_probe.note%TYPE") + OTHER_OVERLOAD
        + revoke_clients("uuid")
    ),
    # An unresolved list matches NOTHING - including the identical spelling on
    # the other side. Two signatures nobody could read are not a match.
    "percent_type_does_not_match_itself": (
        commented_definer("p_x public.audit_probe.note%TYPE")
        + revoke_clients("public.audit_probe.note%TYPE")
    ),
    # The same rule on the ALTER surface: an unresolved signature cannot carry
    # a promotion onto a definition, and cannot be closed by a REVOKE either.
    "unresolved_alter_signature_cannot_be_closed": (
        "CREATE OR REPLACE FUNCTION public.rpc_p(p_x uuid)\n"
        "RETURNS void\nLANGUAGE plpgsql\nSECURITY INVOKER\n"
        f"AS $rpc_p$\nBEGIN\n{WORK_LINE}\nEND;\n$rpc_p$;\n"
        "ALTER FUNCTION public.rpc_p(public.audit_probe.note%TYPE)\n"
        "  SECURITY DEFINER;\n"
        + revoke_clients("uuid")
    ),
    "control_no_comment_other_overload": (
        commented_definer("p_x uuid") + OTHER_OVERLOAD + revoke_clients("text")
    ),
}

UNPARSEABLE_ARGS_MUST_ACCEPT = {
    # Comments do not alter PostgreSQL routine identity, so a REVOKE naming the
    # same overload still closes it - in either direction.
    "create_side_comment_matches_plain_revoke": (
        commented_definer("p_x uuid /* why */") + revoke_clients("uuid")
    ),
    "revoke_side_comment_matches_plain_create": (
        commented_definer("p_x uuid") + revoke_clients("uuid /* why */")
    ),
    "comment_at_dot_matches_tight_revoke": (
        commented_definer("p_x public /* c */ . t") + revoke_clients("public.t")
    ),
    "line_comment_matches_plain_revoke": (
        commented_definer("p_x uuid -- why\n") + revoke_clients("uuid")
    ),
    "control_no_comment_same_overload": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
    ),
}

UNICODE_GRANTEE_MUST_REJECT = {
    # Each GRANT below reopens the function for a client role on PostgreSQL
    # 17.11 - verified with has_function_privilege.
    "reopened_by_escaped_unicode_authenticated": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
        + grant_to('U&"authenticate\\0064"')
    ),
    "reopened_by_uescape_authenticated": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
        + grant_to('U&"authenticate!0064" UESCAPE \'!\'')
    ),
    "reopened_by_escaped_unicode_anon": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
        + grant_to('U&"ano\\006E"')
    ),
    "reopened_by_escaped_unicode_public": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
        + grant_to('U&"publi\\0063"')
    ),
    # Controls that were already rejected, kept so they cannot regress.
    "reopened_by_plain_unicode_authenticated": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
        + grant_to('U&"authenticated"')
    ),
    "reopened_by_ordinary_quoted_authenticated": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
        + grant_to('"authenticated"')
    ),
    "reopened_by_bare_authenticated": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
        + grant_to("authenticated")
    ),
    # An unresolvable delimited grantee may BE a client role, so a GRANT naming
    # one is replayed as reaching all of them.
    "unresolvable_unicode_grantee_fails_closed": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
        + grant_to('U&"authenticate\\00"')
    ),
}

UNICODE_GRANTEE_MUST_ACCEPT = {
    # PostgreSQL keeps a delimited identifier's case, so these are other roles.
    "case_variant_grantee_is_another_role": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
        + grant_to('"Authenticated"')
    ),
    "non_client_role_grant_does_not_reopen": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
        + grant_to("reporting_role")
    ),
    "unicode_non_client_role_grant_does_not_reopen": (
        commented_definer("p_x uuid") + revoke_clients("uuid")
        + grant_to('U&"reporting_rol\\0065"')
    ),
    # The closure itself may be written in the U& spelling, and comments may
    # sit between grantees.
    "revoke_from_unicode_spelled_clients_closes": (
        commented_definer("p_x uuid")
        + 'REVOKE EXECUTE ON FUNCTION public.rpc_p(uuid)\n'
          '  FROM U&"publi\\0063", U&"ano\\006E", U&"authenticate\\0064";\n'
    ),
    "comments_between_grantees_do_not_hide_the_closure": (
        commented_definer("p_x uuid")
        + "REVOKE EXECUTE ON FUNCTION public.rpc_p(uuid)\n"
          "  FROM PUBLIC /* c */, anon, /* c */ authenticated;\n"
    ),
}

ARRAY_BOUND_TYPE_MUST_ACCEPT = {
    # Spacing around the bounds is not part of the identity: the same overload
    # written either way must still be recognized as closed.
    "matching_quoted_array_overload_closes_it": (
        routine("f_a", "SECURITY DEFINER", args='p_x public."Type A" []')
        + 'REVOKE EXECUTE ON FUNCTION public.f_a(public."Type A"[])\n'
          "  FROM PUBLIC, anon, authenticated;\n"
    ),
    "matching_spaced_array_overload_closes_it": (
        routine("f_b", "SECURITY DEFINER", args="p_x uuid []")
        + "REVOKE EXECUTE ON FUNCTION public.f_b(uuid[])\n"
          "  FROM PUBLIC, anon, authenticated;\n"
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


# Round 4: the decoder and masker must agree on continued-string boundaries.
# These payloads were also executed in an isolated PostgreSQL 17.5 engine:
# the apparent assertion is string content and the unguarded write succeeds.
CONTINUED_LITERAL_FAKE_GUARDS = {
    "inherited_escaped_quote": "  PERFORM E''\n"
        "  '\\' ; PERFORM public.wardah_assert_org_member(p_org); --'\n  ;",
    "third_segment_escaped_quote": "  PERFORM e''\n''\n"
        "  '\\' ; PERFORM public.wardah_assert_org_member(p_org); --'\n  ;",
    "line_comment_separator": "  PERFORM E'' -- continuation\n"
        "  '\\' ; PERFORM public.wardah_assert_org_member(p_org); --'\n  ;",
}

UNICODE_SQLSTATE_MUST_REJECT = (
    "SQLSTATE U&'P0001'",  # Exact Codex report; fail closed, no decoder claim.
    r"SQLSTATE U&'P000\0031'",
    r"SQLSTATE u&'\00500001'",
    r"SQLSTATE U&'P000!0031' UESCAPE '!'",
    r"SQLSTATE U&'P000\0030'",
    r"SQLSTATE '23505' OR SQLSTATE U&'P000\0031'",
    r"SQLSTATE U&'23505'",  # Unsupported decoding fails closed even if unrelated.
)

# Scalar values checked against PostgreSQL 17.5. Parser-level equality below
# is backed by check_file() controls using EVERY expression in a real body.
CONTINUED_LITERAL_VALUES = (
    ("E''\n'\\''", "'"),
    ("E''\n'\\'x'", "'x"),
    ("E''\n'\\\\'", "\\"),
    ("E'one'''\n'''two'", "one''two"),
    ("E'P0'\n'00'\n'\\x31'", "P0001"),
    ("E'P00' \t\r\n '0\\461'", "P0001"),
    ("E'P00'\n\n\n'01'", "P0001"),
    ("E'P00' -- comment\n'01'", "P0001"),
    ("E'P00' -- first\n -- second\n'01'", "P0001"),
    ("E'a'\n'\\tb'", "a\tb"),
    ("E'a\\\\'\n'b'", "a\\b"),
    ("'a\\'\n'b'", "a\\b"),
    ("E'235'\n'0\\x35'", "23505"),
    ("'P00'\n'0\\x31'", "P000\\x31"),
)



# ---------------------------------------------------------------------------
# Astra round 4 / Codex round 4: PostgreSQL 17 lexical boundaries
# ---------------------------------------------------------------------------
# Both findings are the same class of defect: this scanner transcribed a
# PostgreSQL lexer rule by hand and got the CHARACTER SET wrong, so a literal
# ended somewhere PostgreSQL does not end it and the literal's content was
# scanned as executable code. Both were reproduced on a live PostgreSQL 17
# server (17.11): the probe function was created, called, and the protected
# write observed to happen with the assertion never executed.
#
# ASTRA: dollar-quote TAGS. scan.l spells them
#     dolq_start [A-Za-z\200-\377_]   dolq_cont [A-Za-z\200-\377_0-9]
# - a BYTE range, so in UTF-8 every non-ASCII codepoint qualifies. The scanner
# used str.isalpha()/str.isalnum(), which are Unicode CATEGORY tests, so every
# non-ASCII codepoint outside L*/N* was not recognized as a tag at all:
# `$😀$`, `$Ⅸ$`, and tags containing a combining mark, ZWSP, NBSP, soft hyphen,
# U+FEFF or a private-use character. A sweep of the whole ASCII range plus a
# Unicode spread against the live server found the disagreement was ALWAYS in
# that one direction - PostgreSQL opens the literal, the scanner does not.
#
# CODEX: the vertical tab. PostgreSQL 17 added \v to scan.l's `space` class
# (v16 has no \v), and quote continuation is
#     {non_newline_whitespace}*{newline}{special_whitespace}*{quote}
# so under v17 - the version this project runs - a VT is ordinary whitespace on
# BOTH sides of the required newline. Omitting it split one continued literal
# in two, which showed up twice: the SQLSTATE reader decoded only the first
# segment and missed a handler that really catches P0001, and the masker ended
# the literal early and exposed the rest as code.
DOLLAR_TAG_BYTE_RANGE_MUST_REJECT = {
    # Astra's own reproducer, verbatim in shape.
    "guard_inside_emoji_tagged_literal": definer(
        f"  PERFORM $\U0001F600$ PERFORM public.{GUARD}(p_org); $\U0001F600$;"
    ),
    "guard_inside_roman_numeral_tagged_literal": definer(
        f"  PERFORM $\u2168$ PERFORM public.{GUARD}(p_org); $\u2168$;"
    ),
    "guard_inside_combining_mark_tagged_literal": definer(
        f"  PERFORM $a\u0301$ PERFORM public.{GUARD}(p_org); $a\u0301$;"
    ),
    "guard_inside_zero_width_space_tagged_literal": definer(
        f"  PERFORM $a\u200b$ PERFORM public.{GUARD}(p_org); $a\u200b$;"
    ),
    "guard_inside_nbsp_tagged_literal": definer(
        f"  PERFORM $\u00a0$ PERFORM public.{GUARD}(p_org); $\u00a0$;"
    ),
    "guard_inside_soft_hyphen_tagged_literal": definer(
        f"  PERFORM $\u00ad$ PERFORM public.{GUARD}(p_org); $\u00ad$;"
    ),
    "guard_inside_bom_tagged_literal": definer(
        f"  PERFORM $a\ufeff$ PERFORM public.{GUARD}(p_org); $a\ufeff$;"
    ),
    "guard_inside_private_use_tagged_literal": definer(
        f"  PERFORM $\ue000$ PERFORM public.{GUARD}(p_org); $\ue000$;"
    ),
    # The same bytes as the OUTER body delimiter: the tag has to be recognized
    # for the scanner to know where executable text even begins.
    "guard_named_as_emoji_outer_delimiter": definer_delim(
        "$\U0001F600$", f"  PERFORM public.{GUARD};"
    ),
}

DOLLAR_TAG_BYTE_RANGE_MUST_ACCEPT = {
    # A real call still passes when a non-ASCII tag is merely present nearby:
    # the fix must widen tag RECOGNITION, not swallow real guards.
    "real_guard_beside_emoji_tagged_literal": definer(
        f"  PERFORM $\U0001F600$note$\U0001F600$;\n"
        f"  PERFORM public.{GUARD}(p_org);"
    ),
    "real_guard_inside_emoji_delimited_body": definer_delim(
        "$\U0001F600$", f"  PERFORM public.{GUARD}(p_org);"
    ),
}

VERTICAL_TAB_CONTINUATION_MUST_REJECT = {
    # Codex's reproducer: one continued escape-string spelling P0001, so the
    # handler really does swallow the assertion.
    "vt_before_newline_spells_p0001": definer_outer_handler(
        "SQLSTATE E'P00'\x0b\n'0\\x31'"
    ),
    "vt_after_newline_spells_p0001": definer_outer_handler(
        "SQLSTATE E'P00'\n\x0b'0\\x31'"
    ),
    "vt_run_around_newline_spells_p0001": definer_outer_handler(
        "SQLSTATE E'P0'\x0b\x0b\n\x0b'001'"
    ),
    "vt_continuation_spells_the_p0000_class": definer_outer_handler(
        "SQLSTATE E'P00'\x0b\n'0\\x30'"
    ),
    # An OR-list where only the VT-continued term catches.
    "vt_continuation_inside_an_or_list": definer_outer_handler(
        "unique_violation OR SQLSTATE E'P00'\x0b\n'0\\x31'"
    ),
    # The masking half of the same boundary: with the continuation followed,
    # the guard text sits INSIDE the literal after an escaped quote.
    "guard_hidden_after_escaped_quote_in_vt_continued_estring": definer(
        f"  PERFORM E'a'\x0b\n'b\\' PERFORM public.{GUARD}(p_org); \\'c';"
    ),
    "guard_hidden_after_escaped_quote_in_nl_vt_continued_estring": definer(
        f"  PERFORM E'a'\n\x0b'b\\' PERFORM public.{GUARD}(p_org); \\'c';"
    ),
}

VERTICAL_TAB_CONTINUATION_MUST_ACCEPT = {
    # The continuation is followed, and what it spells is NOT a catching code:
    # the fix must discriminate, not fail closed on every vertical tab.
    "vt_continuation_unrelated_code": definer_outer_handler(
        "SQLSTATE E'P00'\x0b\n'0\\x32'"
    ),
    "vt_continuation_unrelated_code_plain": definer_outer_handler(
        "SQLSTATE '235'\x0b\n'05'"
    ),
    # A vertical tab is whitespace but never a NEWLINE, so it cannot supply the
    # newline PostgreSQL requires: these stay TWO literals and 'P00' alone does
    # not catch P0001.
    "vt_alone_does_not_concatenate": definer_outer_handler(
        "SQLSTATE 'P00'\x0b'01'"
    ),
}


# ---------------------------------------------------------------------------
# Round 9 (PR #246): four P2 acceptance-layer false-greens, each reproduced
# against a live PostgreSQL 17.11 oracle before being frozen here.
#
# Every reproducer below is PostgreSQL-VALID and security-relevant: PostgreSQL
# accepts the statement and the client role really can execute the unguarded
# SECURITY DEFINER function afterwards, while the scanner reported the surface
# closed. None of them is one of the three declared #243 limitations, and none
# indicates a defect in any production migration body.
# ---------------------------------------------------------------------------

def _r9_definer(signature: str) -> str:
    """An unguarded SECURITY DEFINER function with the given parameter list."""
    return (
        f"CREATE OR REPLACE FUNCTION public.review_probe({signature})\n"
        "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
        "BEGIN\n"
        "  RETURN;\n"
        "END;\n"
        "$$;\n"
    )


_R9_CLOSE = (
    "REVOKE EXECUTE ON FUNCTION public.review_probe(text) "
    "FROM PUBLIC, anon, authenticated;\n"
)

# --- Round 9 finding 1 -----------------------------------------------------
# `char varying` is the built-in varchar on PostgreSQL 17 (verified live:
# `CREATE FUNCTION f(char varying)` yields identity arguments
# `character varying`). The scanner had no `char` among its type lead words, so
# it dropped `char` as an optional parameter NAME and the type identity became
# `varying` - which is also what the quoted custom type `"varying"` normalizes
# to (live identity arguments: `varying`, a DIFFERENT type). Two distinct
# PostgreSQL overloads collapsed into one scanner identity, so a REVOKE naming
# either one closed the other on paper while PostgreSQL still let clients
# execute the unguarded definer.
TYPE_PHRASE_MUST_REJECT = {
    "char_varying_revoke_does_not_close_quoted_varying":
        _r9_definer('p_x "varying"')
        + "REVOKE EXECUTE ON FUNCTION public.review_probe(char varying) "
          "FROM PUBLIC, anon, authenticated;\n",
    "quoted_varying_revoke_does_not_close_char_varying":
        _r9_definer("p_x char varying")
        + 'REVOKE EXECUTE ON FUNCTION public.review_probe("varying") '
          "FROM PUBLIC, anon, authenticated;\n",
    "nchar_varying_revoke_does_not_close_quoted_varying":
        _r9_definer('p_x "varying"')
        + "REVOKE EXECUTE ON FUNCTION public.review_probe(nchar varying) "
          "FROM PUBLIC, anon, authenticated;\n",
    "bit_varying_revoke_does_not_close_quoted_varying":
        _r9_definer('p_x "varying"')
        + "REVOKE EXECUTE ON FUNCTION public.review_probe(bit varying) "
          "FROM PUBLIC, anon, authenticated;\n",
    "national_character_varying_revoke_does_not_close_quoted_varying":
        _r9_definer('p_x "varying"')
        + "REVOKE EXECUTE ON FUNCTION public.review_probe"
          "(national character varying) FROM PUBLIC, anon, authenticated;\n",
    # The same boundary in the other direction. `DOUBLE` is an unreserved
    # keyword, so `f(double text)` declares a parameter NAMED `double` of type
    # `text` (verified live: identity arguments `double text`). Keeping `double`
    # as part of the type read the identity as `double text`, which is not the
    # overload a REVOKE on `f(text)` names.
    "double_named_parameter_is_not_a_type_phrase":
        _r9_definer("double text")
        + "REVOKE EXECUTE ON FUNCTION public.review_probe(bigint) "
          "FROM PUBLIC, anon, authenticated;\n",
}

TYPE_PHRASE_MUST_ACCEPT = {
    # A multi-word type phrase closed by the SAME multi-word spelling.
    "char_varying_closes_char_varying":
        _r9_definer("p_x char varying")
        + "REVOKE EXECUTE ON FUNCTION public.review_probe(char varying) "
          "FROM PUBLIC, anon, authenticated;\n",
    "character_varying_closes_character_varying":
        _r9_definer("p_x character varying")
        + "REVOKE EXECUTE ON FUNCTION public.review_probe(character varying) "
          "FROM PUBLIC, anon, authenticated;\n",
    "double_precision_closes_double_precision":
        _r9_definer("p_x double precision")
        + "REVOKE EXECUTE ON FUNCTION public.review_probe(double precision) "
          "FROM PUBLIC, anon, authenticated;\n",
    "time_with_time_zone_closes_itself":
        _r9_definer("p_x time with time zone")
        + "REVOKE EXECUTE ON FUNCTION public.review_probe(time with time zone) "
          "FROM PUBLIC, anon, authenticated;\n",
    "timestamp_without_time_zone_closes_itself":
        _r9_definer("p_x timestamp without time zone")
        + "REVOKE EXECUTE ON FUNCTION public.review_probe"
          "(timestamp without time zone) FROM PUBLIC, anon, authenticated;\n",
    "interval_day_to_second_closes_itself":
        _r9_definer("p_x interval day to second")
        + "REVOKE EXECUTE ON FUNCTION public.review_probe"
          "(interval day to second) FROM PUBLIC, anon, authenticated;\n",
    "bit_varying_closes_bit_varying":
        _r9_definer("p_x bit varying")
        + "REVOKE EXECUTE ON FUNCTION public.review_probe(bit varying) "
          "FROM PUBLIC, anon, authenticated;\n",
    # `double` as a parameter NAME: the type is `text`, so a REVOKE on `text`
    # closes it. This is the case the lead-word set got wrong before.
    "double_named_parameter_closed_by_its_real_type":
        _r9_definer("double text") + _R9_CLOSE,
    "varying_named_parameter_closed_by_its_real_type":
        _r9_definer("varying text") + _R9_CLOSE,
    "quoted_varying_closes_quoted_varying":
        _r9_definer('p_x "varying"')
        + 'REVOKE EXECUTE ON FUNCTION public.review_probe("varying") '
          "FROM PUBLIC, anon, authenticated;\n",
}

# --- Round 9 finding 2 -----------------------------------------------------
# `public.review_probe(public.review_marker.note%TYPE)` is a PostgreSQL-valid
# way to name an existing routine; live, the GRANT resolves the `%TYPE` and
# `has_function_privilege('authenticated', 'public.review_probe(text)',
# 'EXECUTE')` becomes true. The scanner correctly refuses to treat an
# unresolved argument list as an exact identity match, but ACL replay then read
# "not an exact match" as "definitely unrelated" and dropped the GRANT, so the
# reopened function still looked closed.
UNRESOLVED_GRANT_MUST_REJECT = {
    "unresolved_pct_type_grant_reopens_execute":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION "
          "public.review_probe(public.review_marker.note%TYPE) "
          "TO authenticated;\n",
    "unresolved_pct_type_grant_to_public_reopens_execute":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION "
          "public.review_probe(public.review_marker.note%TYPE) TO PUBLIC;\n",
    "unresolved_grant_unqualified_name_reopens_execute":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION "
          "review_probe(public.review_marker.note%TYPE) TO authenticated;\n",
    # An unresolved REVOKE credits NO closure: a signature nobody could read is
    # not proof that this overload was closed.
    "unresolved_pct_type_revoke_credits_no_closure":
        _r9_definer("p_x text")
        + "REVOKE EXECUTE ON FUNCTION "
          "public.review_probe(public.review_marker.note%TYPE) "
          "FROM PUBLIC, anon, authenticated;\n",
    # Unresolved on BOTH sides is still not a match, in either direction.
    "unresolved_definition_and_unresolved_revoke_do_not_match":
        _r9_definer("p_x public.review_marker.note%TYPE")
        + "REVOKE EXECUTE ON FUNCTION "
          "public.review_probe(public.review_marker.note%TYPE) "
          "FROM PUBLIC, anon, authenticated;\n",
    # An ALTER that promotes a routine it names with an unresolved argument
    # list restates no body and closes nothing.
    "unresolved_alter_security_definer_is_not_closed":
        "CREATE OR REPLACE FUNCTION public.review_probe(p_x text)\n"
        "RETURNS void LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN;\nEND;\n$$;\n"
        + _R9_CLOSE
        + "ALTER FUNCTION public.other_probe(public.review_marker.note%TYPE) "
          "SECURITY DEFINER;\n",
    # An unresolved GRANT that PostgreSQL could resolve to ONE of several
    # overloads reopens the one it might name.
    "unresolved_grant_reopens_one_of_several_overloads":
        _r9_definer("p_x text")
        + _r9_definer("p_x uuid").replace("review_probe(p_x uuid)",
                                          "review_probe(p_x uuid)")
        + _R9_CLOSE
        + "REVOKE EXECUTE ON FUNCTION public.review_probe(uuid) "
          "FROM PUBLIC, anon, authenticated;\n"
        + "GRANT EXECUTE ON FUNCTION "
          "public.review_probe(public.review_marker.note%TYPE) "
          "TO authenticated;\n",
}

UNRESOLVED_GRANT_MUST_ACCEPT = {
    # No global pollution: an unresolved GRANT naming a DIFFERENT routine says
    # nothing about this one.
    "unresolved_grant_for_other_name_does_not_reopen":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION "
          "public.other_probe(public.review_marker.note%TYPE) "
          "TO authenticated;\n",
    # Nor does one in a provably different schema.
    "unresolved_grant_in_other_schema_does_not_reopen":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION "
          "other_schema.review_probe(public.review_marker.note%TYPE) "
          "TO authenticated;\n",
    # An exact GRANT to a NON-client role is not a client reopen.
    "exact_grant_to_non_client_role_does_not_reopen":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION public.review_probe(text) "
          "TO service_role;\n",
    # A plain closure is still a closure.
    "exact_revoke_still_closes":
        _r9_definer("p_x text") + _R9_CLOSE,
}

# --- Round 9 finding 3 -----------------------------------------------------
# `U&"authenticate!0064" /* c */ UESCAPE '!'` is the role `authenticated` to
# PostgreSQL (verified live: the GRANT succeeds and authenticated gains
# EXECUTE). The UESCAPE clause was looked for in RAW bytes, where a comment is
# not whitespace, so the clause was missed, the content was decoded against the
# DEFAULT backslash escape, and the reader returned a plausible but WRONG role
# name. Because it returned a value rather than None, the UNRESOLVED_GRANTEE
# fail-closed path never ran and the reopen was invisible.
UESCAPE_GRANTEE_MUST_REJECT = {
    "uescape_after_block_comment_resolves_to_authenticated":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION public.review_probe(text) "
          "TO U&\"authenticate!0064\" /* c */ UESCAPE '!';\n",
    "uescape_after_nested_block_comment_resolves_to_authenticated":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION public.review_probe(text) "
          "TO U&\"authenticate!0064\" /* a /* b */ c */ UESCAPE '!';\n",
    "uescape_after_line_comment_resolves_to_authenticated":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION public.review_probe(text) "
          "TO U&\"authenticate!0064\" -- c\n UESCAPE '!';\n",
    "uescape_after_tab_resolves_to_authenticated":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION public.review_probe(text) "
          "TO U&\"authenticate!0064\"\tUESCAPE '!';\n",
    "uescape_after_newline_resolves_to_authenticated":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION public.review_probe(text) "
          "TO U&\"authenticate!0064\"\n\nUESCAPE '!';\n",
    "uescape_plain_resolves_to_authenticated":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION public.review_probe(text) "
          "TO U&\"authenticate!0064\" UESCAPE '!';\n",
    "default_backslash_form_resolves_to_authenticated":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION public.review_probe(text) "
          "TO U&\"authenticate\\0064\";\n",
    # A malformed UESCAPE character is a PostgreSQL error, so the grantee is
    # unresolvable and the GRANT must be replayed as reaching every client role.
    "malformed_uescape_grantee_fails_closed":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION public.review_probe(text) "
          "TO U&\"authenticate!0064\" /* c */ UESCAPE '1';\n",
}

UESCAPE_GRANTEE_MUST_ACCEPT = {
    # A case-different delimited role is a DIFFERENT role (PostgreSQL: `role
    # "Authenticated" does not exist`), so it is not a client reopen.
    "uescape_case_different_role_is_not_a_client":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION public.review_probe(text) "
          "TO U&\"Authenticate!0064\" /* c */ UESCAPE '!';\n",
    # A resolvable, unrelated role name reopens nothing.
    "uescape_unrelated_role_is_not_a_client":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE ON FUNCTION public.review_probe(text) "
          "TO U&\"service!005frole\" /* c */ UESCAPE '!';\n",
}

# --- Round 9 finding 4 -----------------------------------------------------
# `GRANT ALL\nPRIVILEGES ON FUNCTION public.review_probe(text) TO authenticated`
# is accepted by PostgreSQL and grants EXECUTE (verified live). The privilege
# head admitted literal ASCII spaces only, so the statement matched no head at
# all and simply disappeared from the ACL replay - the unsafe failure mode, not
# a fail-closed one.
PRIVILEGE_HEAD_MUST_REJECT = {
    "grant_all_newline_privileges_reopens":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT ALL\nPRIVILEGES ON FUNCTION public.review_probe(text) "
          "TO authenticated;\n",
    "grant_all_tab_privileges_reopens":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT ALL\tPRIVILEGES ON FUNCTION public.review_probe(text) "
          "TO authenticated;\n",
    "grant_all_crlf_privileges_reopens":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT ALL\r\nPRIVILEGES ON FUNCTION public.review_probe(text) "
          "TO authenticated;\n",
    "grant_all_vertical_tab_privileges_reopens":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT ALL\x0bPRIVILEGES ON FUNCTION public.review_probe(text) "
          "TO authenticated;\n",
    "grant_all_form_feed_privileges_reopens":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT ALL\x0cPRIVILEGES ON FUNCTION public.review_probe(text) "
          "TO authenticated;\n",
    "grant_all_block_comment_privileges_reopens":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT ALL /* c */ PRIVILEGES ON FUNCTION public.review_probe(text) "
          "TO authenticated;\n",
    "grant_all_line_comment_privileges_reopens":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT ALL -- c\nPRIVILEGES ON FUNCTION public.review_probe(text) "
          "TO authenticated;\n",
    "grant_comma_separated_privileges_reopens":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT EXECUTE,\nEXECUTE ON FUNCTION public.review_probe(text) "
          "TO authenticated;\n",
    "grant_newline_execute_reopens":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT\nEXECUTE\nON\nFUNCTION public.review_probe(text)\n"
          "TO authenticated;\n",
    # `REVOKE GRANT OPTION FOR EXECUTE` withdraws delegation only; the role
    # keeps EXECUTE. Verified live across a newline inside that clause too.
    "revoke_grant_option_for_across_newline_closes_nothing":
        _r9_definer("p_x text")
        + "REVOKE GRANT\nOPTION FOR EXECUTE ON FUNCTION "
          "public.review_probe(text) FROM PUBLIC, anon, authenticated;\n",
}

PRIVILEGE_HEAD_MUST_ACCEPT = {
    "revoke_all_newline_privileges_closes":
        _r9_definer("p_x text")
        + "REVOKE ALL\nPRIVILEGES ON FUNCTION public.review_probe(text) "
          "FROM PUBLIC, anon, authenticated;\n",
    "revoke_all_block_comment_privileges_closes":
        _r9_definer("p_x text")
        + "REVOKE ALL /* c */ PRIVILEGES ON FUNCTION "
          "public.review_probe(text) FROM PUBLIC, anon, authenticated;\n",
    "revoke_execute_across_newlines_closes":
        _r9_definer("p_x text")
        + "REVOKE\nEXECUTE\nON\nFUNCTION public.review_probe(text)\n"
          "FROM PUBLIC, anon, authenticated;\n",
    "revoke_all_tab_privileges_closes":
        _r9_definer("p_x text")
        + "REVOKE ALL\tPRIVILEGES ON FUNCTION public.review_probe(text) "
          "FROM PUBLIC, anon, authenticated;\n",
}

# A malformed privilege head is not a PostgreSQL statement at all
# (`GRANT ALL PRIVILEGE` is a syntax error on PostgreSQL 17), and the scanner
# reads its `ALL` and replays it as a reopen. That is the CONSERVATIVE
# direction - a false red on SQL that could never run - and it is unchanged by
# Round 9: the previous head grammar already admitted `ALL PRIVILEGE` across a
# literal space. It is frozen here so the widened whitespace class is never
# mistaken for having introduced it, and so a later change cannot silently flip
# it to the unsafe direction.
PRIVILEGE_HEAD_CONSERVATIVE_FALSE_RED = {
    "malformed_privilege_head_is_replayed_conservatively":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT ALL PRIVILEGE ON FUNCTION public.review_probe(text) "
          "TO authenticated;\n",
    "malformed_privilege_head_across_newline_is_replayed_conservatively":
        _r9_definer("p_x text") + _R9_CLOSE
        + "GRANT ALL\nPRIVILEGE ON FUNCTION public.review_probe(text) "
          "TO authenticated;\n",
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

    def test_one_postgresql_identifier_identity(self) -> None:
        """Fourth round: the scanner carried three notions of identifier
        identity. These are the false greens each of them produced, all
        end-to-end through check_file()."""
        groups = {
            "astral": IDENTITY_ASTRAL_MUST_REJECT,
            "fold": IDENTITY_FOLD_MUST_REJECT,
            "clip": IDENTITY_CLIP_MUST_REJECT,
        }
        for group, fixtures in groups.items():
            for name, sql in fixtures.items():
                with self.subTest(group=group, reject=name):
                    self.assertTrue(
                        self.verdict(name, sql),
                        f"{name}: scanner identity diverges from PostgreSQL",
                    )
        for name, sql in IDENTITY_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_pg_identifier_is_the_single_identity(self) -> None:
        """The canonicalizer itself: PostgreSQL's order and PostgreSQL's rules."""
        pg = guards._pg_identifier
        # Unquoted folds ASCII A-Z and nothing else.
        self.assertEqual(pg("Rpc_Probe"), "rpc_probe")
        self.assertEqual(pg("RPC_BÄD"), "rpc_bÄd")   # Ä survives
        self.assertNotEqual(pg("rpc_bÄd"), pg("rpc_bäd"))
        # str.lower() would merge those two; PostgreSQL does not.
        self.assertEqual("rpc_bÄd".lower(), "rpc_bäd")
        # Quoted content survives verbatim, case included.
        self.assertEqual(pg("TypeA", quoted=True), "TypeA")
        self.assertNotEqual(pg("Auth_Block", quoted=True), pg("auth_block"))
        # Folding happens BEFORE the clip, and the fold must not change length.
        kelvin = "K" + "a" * 60
        self.assertEqual(len(kelvin.encode("utf-8")), 63)
        self.assertEqual(pg(kelvin + "X"), pg(kelvin + "Y"))
        self.assertEqual(len(pg(kelvin + "X").encode("utf-8")), 63)
        # Astral code points are ordinary identifier characters.
        self.assertEqual(pg("auth\U0001D400"), "auth\U0001D400")
        self.assertTrue(guards._UNQUOTED_IDENT_RE.fullmatch("auth\U0001D400"))
        self.assertTrue(guards._UNQUOTED_IDENT_RE.fullmatch("\U0001D400auth"))
        # The clip is bytes, on a character boundary, never a partial code point.
        for width, char in ((2, "م"), (3, "ก"), (4, "\U0001D400")):
            self.assertEqual(len(char.encode("utf-8")), width)
            over = "a" * (64 - width) + char       # crosses the limit by `width`
            clipped = pg(over)
            self.assertLessEqual(len(clipped.encode("utf-8")), 63)
            self.assertEqual(clipped.encode("utf-8").decode("utf-8"), clipped)
        # Exactly 63 bytes is untouched.
        self.assertEqual(pg("a" * 63), "a" * 63)

    def test_pg_identifier_matches_the_postgresql_17_oracle(self) -> None:
        """Differential gate: every row of the committed oracle was resolved by
        a live PostgreSQL 17 server, and the canonicalizer must agree with all
        of them.

        Four review rounds each found a case where the scanner's identifier
        identity diverged from PostgreSQL's. A hand-written expectation table
        would encode the same assumptions that were wrong, so the expectations
        come from the server: see scripts/ci/generate_pg_identifier_oracle.py
        to regenerate against PostgreSQL 17.
        """
        oracle_path = SCRIPT.with_name("oracles") / "pg_identifier_identity.json"
        self.assertTrue(oracle_path.is_file(), f"missing oracle: {oracle_path}")
        oracle = json.loads(oracle_path.read_text(encoding="utf-8"))
        self.assertEqual(oracle["server_encoding"], "UTF8")
        self.assertEqual(oracle["namedatalen_limit"], guards._NAMEDATALEN_LIMIT)
        self.assertTrue(oracle["server_version"].startswith("PostgreSQL 17."),
                        oracle["server_version"])
        self.assertGreaterEqual(len(oracle["rows"]), 40)
        for row in oracle["rows"]:
            with self.subTest(identifier=row["text"][:24]):
                self.assertEqual(
                    guards._pg_identifier(row["text"]), row["unquoted"],
                    "unquoted identity disagrees with PostgreSQL 17",
                )
                self.assertEqual(
                    guards._pg_identifier(row["text"], quoted=True), row["quoted"],
                    "quoted identity disagrees with PostgreSQL 17",
                )

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

        # Third arm: raise the NAMEDATALEN limit out of reach and the truncation
        # collisions become invisible again, because the two labels compare
        # unequal. Mutating the LIMIT rather than the whole canonicalizer keeps
        # this arm isolated to the clip - the ASCII fold stays intact.
        original_limit = guards._NAMEDATALEN_LIMIT
        try:
            guards._NAMEDATALEN_LIMIT = 10 ** 9
            for name, sql in LABELLED_EXIT_TRUNCATION_MUST_REJECT.items():
                with self.subTest(mutation="no_identifier_clip", case=name):
                    self.assertEqual(
                        self.verdict(name, sql), [],
                        f"{name}: expected the pre-fix false green to return",
                    )
        finally:
            guards._NAMEDATALEN_LIMIT = original_limit

        # Fourth arm: restore Python's full-Unicode fold and every identity that
        # depends on PostgreSQL folding ASCII only comes apart again - U+212A
        # folds to a one-byte `k`, moving the clip and un-merging a pair
        # PostgreSQL had already merged, and `Ä` merges with `ä`, which
        # PostgreSQL keeps distinct.
        original_fold = guards._fold_unquoted
        try:
            guards._fold_unquoted = str.lower
            for name, sql in IDENTITY_FOLD_MUST_REJECT.items():
                with self.subTest(mutation="unicode_fold", case=name):
                    self.assertEqual(
                        self.verdict(name, sql), [],
                        f"{name}: expected the pre-fix false green to return",
                    )
        finally:
            guards._fold_unquoted = original_fold

        # Fifth arm: put the U+FFFF ceiling back on the identifier alphabet and
        # an astral-plane label becomes unreadable, so no label is recorded.
        original_ident = guards._UNQUOTED_IDENT_RE
        try:
            guards._UNQUOTED_IDENT_RE = re.compile(
                "[A-Za-z_-￿][A-Za-z0-9_$-￿]*"
            )
            for name, sql in IDENTITY_ASTRAL_MUST_REJECT.items():
                with self.subTest(mutation="bmp_only_alphabet", case=name):
                    self.assertEqual(
                        self.verdict(name, sql), [],
                        f"{name}: expected the pre-fix false green to return",
                    )
        finally:
            guards._UNQUOTED_IDENT_RE = original_ident

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
            # Round 10: a type MODIFIER is not part of a routine argument
            # type. PostgreSQL 17.11 resolves `numeric(10,2)` in a signature
            # to plain `numeric` (format_type of pg_proc.proargtypes), so the
            # canonical form drops it. The parse it protects - the modifier
            # is read as a modifier and not as a parameter name - is unchanged.
            "p_rate numeric(10,2)": "numeric",
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
        unknowns = guards.parse_procedural_acl_unknown(raw, masked)
        definers = [d for d in definitions if d.is_definer]
        self.assertTrue(definers, "191 defines no SECURITY DEFINER function")
        for definition in definers:
            closed = guards.revoke_closes_client_surface(
                definition.identity, definition.end, privileges, strict=True,
                procedural_unknowns=unknowns,
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

    def test_labelled_exit_inside_boolean_deny_branch_is_rejected(self) -> None:
        """P: an EXIT between THEN and the RAISE skips the denial itself,
        not just the IF that leads to it."""
        for name, sql in BOOLEAN_DENY_EXIT_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: RAISE skipped by an EXIT inside its own deny "
                    f"branch was accepted as a guard",
                )
        for name, sql in BOOLEAN_DENY_EXIT_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_labelled_exit_before_raise_pos_discriminates(self) -> None:
        """The function itself: only an EXIT AFTER `after` and reaching a
        frame around `pos` counts, exactly like `labelled_exit_before` at the
        IF's own position already did for the whole IF."""
        body = (
            "<<auth_block>>\nBEGIN\n"
            "  IF NOT p THEN\n"
            "    EXIT auth_block;\n"
            "    RAISE EXCEPTION 'denied';\n"
            "  END IF;\n"
            "END auth_block;\n"
        )
        frames = guards.parse_blocks(body)
        then_pos = body.index("EXIT")
        raise_pos = body.index("RAISE")
        self.assertTrue(
            guards.labelled_exit_before(body, frames, raise_pos, after=then_pos)
        )
        # An EXIT before `after` (outside the span under test) does not count.
        self.assertFalse(
            guards.labelled_exit_before(body, frames, raise_pos, after=raise_pos)
        )

    def test_sqlstate_literal_forms_are_all_decoded(self) -> None:
        """P: PostgreSQL accepts '...', E'...' and $tag$...$tag$ here - a
        scanner that only reads '...' hides a real P0001 swallow."""
        for name, sql in SQLSTATE_LITERAL_FORM_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in SQLSTATE_LITERAL_FORM_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_unicode_sqlstate_fails_closed(self) -> None:
        for i, handler in enumerate(UNICODE_SQLSTATE_MUST_REJECT):
            with self.subTest(handler=handler):
                self.assertTrue(self.verdict(f"unicode_{i}", definer_outer_handler(handler)))

    def test_continued_literal_cannot_impersonate_a_guard(self) -> None:
        for name, body in CONTINUED_LITERAL_FAKE_GUARDS.items():
            with self.subTest(name=name):
                self.assertTrue(self.verdict(name, definer(body)))
                # The same string preceding a REAL assertion remains valid.
                guarded = body + "\n  PERFORM public.wardah_assert_org_member(p_org);"
                self.assertEqual(self.verdict(name + "_real_guard", definer(guarded)), [])

    def test_ordinary_continuation_does_not_inherit_escape_mode(self) -> None:
        # Without leading E the backslash is content and the quote really
        # closes: the assertion after it executes (PostgreSQL 17.5 control).
        body = "  PERFORM ''\n'\\' ; PERFORM public.wardah_assert_org_member(p_org); --'\n"
        self.assertEqual(self.verdict("ordinary_real_guard", definer(body)), [])

    def test_literal_boundaries_match_for_masking_and_decoding(self) -> None:
        for i, (literal, expected) in enumerate(CONTINUED_LITERAL_VALUES):
            with self.subTest(literal=literal):
                raw = "SQLSTATE " + literal
                masked, problems = guards.mask_sql_checked(raw)
                self.assertEqual(problems, [])
                self.assertEqual(len(masked), len(raw))
                self.assertEqual(
                    guards._read_sqlstate_literal(masked, raw, 0, len("SQLSTATE ")),
                    (expected, False),
                )
                body = "  PERFORM " + literal + ";"
                self.assertTrue(self.verdict(f"literal_{i}_unguarded", definer(body)))
                body += "\n  PERFORM public.wardah_assert_org_member(p_org);"
                self.assertEqual(self.verdict(f"literal_{i}_guarded", definer(body)), [])
                # Also prove the actual exception-handling verdict, including
                # unrelated/invalid SQLSTATE values that do not catch P0001.
                findings = self.verdict(f"literal_{i}_handler", definer_outer_handler(raw))
                self.assertEqual(bool(findings), expected in ("P0001", "P0000"))

    def test_continuation_uses_raw_separators_and_resets_mode(self) -> None:
        for separator in (" ", " /* comment */\n", "\n/* nested /* c */ c */\n"):
            raw = "SQLSTATE E'P00'" + separator + "'01'"
            masked, problems = guards.mask_sql_checked(raw)
            self.assertEqual(problems, [])
            self.assertEqual(
                guards._read_sqlstate_literal(masked, raw, 0, len("SQLSTATE ")),
                ("P00", False),
            )
        body = "  PERFORM E'';\n  PERFORM ''\n'\\';\n"
        body += "  PERFORM public.wardah_assert_org_member(p_org);"
        self.assertEqual(self.verdict("escape_mode_reset", definer(body)), [])

    def test_unknown_sqlstate_operands_and_broken_chains_fail_closed(self) -> None:
        for i, operand in enumerate((
            "U&'P0001'", "U&'P000!0031' UESCAPE '!'", "U&'P00'\n'01'",
            "E'P0'\nU&'001'", "E'P0'\n'\\x'", "E'P0'\n'\\q'",
        )):
            with self.subTest(operand=operand):
                raw = "SQLSTATE " + operand
                masked, _ = guards.mask_sql_checked(raw)
                self.assertEqual(
                    guards._read_sqlstate_literal(masked, raw, 0, len("SQLSTATE ")),
                    (None, True),
                )
                self.assertTrue(self.verdict(f"unknown_{i}", definer_outer_handler(raw)))

    def test_sqlstate_octal_escape_uses_postgresql_byte_semantics(self) -> None:
        """Astra round 2, finding 1: `\\ooo` is a BYTE escape and wraps modulo
        256, not an arbitrary Unicode code point."""
        for name, sql in SQLSTATE_OCTAL_ESCAPE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        # Existing hex/simple/plain forms and unrelated codes must not regress.
        for name, sql in SQLSTATE_LITERAL_FORM_MUST_REJECT.items():
            with self.subTest(no_regression_reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in SQLSTATE_LITERAL_FORM_MUST_ACCEPT.items():
            with self.subTest(no_regression_accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_sqlstate_literals_continue_across_a_newline(self) -> None:
        """Astra round 2, finding 2: PostgreSQL concatenates adjacent string
        constants when the separating whitespace contains a newline."""
        for name, sql in SQLSTATE_CONTINUATION_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in SQLSTATE_CONTINUATION_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_literal_continuation_reader_discriminates(self) -> None:
        """The reader itself: newline-separated segments concatenate, a
        same-line pair does not, and an unparseable continuation fails
        closed rather than silently keeping only the first segment."""
        raw = "SQLSTATE 'P00'\n'01'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("'")
        )
        self.assertEqual(value, "P0001")
        self.assertFalse(unparseable)

        raw = "SQLSTATE 'P00' '01'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("'")
        )
        self.assertEqual(value, "P00")
        self.assertFalse(unparseable)

        # A dollar-quoted literal is a standalone operand, never chained.
        raw = "SQLSTATE $tag$P00$tag$\n'01'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("$")
        )
        self.assertEqual(value, "P00")
        self.assertFalse(unparseable)

        # A continuation segment that cannot be decoded fails closed.
        raw = "SQLSTATE 'P00'\nE'P0\\q01'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("'")
        )
        self.assertIsNone(value)
        self.assertTrue(unparseable)

    def test_sqlstate_continuation_inherits_the_chains_escape_mode(self) -> None:
        """Astra round 3: the escape mode is decided ONCE by the leading
        segment and applies to every continuation segment - verified against
        a live PostgreSQL server, which never lets a continuation segment
        carry its own E/e prefix in the first place."""
        for name, sql in SQLSTATE_CHAINED_ESCAPE_MODE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in SQLSTATE_CHAINED_ESCAPE_MODE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)
        for name, sql in SQLSTATE_ILLEGAL_CONTINUATION_PREFIX_MUST_REJECT.items():
            with self.subTest(illegal_continuation=name):
                self.assertTrue(self.verdict(name, sql), name)

    def test_chained_escape_mode_reader_discriminates(self) -> None:
        """The reader itself: the leading segment's prefix decides the mode
        for the WHOLE chain, an E-prefixed continuation is never legal PG
        syntax and fails closed, and a plain chain never decodes escapes."""
        raw = "SQLSTATE E'P00'\n'0\\x31'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("E'")
        )
        self.assertEqual(value, "P0001")
        self.assertFalse(unparseable)

        raw = "SQLSTATE E'P0'\n'00'\n'\\x31'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("E'")
        )
        self.assertEqual(value, "P0001")
        self.assertFalse(unparseable)

        raw = "SQLSTATE E'235'\n'0\\x35'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("E'")
        )
        self.assertEqual(value, "23505")
        self.assertFalse(unparseable)

        # No leading E'': a continuation's backslash is never an escape.
        raw = "SQLSTATE 'P00'\n'0\\x31'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("'")
        )
        self.assertEqual(value, "P000\\x31")
        self.assertFalse(unparseable)

        # An E-prefixed continuation segment never compiles, in either
        # direction, and must fail closed rather than truncate to the first
        # segment's value.
        raw = "SQLSTATE 'P0'\nE'01'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("'")
        )
        self.assertIsNone(value)
        self.assertTrue(unparseable)

        raw = "SQLSTATE E'P0'\nE'01'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("E'")
        )
        self.assertIsNone(value)
        self.assertTrue(unparseable)

    def test_sqlstate_literal_reader_fails_closed_on_unparseable_content(self) -> None:
        """The reader itself: an opener it cannot confidently decode must
        report unparseable=True, never a silent 'no match'."""
        raw = "SQLSTATE E'P0\\q01'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("E'")
        )
        self.assertIsNone(value)
        self.assertTrue(unparseable)
        # An unterminated dollar tag is unparseable too, not "no literal here".
        raw = "SQLSTATE $tag$P0001"
        value, unparseable = guards._read_sqlstate_literal(
            raw, raw, 0, raw.index("$")
        )
        self.assertIsNone(value)
        self.assertTrue(unparseable)

    def test_quoted_type_whitespace_keeps_overloads_distinct(self) -> None:
        """P: whitespace INSIDE a quoted type identifier is part of its
        identity - PostgreSQL never collapses it, and neither may this
        scanner's tokenizer before the fold step runs."""
        for name, sql in QUOTED_TYPE_WHITESPACE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in QUOTED_TYPE_WHITESPACE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)
        self.assertNotEqual(
            guards._normalize_arg_type('p_x public."Type A"'),
            guards._normalize_arg_type('p_x public."Type  A"'),
        )
        self.assertEqual(
            guards._normalize_arg_type('p_x public."Type  A"'),
            guards._normalize_arg_type('public."Type  A"'),
        )

    def test_quoted_condition_names_are_resolved_to_their_condition(self) -> None:
        """Q1: `WHEN "raise_exception"` catches exactly what `WHEN
        raise_exception` catches; masking blanks the name, so it is read back
        from the raw source and an unresolvable span fails closed."""
        for name, sql in QUOTED_CONDITION_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a quoted condition name swallowed the "
                    f"assertion's authorization failure unnoticed",
                )
        for name, sql in QUOTED_CONDITION_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_array_bounds_belong_to_the_type_not_to_a_name(self) -> None:
        """Q2: `uuid []` and `"Type A" []` are one parameter with no name, so
        the element type must survive normalization."""
        self.assertEqual(guards._normalize_arg_type('"Type A" []'), '"Type A"[]')
        self.assertEqual(guards._normalize_arg_type("uuid []"), "uuid[]")
        self.assertEqual(guards._normalize_arg_type("p_x uuid []"), "uuid[]")
        # Round 10: array BOUNDS are not part of the identity either.
        # PostgreSQL 17.11 resolves an `uuid[4]` argument to `uuid[]`. What
        # this line proves is unchanged: `[4]` belongs to the type, so the
        # parameter is unnamed.
        self.assertEqual(guards._normalize_arg_type("uuid [4]"), "uuid[]")
        self.assertEqual(guards._normalize_arg_type('OUT "Type A" []'), '"Type A"[]')
        self.assertNotEqual(
            guards._normalize_arg_type('public."Type A" []'),
            guards._normalize_arg_type('public."Type B" []'),
        )
        for name, sql in ARRAY_BOUND_TYPE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a REVOKE on a different overload was read as "
                    f"closing the unguarded definer",
                )
        for name, sql in ARRAY_BOUND_TYPE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_unicode_delimited_condition_names_resolve_or_fail_closed(self) -> None:
        """R1: `U&"..."` is a delimited identifier too. PostgreSQL 17.11 refuses
        one in a plpgsql handler condition, so these are not live swallows - but
        an identity this reader cannot PROVE must never be reported as
        non-catching, and an unrelated name must still not invent a red."""
        for name, sql in UNICODE_CONDITION_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in UNICODE_CONDITION_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_the_shared_identifier_reader_decodes_both_spellings(self) -> None:
        """R1: one reader, both spellings, and None for anything unresolvable."""
        self.assertEqual(
            guards._read_delimited_identifier('"raise_exception"', 0)[0],
            "raise_exception",
        )
        self.assertEqual(
            guards._read_delimited_identifier(r'U&"raise_excepti\006Fn"', 0)[0],
            "raise_exception",
        )
        self.assertEqual(
            guards._read_delimited_identifier(r'U&"raise_excepti\+00006Fn"', 0)[0],
            "raise_exception",
        )
        self.assertEqual(
            guards._read_delimited_identifier(
                'U&"raise_excepti!006Fn" UESCAPE \'!\'', 0
            )[0],
            "raise_exception",
        )
        # A doubled quote is an embedded quote, in both spellings.
        self.assertEqual(
            guards._read_delimited_identifier('"a""b"', 0)[0], 'a"b'
        )
        # Quoting prevents FOLDING; it does not change the identifier, so a
        # quoted lower-case name is the same identifier as the bare one.
        self.assertEqual(
            guards._read_delimited_identifier('"uuid"', 0)[0], "uuid"
        )
        for unresolvable in (
            r'U&"bad\00"',                     # truncated escape
            r'U&"bad\+0000"',                  # truncated plus form
            'U&"x" UESCAPE \'a\'',              # a hex digit cannot be the escape
            'U&"x" UESCAPE \'+\'',              # nor can `+`
            r'U&"lone\D800"',                  # a lone surrogate
            r'U&"nul\0000"',                   # NUL is not an identifier char
            '"unterminated',
        ):
            with self.subTest(unresolvable=unresolvable):
                self.assertIsNone(
                    guards._read_delimited_identifier(unresolvable, 0),
                    unresolvable,
                )

    def test_qualified_type_identity_survives_spacing(self) -> None:
        """R2: `"Schema A" . "T" []` is ONE qualified array type, not a name
        followed by `. "T" []`."""
        self.assertEqual(
            guards._normalize_arg_type('"Schema A" . "T" []'),
            guards._normalize_arg_type('"Schema A"."T"[]'),
        )
        self.assertNotEqual(
            guards._normalize_arg_type('"Schema A" . "T" []'),
            guards._normalize_arg_type('"Schema B" . "T" []'),
        )
        self.assertEqual(
            guards._normalize_arg_type("sch_a . t []"),
            guards._normalize_arg_type("sch_a.t[]"),
        )
        self.assertNotEqual(
            guards._normalize_arg_type("sch_a . t []"),
            guards._normalize_arg_type("sch_b . t []"),
        )
        self.assertNotEqual(
            guards._normalize_arg_type('"Schema A" . t []'),
            guards._normalize_arg_type('"Schema B" . t []'),
        )
        self.assertEqual(
            guards._normalize_arg_type('p_x public."Type A" []'),
            guards._normalize_arg_type('public."Type A"[]'),
        )
        # Round 10: DIMENSIONALITY is not part of a routine argument type.
        # PostgreSQL 17.11 resolves `public."Type A"[]` and
        # `public."Type A"[][]` to the SAME pg_proc row (verified with a real
        # custom type, not only a built-in), so the previous assertion pinned
        # a distinction PostgreSQL does not make. The closure this test exists
        # for - a DIFFERENT element type must not merge - is asserted above
        # and by multi_dimensional_bounds_stay_with_their_element_type, both
        # of which still hold.
        self.assertEqual(
            guards._normalize_arg_type('public."Type A" [] []'),
            guards._normalize_arg_type('public."Type A" []'),
        )
        self.assertNotEqual(
            guards._normalize_arg_type('public."Type A" [] []'),
            guards._normalize_arg_type('public."Type B" []'),
        )
        for name, sql in QUALIFIED_TYPE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in QUALIFIED_TYPE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_default_separators_are_found_outside_quoted_identifiers(self) -> None:
        """R3: `DEFAULT` and `=` inside a quoted type name are part of the NAME;
        only a separator at the parameter's top level ends the type."""
        self.assertNotEqual(
            guards._normalize_arg_type('"Type DEFAULT A" []'),
            guards._normalize_arg_type('"Type DEFAULT B" []'),
        )
        self.assertNotEqual(
            guards._normalize_arg_type('"Type=A" []'),
            guards._normalize_arg_type('"Type=B" []'),
        )
        self.assertEqual(
            guards._normalize_arg_type('"Type DEFAULT A" []'),
            '"Type DEFAULT A"[]',
        )
        self.assertEqual(
            guards._normalize_arg_type('p_x "Type DEFAULT A" [] DEFAULT NULL'),
            '"Type DEFAULT A"[]',
        )
        self.assertEqual(
            guards._normalize_arg_type("p_meta jsonb = '{}'::jsonb"), "jsonb"
        )
        self.assertEqual(
            guards._normalize_arg_type('p_x "Ty""pe DEFAULT A"'),
            '"Ty""pe DEFAULT A"',
        )
        self.assertNotEqual(
            guards._normalize_arg_type('"Ty""pe DEFAULT A"'),
            guards._normalize_arg_type('"Ty""pe DEFAULT B"'),
        )
        for name, sql in DEFAULT_IN_QUOTED_TYPE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in DEFAULT_IN_QUOTED_TYPE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_a_present_but_unresolved_argument_list_is_not_a_wildcard(self) -> None:
        """S1: three distinct states - omitted, resolved, present-but-unresolved
        - and only the first two may ever compare equal."""
        omitted = guards.Identity("public", "f", False, None)
        uuid_args = guards.Identity("public", "f", False, ("uuid",))
        text_args = guards.Identity("public", "f", False, ("text",))
        unresolved = guards.Identity("public", "f", False, guards.UNRESOLVED_ARGS)
        # The three states are distinguishable, not one sentinel.
        self.assertIsNot(guards.UNRESOLVED_ARGS, None)
        self.assertNotEqual(uuid_args.args, text_args.args)
        self.assertFalse(uuid_args.same_function(text_args))
        # An omitted list keeps exactly the semantics it always had.
        self.assertTrue(omitted.same_function(uuid_args))
        self.assertTrue(uuid_args.same_function(omitted))
        # An unresolved list matches nothing - not a resolved list, not an
        # omitted one, not even another unresolved one.
        for other in (omitted, uuid_args, text_args, unresolved):
            with self.subTest(other=other.qualified):
                self.assertFalse(unresolved.same_function(other))
                self.assertFalse(other.same_function(unresolved))
        self.assertIn("unresolved", unresolved.qualified)
        # And the parser reaches that state instead of returning None.
        self.assertIs(
            guards._parse_arg_list("p_x public.audit_probe.note%TYPE"),
            guards.UNRESOLVED_ARGS,
        )
        self.assertEqual(guards._parse_arg_list("uuid"), ("uuid",))

    def test_comments_do_not_alter_routine_identity(self) -> None:
        """S1: a comment is whitespace to PostgreSQL, so it must neither create
        a wildcard nor break a real match."""
        for name, sql in UNPARSEABLE_ARGS_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: an unreadable or non-matching signature was "
                    f"treated as closing the unguarded definer",
                )
        for name, sql in UNPARSEABLE_ARGS_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)
        # Structure from the masked span, identifier content from raw.
        self.assertEqual(
            guards._normalize_arg_type("p_x uuid          ", "p_x uuid /* why */"),
            "uuid",
        )

    def test_grantee_identities_use_the_shared_reader(self) -> None:
        """S2: if PostgreSQL resolves a grantee to PUBLIC, anon or
        authenticated, ACL replay must resolve it to the same role."""
        self.assertEqual(
            guards._grantee_names('PUBLIC, anon, U&"authenticate\\0064"'),
            {"public", "anon", "authenticated"},
        )
        self.assertEqual(
            guards._grantee_names("U&\"authenticate!0064\" UESCAPE '!'"),
            {"authenticated"},
        )
        self.assertEqual(
            guards._grantee_names('PUBLIC, anon, "authenticated"'),
            {"public", "anon", "authenticated"},
        )
        self.assertEqual(guards._grantee_names("GROUP service_role"), {"service_role"})
        # A quoted name that differs in CASE is a different role.
        self.assertEqual(guards._grantee_names('"Authenticated"'), {"Authenticated"})
        # `U&` must never be re-read as a bare role named `u`.
        self.assertNotIn("u", guards._grantee_names('U&"reporting_rol\\0065"'))
        self.assertEqual(
            guards._grantee_names('U&"reporting_rol\\0065"'), {"reporting_role"}
        )
        # An unresolvable delimited grantee is recorded as unresolved, not as
        # some other role, and not silently dropped.
        self.assertIn(
            guards.UNRESOLVED_GRANTEE, guards._grantee_names('U&"authenticate\\00"')
        )
        for name, sql in UNICODE_GRANTEE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a GRANT that reopens the function for a client "
                    f"role was not seen",
                )
        for name, sql in UNICODE_GRANTEE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_an_omitted_schema_is_not_a_wildcard(self) -> None:
        """O: an unqualified name resolves through search_path, to public."""
        for name, sql in OMITTED_SCHEMA_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in OMITTED_SCHEMA_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_dollar_tag_recognition_uses_postgresqls_byte_range(self) -> None:
        """Astra round 4: dolq_start/dolq_cont accept every non-ASCII byte, so
        a tag this scanner failed to recognize left the literal's content
        exposed as executable text. Reproduced live on PostgreSQL 17."""
        for name, sql in DOLLAR_TAG_BYTE_RANGE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in DOLLAR_TAG_BYTE_RANGE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_dollar_tag_reader_matches_postgresql(self) -> None:
        """The reader itself, against PostgreSQL's own character classes."""
        for tag in ("$\U0001F600$", "$\u2168$", "$a\u0301$", "$a\u200b$",
                    "$\u00a0$", "$\u00ad$", "$a\ufeff$", "$\ue000$",
                    "$$", "$_$", "$a1$", "$tag$", "$\u00e9$", "$\u3042$"):
            self.assertEqual(guards._dollar_tag_at(tag, 0), tag, tag)
        # Not tags: a digit cannot start one, and neither whitespace nor `$`
        # may appear inside one.
        for text in ("$1$", "$1", "$", "$ $", "$a b$", "$a\t$", "$a\x0b$"):
            self.assertIsNone(guards._dollar_tag_at(text, 0), text)
        # The masker and the SQLSTATE reader must share ONE boundary rule.
        for tag in ("$\U0001F600$", "$a\u0301$", "$$", "$q$"):
            self.assertEqual(
                guards._DOLLAR_TAG_RE.match(tag, 0).group(0),
                guards._dollar_tag_at(tag, 0),
                tag,
            )

    def test_vertical_tab_is_continuation_whitespace_on_postgresql_17(self) -> None:
        """Codex round 4: v17 added \v to scan.l's `space` class, so a VT is
        ordinary whitespace on either side of a quote continuation's newline.
        Missing it truncated the SQLSTATE chain and ended masked literals
        early. Reproduced live on PostgreSQL 17."""
        for name, sql in VERTICAL_TAB_CONTINUATION_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in VERTICAL_TAB_CONTINUATION_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_vertical_tab_continuation_reader_discriminates(self) -> None:
        """The reader itself: a VT joins a chain only alongside a newline, and
        never supplies the newline PostgreSQL requires."""
        raw = "SQLSTATE E'P00'\x0b\n'0\\x31'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("E'")
        )
        self.assertEqual(value, "P0001")
        self.assertFalse(unparseable)

        raw = "SQLSTATE E'P00'\n\x0b'0\\x31'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("E'")
        )
        self.assertEqual(value, "P0001")
        self.assertFalse(unparseable)

        # VT with no newline is NOT a continuation.
        raw = "SQLSTATE 'P00'\x0b'01'"
        masked, _ = guards.mask_sql_checked(raw)
        value, unparseable = guards._read_sqlstate_literal(
            masked, raw, 0, masked.index("'")
        )
        self.assertEqual(value, "P00")
        self.assertFalse(unparseable)
        self.assertIsNone(guards._continuation_quote("'a'\x0b'b'", 3))
        self.assertIsNotNone(guards._continuation_quote("'a'\x0b\n'b'", 3))
        self.assertIsNotNone(guards._continuation_quote("'a'\n\x0b'b'", 3))

    # -- Round 9 (PR #246) --------------------------------------------------

    def test_multi_word_type_phrase_keeps_its_leading_word(self) -> None:
        """Round 9 finding 1: `char varying` is the built-in varchar on
        PostgreSQL 17, but the scanner dropped `char` as an optional parameter
        NAME and normalized the type to `varying` - the identity a quoted
        custom type `"varying"` also produces. Two distinct PostgreSQL
        overloads collapsed, so a REVOKE naming one closed the other."""
        for name, sql in TYPE_PHRASE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in TYPE_PHRASE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_type_phrase_boundary_is_decided_on_two_tokens(self) -> None:
        """Parser-internal: the decision is "do these two tokens open a type
        phrase", not "is the first word ever a type word". A lead word alone is
        not a phrase - `double text` is a parameter NAMED `double` of type
        `text`, which PostgreSQL accepts (identity arguments `double text`) -
        and a delimited `"char"` is the ordinary type of that name."""
        # Round 10: `char varying` IS `character varying` (OID 1043) in
        # PostgreSQL 17.11, so the canonical form is now the resolved type
        # rather than the spelling. Round 9 left these distinct and recorded
        # it as a conservative false RED; it was also a false GREEN, because a
        # GRANT spelled the other way reopens the same routine.
        self.assertEqual(
            guards._normalize_arg_type("char varying"), "character varying"
        )
        self.assertEqual(
            guards._normalize_arg_type("character varying"), "character varying"
        )
        self.assertEqual(guards._normalize_arg_type("p_x char varying"),
                         "character varying")
        self.assertEqual(guards._normalize_arg_type("double precision"),
                         "double precision")
        self.assertEqual(guards._normalize_arg_type("double text"), "text")
        self.assertEqual(guards._normalize_arg_type("varying text"), "text")
        self.assertEqual(guards._normalize_arg_type("bit varying"), "bit varying")
        # `nchar varying` and `national character varying` are the SAME
        # built-in (OID 1043) on PostgreSQL 17.11, so they canonicalize
        # together. Each still keeps its leading word rather than collapsing
        # into the bare `varying` identity, which is the Round 9 closure.
        self.assertEqual(guards._normalize_arg_type("nchar varying"),
                         "character varying")
        self.assertEqual(
            guards._normalize_arg_type("national character varying"),
            "character varying",
        )
        self.assertEqual(
            guards._normalize_arg_type("time with time zone"), "time with time zone"
        )
        self.assertEqual(
            guards._normalize_arg_type("timestamp without time zone"),
            "timestamp without time zone",
        )
        # INTERVAL field qualifiers are a typmod, not a distinct type:
        # PostgreSQL 17.11 resolves `interval day to second` to OID 1186,
        # the same routine argument type as plain `interval`.
        self.assertEqual(
            guards._normalize_arg_type("interval day to second"), "interval"
        )
        self.assertEqual(guards._normalize_arg_type("interval"), "interval")
        self.assertEqual(guards._normalize_arg_type("p_x text"), "text")
        # A DELIMITED lead word is an ordinary type name, never half a phrase.
        self.assertEqual(guards._normalize_arg_type('"char" varying'), "varying")
        # The collapse itself: these two must not share a scanner identity.
        self.assertNotEqual(
            guards._normalize_arg_type("char varying"),
            guards._normalize_arg_type('p_x "varying"'),
        )

    def test_unresolved_grant_target_is_not_assumed_unrelated(self) -> None:
        """Round 9 finding 2: `f(public.t.c%TYPE)` is a PostgreSQL-valid way to
        name an existing routine, and the GRANT really does reopen client
        EXECUTE. Exact identity correctly refuses to match an unresolved
        argument list, but ACL replay read "not an exact match" as "definitely
        unrelated" and dropped the statement."""
        for name, sql in UNRESOLVED_GRANT_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in UNRESOLVED_GRANT_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_exact_identity_and_possible_applicability_stay_distinct(self) -> None:
        """Parser-internal: the two relations must not collapse back into one.
        same_function() stays EXACT - an unresolved list matches nothing, which
        is what stopped it acting as a wildcard REVOKE - while
        may_be_same_function() concedes only the argument list and still uses
        schema and routine name, so one unreadable GRANT cannot reopen every
        routine in the file."""
        def ident(schema, name, args):
            return guards.Identity(schema, name, False, args)

        exact = ident("public", "f", ("text",))
        other = ident("public", "f", ("uuid",))
        unresolved = ident("public", "f", guards.UNRESOLVED_ARGS)
        omitted = ident("public", "f", None)
        elsewhere = ident("other_schema", "f", guards.UNRESOLVED_ARGS)
        different = ident("public", "g", guards.UNRESOLVED_ARGS)

        # EXACT: unresolved proves nothing, in either direction.
        self.assertFalse(exact.same_function(unresolved))
        self.assertFalse(unresolved.same_function(exact))
        self.assertFalse(unresolved.same_function(unresolved))
        self.assertFalse(exact.same_function(other))
        self.assertTrue(exact.same_function(omitted))
        self.assertTrue(exact.same_function(ident("public", "f", ("text",))))

        # POSSIBLE: unresolved might be this routine - but only this NAME, in
        # this SCHEMA.
        self.assertTrue(exact.may_be_same_function(unresolved))
        self.assertTrue(unresolved.may_be_same_function(exact))
        self.assertTrue(unresolved.may_be_same_function(unresolved))
        self.assertFalse(exact.may_be_same_function(elsewhere))
        self.assertFalse(exact.may_be_same_function(different))
        # With both lists resolved, possibility is exactly identity again.
        self.assertFalse(exact.may_be_same_function(other))
        self.assertTrue(exact.may_be_same_function(ident("public", "f", ("text",))))

        # An unqualified name resolves through search_path to `public`, and is
        # not a wildcard over other schemas.
        self.assertTrue(exact.may_be_same_function(ident(None, "f",
                                                         guards.UNRESOLVED_ARGS)))
        self.assertFalse(
            ident("other_schema", "f", ("text",)).may_be_same_function(
                ident(None, "f", guards.UNRESOLVED_ARGS)
            )
        )

    def test_uescape_clause_is_found_across_comments(self) -> None:
        """Round 9 finding 3: PostgreSQL resolves
        `U&"authenticate!0064" /* c */ UESCAPE '!'` to the role
        `authenticated`. The clause was looked for in RAW bytes, where a
        comment is not whitespace, so it was missed, the content was decoded
        against the default backslash escape, and the reader returned a WRONG
        role instead of None - which never trips the fail-closed path."""
        for name, sql in UESCAPE_GRANTEE_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in UESCAPE_GRANTEE_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    def test_delimited_identifier_reader_uses_masked_structure(self) -> None:
        """Parser-internal: STRUCTURE from masked, CONTENT from raw, offsets
        aligned - the same split the parameter path already uses, not a second
        private U& reader and not a regex strip of comments from raw SQL."""
        for spacing in (" ", "  ", "\t", "\n", "\r\n", "\x0b", "\x0c",
                        " /* c */ ", " /* a /* b */ c */ ", " -- c\n "):
            raw = f'U&"authenticate!0064"{spacing}UESCAPE \'!\''
            masked, problems = guards.mask_sql_checked(raw)
            self.assertEqual(problems, [], repr(spacing))
            read = guards._read_delimited_identifier(raw, 0, masked)
            self.assertIsNotNone(read, repr(spacing))
            self.assertEqual(read[0], "authenticated", repr(spacing))
            self.assertEqual(read[1], len(raw), repr(spacing))
        # Default backslash escape when no clause follows.
        raw = 'U&"authenticate\\0064"'
        masked, _ = guards.mask_sql_checked(raw)
        self.assertEqual(
            guards._read_delimited_identifier(raw, 0, masked)[0], "authenticated"
        )
        # A UESCAPE character PostgreSQL rejects is unresolvable here too, even
        # when a comment precedes the clause.
        raw = 'U&"authenticate!0064" /* c */ UESCAPE \'1\''
        masked, _ = guards.mask_sql_checked(raw)
        self.assertIsNone(guards._read_delimited_identifier(raw, 0, masked))
        # Raw and masked stay offset-aligned; masking never shortens the span.
        raw = 'U&"authenticate!0064" /* c */ UESCAPE \'!\''
        masked, _ = guards.mask_sql_checked(raw)
        self.assertEqual(len(masked), len(raw))

    def test_privilege_head_consumes_postgresql_whitespace(self) -> None:
        """Round 9 finding 4: `GRANT ALL\\nPRIVILEGES ON FUNCTION ... TO
        authenticated` is accepted by PostgreSQL and grants EXECUTE, but the
        privilege head admitted literal ASCII spaces only, so the statement
        matched no head and vanished from the ACL replay entirely."""
        for name, sql in PRIVILEGE_HEAD_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, sql), name)
        for name, sql in PRIVILEGE_HEAD_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)
        # Documented conservative false reds, frozen so the direction cannot
        # flip silently.
        for name, sql in PRIVILEGE_HEAD_CONSERVATIVE_FALSE_RED.items():
            with self.subTest(conservative=name):
                self.assertTrue(self.verdict(name, sql), name)

    def test_privilege_head_stays_bounded_to_one_statement(self) -> None:
        """Parser-internal: the head grammar consumes PostgreSQL whitespace and
        masked comments, and NOTHING else - it is not `.*`. A `;` is outside
        its character class, so it can never reach from one statement's GRANT
        into a later statement's ON clause. Python's `\\s` is also not
        PostgreSQL's whitespace: `GRANT ALL\\u00a0PRIVILEGES` is a syntax error
        on PostgreSQL 17, so it must not parse here either."""
        def heads(sql):
            masked, problems = guards.mask_sql_checked(sql)
            self.assertEqual(problems, [])
            return guards.parse_privilege_statements(sql, masked)

        # A semicolon ends the reach of the head.
        self.assertEqual(
            heads("GRANT ALL;\nPRIVILEGES ON FUNCTION public.f(text) "
                  "TO authenticated;"),
            [],
        )
        self.assertEqual(
            heads("GRANT SELECT ON TABLE public.t TO authenticated;\n"
                  "GRANT USAGE ON SCHEMA public TO authenticated;"),
            [],
        )
        # Non-whitespace, non-letter text is outside the class too.
        self.assertEqual(
            heads("GRANT ALL()PRIVILEGES ON FUNCTION public.f(text) "
                  "TO authenticated;"),
            [],
        )
        # Unicode whitespace PostgreSQL rejects must not parse here.
        self.assertEqual(
            heads("GRANT ALL PRIVILEGES ON FUNCTION public.f(text) "
                  "TO authenticated;"),
            [],
        )
        # The PostgreSQL-valid spellings DO parse, and carry their grantee.
        for sep in (" ", "\t", "\n", "\r\n", "\x0b", "\x0c", " /* c */ ",
                    " -- c\n"):
            stmts = heads(f"GRANT ALL{sep}PRIVILEGES ON FUNCTION "
                          f"public.f(text) TO authenticated;")
            self.assertEqual(len(stmts), 1, repr(sep))
            self.assertIn("authenticated", stmts[0].grantees, repr(sep))
            self.assertFalse(stmts[0].is_revoke, repr(sep))
            self.assertFalse(stmts[0].grant_option_only, repr(sep))
        # `REVOKE GRANT OPTION FOR` keeps its own modelling across whitespace.
        stmts = heads("REVOKE GRANT\nOPTION FOR EXECUTE ON FUNCTION "
                      "public.f(text) FROM authenticated;")
        self.assertEqual(len(stmts), 1)
        self.assertTrue(stmts[0].is_revoke)
        self.assertTrue(stmts[0].grant_option_only)
        # ... and `GRANT OPTION FOR` still never begins a GRANT statement.
        self.assertTrue(all(s.is_revoke for s in stmts))

    def test_privilege_text_in_a_routine_body_is_not_migration_time_acl(
        self,
    ) -> None:
        """ROUND10-A. Creating a routine does not execute its body, so privilege
        text inside one may neither close nor reopen the migration's ACL state.
        PostgreSQL 17.11 confirms the victim stays publicly executable."""
        for name, sql in ROUND10_BODY_PRIVILEGE_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: routine-body privilege text was replayed as a "
                    f"migration-time closure",
                )
        for name, sql in ROUND10_BODY_PRIVILEGE_MUST_ACCEPT.items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.verdict(name, sql),
                    [],
                    f"{name}: a genuine top-level closure was lost",
                )

    def test_privilege_statements_are_read_only_at_migration_top_level(
        self,
    ) -> None:
        """ROUND10-A, parser-internal. The statements the ACL replay consumes
        are exactly the top-level ones; a body contributes none, and a real
        top-level statement after a CREATE is still seen."""
        sql = (
            "CREATE FUNCTION public.decoy() RETURNS void\n"
            "LANGUAGE plpgsql AS $$\n"
            "BEGIN\n"
            "  REVOKE EXECUTE ON FUNCTION public.victim() FROM PUBLIC;\n"
            "  GRANT EXECUTE ON FUNCTION public.victim() TO authenticated;\n"
            "END;\n"
            "$$;\n"
            "REVOKE EXECUTE ON FUNCTION public.victim() FROM PUBLIC;\n"
        )
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        stmts = guards.parse_privilege_statements(sql, masked)
        self.assertEqual(len(stmts), 1, "only the top-level statement counts")
        self.assertTrue(stmts[0].is_revoke)
        self.assertGreater(stmts[0].start, sql.index("$$;"))

    def test_postgresql_equivalent_type_spellings_resolve_together(self) -> None:
        """ROUND10-B. A GRANT spelled with an equivalent type name reaches the
        same routine in PostgreSQL and must reopen it; a REVOKE spelled that way
        is a real closure. Every pair was confirmed on PostgreSQL 17.11."""
        for name, sql in ROUND10_ALIAS_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: an applicable GRANT was ignored, or two distinct "
                    f"types were merged",
                )
        for name, sql in ROUND10_ALIAS_MUST_ACCEPT.items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.verdict(name, sql),
                    [],
                    f"{name}: an equivalent REVOKE spelling was not credited",
                )

    def test_quoted_type_identity_follows_postgresql_resolution(self) -> None:
        """ROUND10-C. Quotedness is neither always cosmetic nor always
        significant. `"char"` is OID 18 and `char` is OID 1042, so a REVOKE on
        one may not close the other; `"uuid"` and `uuid` are one type, so it
        must. Classified with PostgreSQL 17.11, not intuition."""
        for name, sql in ROUND10_QUOTED_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a REVOKE closed a DIFFERENT type's overload",
                )
        for name, sql in ROUND10_QUOTED_MUST_ACCEPT.items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.verdict(name, sql),
                    [],
                    f"{name}: a REVOKE on the same type was not credited",
                )

    def test_exact_identity_and_grant_applicability_stay_separate(self) -> None:
        """ROUND10 cross-cutting. Exact identity (REVOKE credit) and possible
        identity (GRANT reopening) are different questions and must not be
        forced through one equality operator. An unreadable custom spelling
        proves nothing for a REVOKE, yet must not be assumed harmless for a
        GRANT."""
        def ident(text):
            sql = f"REVOKE EXECUTE ON FUNCTION {text} FROM PUBLIC;"
            masked, problems = guards.mask_sql_checked(sql)
            self.assertEqual(problems, [])
            stmts = guards.parse_privilege_statements(sql, masked)
            self.assertEqual(len(stmts), 1, text)
            return stmts[0].targets[0]

        varchar = ident("public.f(character varying)")
        alias = ident("public.f(varchar)")
        # An alias is the SAME routine in both relations.
        self.assertTrue(varchar.same_function(alias))
        self.assertTrue(varchar.may_be_same_function(alias))

        bare_char = ident("public.f(char)")
        quoted_char = ident('public.f("char")')
        # Different types: no closure credit, in either direction.
        self.assertFalse(bare_char.same_function(quoted_char))
        self.assertFalse(quoted_char.same_function(bare_char))

        other = ident("public.f(uuid)")
        self.assertFalse(varchar.same_function(other))
        self.assertFalse(varchar.may_be_same_function(other))

        # A quoted CUSTOM type cannot be proven equal to its bare spelling, so
        # it earns no REVOKE credit but still counts as a possible GRANT target.
        bare_custom = ident("public.f(wardah_kind)")
        quoted_custom = ident('public.f("wardah_kind")')
        self.assertFalse(bare_custom.same_function(quoted_custom))
        self.assertTrue(bare_custom.may_be_same_function(quoted_custom))

    def test_round11_confirmed_p2_do_corpus_is_rejected(self) -> None:
        """ROUND11. The eight executable false-greens on e514eb4 must fail closed."""
        for name, sql in ROUND11_P2_MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: unguarded SECURITY DEFINER accepted after a DO "
                    f"whose ACL effect is not statically provable",
                )

    def test_round11_do_closures_are_conservative_false_reds(self) -> None:
        """ROUND11. Reachable DO REVOKEs that PostgreSQL actually runs are no
        longer credited as closures. That is a documented false-red, not a
        soundness regression."""
        for name, sql in ROUND11_CONSERVATIVE_FALSE_RED.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a DO-based ACL mutation was still treated as a "
                    f"proven top-level closure",
                )

    def test_round11_ordering_and_recovery(self) -> None:
        """ROUND11. UNKNOWN does not poison the file forever; a later exact
        top-level statement restores proof. Ordering matters."""
        for name, sql in ROUND11_ORDERING_MUST_REJECT.items():
            with self.subTest(reject=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: final ACL state was treated as CLOSED",
                )
        for name, sql in ROUND11_ORDERING_MUST_ACCEPT.items():
            with self.subTest(accept=name):
                self.assertEqual(
                    self.verdict(name, sql),
                    [],
                    f"{name}: a later exact top-level REVOKE did not restore "
                    f"closure, or a harmless DO poisoned ACL",
                )

    def test_round11_privilege_statements_ignore_do_bodies(self) -> None:
        """ROUND11, parser-internal. Lexical GRANT/REVOKE inside DO is not a
        top-level privilege statement. A real top-level REVOKE after the DO
        is still seen."""
        sql = (
            "CREATE FUNCTION public.review_probe() RETURNS text\n"
            "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "BEGIN\n"
            "  RETURN 'unguarded';\n"
            "END;\n"
            "$$;\n"
            "DO $$\n"
            "BEGIN\n"
            "  REVOKE EXECUTE ON FUNCTION public.review_probe() "
            "FROM PUBLIC, anon, authenticated;\n"
            "  EXECUTE 'GRANT EXECUTE ON FUNCTION public.review_probe() "
            "TO authenticated';\n"
            "END;\n"
            "$$;\n"
            "REVOKE EXECUTE ON FUNCTION public.review_probe() FROM PUBLIC;\n"
        )
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        stmts = guards.parse_privilege_statements(sql, masked)
        self.assertEqual(len(stmts), 1)
        self.assertTrue(stmts[0].is_revoke)
        self.assertGreater(stmts[0].start, sql.rindex("$$;"))
        unknowns = guards.parse_procedural_acl_unknown(sql, masked)
        self.assertEqual(len(unknowns), 1)
        self.assertLess(unknowns[0], stmts[0].start)

    def test_round11_do_discovery_skips_routine_bodies(self) -> None:
        """ROUND11. CREATE FUNCTION body EXECUTE is not a migration-time DO."""
        sql = (
            "CREATE FUNCTION public.review_probe() RETURNS text\n"
            "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "BEGIN\n"
            "  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.review_probe() "
            "FROM PUBLIC';\n"
            "  RETURN 'unguarded';\n"
            "END;\n"
            "$$;\n"
            "DO $$\n"
            "BEGIN\n"
            "  PERFORM 1;\n"
            "END;\n"
            "$$;\n"
        )
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        blocks = guards.parse_do_blocks(masked)
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].start, sql.index("\nDO $$") + 1)
        self.assertEqual(guards.parse_procedural_acl_unknown(sql, masked), [])
        self.assertFalse(
            guards.do_is_acl_uncertain(blocks[0], sql, masked),
            "PERFORM 1 must not poison ACL",
        )


# ---------------------------------------------------------------------------
# Round 10 remediation (PR #246). Three unique acceptance-layer false-greens,
# each reproduced against the Round 9 head d9cf2af1ed9ec8b8167cb37bcffb4363165fba3b
# and each confirmed executable on PostgreSQL 17.11.
#
# ROUND10-A (Codex). STATEMENT LOCATION. parse_privilege_statements() scanned
# the WHOLE masked migration for GRANT/REVOKE heads. A routine body is masked
# only for its comments and literals - the executable text is deliberately kept,
# because that is where guards are found - so a `REVOKE EXECUTE ON FUNCTION
# victim() FROM PUBLIC` written as a STATEMENT INSIDE another routine's body was
# recorded as a migration-time revoke. Creating a routine does not execute its
# body: PostgreSQL leaves victim() publicly executable, and the oracle confirms
# `has_function_privilege('public', 'public.victim_x()', 'EXECUTE')` is still
# true after both CREATEs. The ACL replay closed the function on paper and
# check_file() returned [].
#
# ROUND10-B (Astra). TYPE ALIAS EQUIVALENCE. Resolved argument types stayed
# textual, and may_be_same_function() compared them with plain equality, so
# `character varying` and `varchar` read as unrelated. PostgreSQL resolves both
# to OID 1043 and therefore to the SAME routine, so a GRANT spelled the other
# way reopened client EXECUTE while the scanner still reported closure. The
# oracle confirms the reopen. Round 9 documented surviving alias spellings as
# conservative false REDS only; for GRANT applicability that was false, and the
# same class covers ignored type MODIFIERS (`varchar(10)` == `varchar`) and
# array element spellings (`int[]` == `integer[]`), both PostgreSQL-confirmed.
#
# ROUND10-C (Astra). QUOTED TYPE IDENTITY. _render_type_tokens() dropped the
# quotes from any resolved identifier whose text was already bare-legal, so
# `"char"` rendered as `char`. PostgreSQL does not agree: bare `char` reaches
# the grammar keyword and means bpchar (OID 1042), while `"char"` is a typname
# lookup and means the internal one-byte type (OID 18). They are two DIFFERENT
# overloads that coexist, and the oracle confirms a REVOKE on `review_probe(
# "char")` leaves `review_probe(char)` executable by PUBLIC. The scanner
# credited that revoke to the definer overload.
#
# Quoting is NOT uniformly cosmetic and NOT uniformly significant, so neither
# naive rule is adopted. PostgreSQL 17.11 was used as the oracle to classify
# every spelling: `"varchar"`, `"text"`, `"numeric"`, `"bool"`, `"timestamp"`,
# `"time"` and `"uuid"` DO resolve to their bare counterparts (they are real
# pg_type typnames), `"int"`, `"integer"`, `"boolean"`, `"decimal"`,
# `"character"`, `"real"`, `"bigint"`, `"smallint"` do not exist at all, and
# `"char"` resolves to a different type than `char`. Schema qualification
# behaves like quoting, not like the keyword: `pg_catalog.char` is OID 18.
# ---------------------------------------------------------------------------


def _definer(name: str = "public.victim", args: str = "") -> str:
    """An unguarded SECURITY DEFINER routine: the only thing that can exempt it
    is an ACL closure, so these fixtures isolate the privilege replay."""
    return (
        f"CREATE FUNCTION {name}({args}) RETURNS text\n"
        f"LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
        f"BEGIN\n"
        f"  RETURN 'secret';\n"
        f"END;\n"
        f"$$;\n"
    )


def _close(name: str = "public.victim", args: str = "") -> str:
    return (
        f"REVOKE EXECUTE ON FUNCTION {name}({args})\n"
        f"  FROM PUBLIC, anon, authenticated;\n"
    )



def _overload(args: str, name: str = "public.review_probe") -> str:
    """A second, INVOKER overload with a DIFFERENT argument type.

    A control that only revokes a signature nobody declared is not executable
    SQL - PostgreSQL rejects the REVOKE outright - so it proves nothing about a
    running database. Declaring the other overload makes the fixture real: two
    routines coexist, the REVOKE names one, and the oracle can confirm the
    SECURITY DEFINER one is still reachable by a client.
    """
    return (
        f"CREATE FUNCTION {name}({args}) RETURNS text\n"
        f"LANGUAGE plpgsql AS $$\n"
        f"BEGIN\n"
        f"  RETURN 'other';\n"
        f"END;\n"
        f"$$;\n"
    )


# --- ROUND10-A: privilege text inside a routine body ------------------------
ROUND10_BODY_PRIVILEGE_MUST_REJECT = {
    # (A) The reproducer: an INVOKER decoy whose body is a REVOKE statement.
    "round10_body_revoke_does_not_close": _definer() + """
CREATE FUNCTION public.decoy() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.victim() FROM PUBLIC, anon, authenticated;
END;
$$;
""",
    # (E) The same text spread over several lines, as PostgreSQL accepts it.
    "round10_body_revoke_multiline": _definer() + """
CREATE FUNCTION public.decoy() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  REVOKE ALL
  PRIVILEGES ON FUNCTION public.victim()
  FROM PUBLIC, anon, authenticated;
END;
$$;
""",
    # (F) Conflicting privilege text in two bodies: neither may move ACL state.
    "round10_two_bodies_conflicting_privileges": _definer() + """
CREATE FUNCTION public.decoy_a() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.victim() FROM PUBLIC, anon, authenticated;
END;
$$;

CREATE FUNCTION public.decoy_b() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.victim() TO authenticated;
END;
$$;
""",
    # The decoy is created BEFORE the victim.
    "round10_body_revoke_before_the_victim": """
CREATE FUNCTION public.decoy() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.victim() FROM PUBLIC, anon, authenticated;
END;
$$;
""" + _definer(),
    # A SECURITY DEFINER decoy body is no more executable at migration time.
    "round10_definer_body_revoke_does_not_close": _definer() + """
CREATE FUNCTION public.decoy() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM wardah_assert_org_member(p_org_id);
  REVOKE EXECUTE ON FUNCTION public.victim() FROM PUBLIC, anon, authenticated;
END;
$$;
""",
    # A custom dollar tag is still a routine body.
    "round10_body_revoke_custom_dollar_tag": _definer() + """
CREATE FUNCTION public.decoy() RETURNS void
LANGUAGE plpgsql AS $wardah$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.victim() FROM PUBLIC, anon, authenticated;
END;
$wardah$;
""",
    # Nested BEGIN/END inside the body changes nothing.
    "round10_body_revoke_nested_block": _definer() + """
CREATE FUNCTION public.decoy() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    REVOKE EXECUTE ON FUNCTION public.victim() FROM PUBLIC, anon, authenticated;
  END;
END;
$$;
""",
    # A LANGUAGE sql body is a body too.
    "round10_sql_language_body_revoke": _definer() + """
CREATE FUNCTION public.decoy() RETURNS void
LANGUAGE sql AS $$
  REVOKE EXECUTE ON FUNCTION public.victim() FROM PUBLIC, anon, authenticated;
$$;
""",
    # (D) A top-level GRANT after a top-level REVOKE must still REOPEN.
    "round10_top_level_grant_reopens_after_revoke": _definer() + _close() + """
GRANT EXECUTE ON FUNCTION public.victim() TO authenticated;
""",
}

ROUND10_BODY_PRIVILEGE_MUST_ACCEPT = {
    # (C) A valid TOP-LEVEL revoke after a decoy CREATE must still close.
    "round10_top_level_revoke_after_decoy_closes": _definer() + """
CREATE FUNCTION public.decoy() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RETURN;
END;
$$;
""" + _close(),
    # (B) Body GRANT text must not REOPEN a genuine top-level closure either.
    "round10_body_grant_does_not_reopen": _definer() + _close() + """
CREATE FUNCTION public.decoy() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.victim() TO authenticated;
END;
$$;
""",
    # A DO block DOES execute at migration time, so its revoke is not a body.
    # It is not credited as a closure either (conservative), so this fixture
    # closes at top level and merely proves the DO block breaks nothing.
    "round10_do_block_alongside_top_level_closure": _definer() + _close() + """
DO $$
BEGIN
  PERFORM 1;
END;
$$;
""",
}

MUST_REJECT.update(ROUND10_BODY_PRIVILEGE_MUST_REJECT)
MUST_ACCEPT.update(ROUND10_BODY_PRIVILEGE_MUST_ACCEPT)


# --- ROUND10-B: PostgreSQL-equivalent type spellings ------------------------
# Each pair is (created_spelling, equivalent_spelling), PostgreSQL 17.11 having
# confirmed that both name the SAME routine.
ROUND10_ALIAS_PAIRS = (
    ("character varying", "varchar"),
    ("varchar", "character varying"),
    ("varchar", "char varying"),
    ("varchar", "national character varying"),
    ("character", "char"),
    ("char", "bpchar"),
    ("character", "nchar"),
    ("numeric", "decimal"),
    ("decimal", "numeric"),
    ("integer", "int"),
    ("int", "int4"),
    ("smallint", "int2"),
    ("bigint", "int8"),
    ("real", "float4"),
    ("double precision", "float8"),
    ("float8", "float"),
    ("boolean", "bool"),
    ("timestamptz", "timestamp with time zone"),
    ("timestamp", "timestamp without time zone"),
    ("timetz", "time with time zone"),
    ("time", "time without time zone"),
    ("varbit", "bit varying"),
    # Type modifiers are IGNORED in a routine signature.
    ("varchar", "varchar(10)"),
    ("numeric", "numeric(10,2)"),
    ("timetz", "time(3) with time zone"),
    # Array element spellings alias, and dimensionality is not part of identity.
    ("int[]", "integer[]"),
    ("int[]", "int[][]"),
    # Schema qualification through pg_catalog resolves to the same type.
    ("varchar", "pg_catalog.varchar"),
    ("int", "pg_catalog.int4"),
)

ROUND10_ALIAS_MUST_REJECT = {}
ROUND10_ALIAS_MUST_ACCEPT = {}
for _i, (_a, _b) in enumerate(ROUND10_ALIAS_PAIRS):
    _slug = f"round10_alias_{_i}"
    # A GRANT spelled the OTHER way reaches the same routine and reopens it.
    ROUND10_ALIAS_MUST_REJECT[f"{_slug}_grant_reopens"] = (
        _definer("public.review_probe", _a)
        + _close("public.review_probe", _a)
        + f"GRANT EXECUTE ON FUNCTION public.review_probe({_b}) TO authenticated;\n"
    )
    # ... and a REVOKE spelled the other way is a real closure of the same
    # routine, so it must be credited rather than read as a different overload.
    ROUND10_ALIAS_MUST_ACCEPT[f"{_slug}_revoke_closes"] = (
        _definer("public.review_probe", _a)
        + _close("public.review_probe", _b)
    )

# Controls: canonicalization must NOT merge two types PostgreSQL keeps apart.
# Each declares the overload it revokes, so the fixture is executable SQL and
# the oracle can watch the SECURITY DEFINER overload stay reachable.
ROUND10_ALIAS_DISTINCT = (
    ("public.wardah_kind_a", "public.wardah_kind_b"),
    ("alpha.wardah_kind", "beta.wardah_kind"),
    ("public.varchar_lookalike", "varchar"),
    ("smallint", "integer"),
    ("timestamp with time zone", "timestamp without time zone"),
    ("real", "double precision"),
    ("int[]", "int"),
    ("bit", "bit varying"),
)
for _a, _b in ROUND10_ALIAS_DISTINCT:
    ROUND10_ALIAS_MUST_REJECT[
        f"round10_distinct_{_a}_vs_{_b}".replace(" ", "_").replace(".", "_")
        .replace("[", "").replace("]", "")
    ] = (
        _definer("public.review_probe", _a)
        + _overload(_b)
        + _close("public.review_probe", _b)
    )

MUST_REJECT.update(ROUND10_ALIAS_MUST_REJECT)
MUST_ACCEPT.update(ROUND10_ALIAS_MUST_ACCEPT)


# --- ROUND10-C: quoted vs unquoted type identity ----------------------------
# PostgreSQL 17.11 resolves the quoted form through pg_type.typname and the
# bare form through the grammar's type keywords. Where those disagree, the two
# spellings are DIFFERENT types.
# (created, revoked) - two REAL, coexisting overloads that PostgreSQL 17.11
# resolves to different type OIDs, so the revoke earns no credit for the other.
ROUND10_QUOTED_DISTINCT = (
    ("char", '"char"'),
    ('"char"', "char"),
    ("character", '"char"'),
    ('"char"', "bpchar"),
    # Qualification bypasses the keyword grammar: `pg_catalog.char` is OID 18.
    ("char", "pg_catalog.char"),
)
# Quoted spellings that do NOT exist as types at all on PostgreSQL 17.11, so a
# migration containing one fails outright. They stay here as scanner controls -
# such a spelling must never be credited as a closure - and the oracle reports
# them as not PostgreSQL-valid rather than pretending they executed.
ROUND10_QUOTED_NONEXISTENT = (
    ("int", '"int"'),
    ("integer", '"integer"'),
    ("boolean", '"boolean"'),
    ("numeric", '"decimal"'),
    ("character", '"character"'),
)
# Quoted spellings that ARE real typnames and DO resolve to the bare form.
ROUND10_QUOTED_SAME = (
    ("varchar", '"varchar"'),
    ("text", '"text"'),
    ("numeric", '"numeric"'),
    ("bool", '"bool"'),
    ("timestamp", '"timestamp"'),
    ("time", '"time"'),
    ("uuid", '"uuid"'),
    ("date", '"date"'),
    ("jsonb", '"jsonb"'),
    ("character", '"bpchar"'),
    ("int", '"int4"'),
    ("timestamptz", '"timestamptz"'),
    ('"char"', 'pg_catalog."char"'),
)

ROUND10_QUOTED_MUST_REJECT = {
    # The reproducer: two REAL overloads, and the revoke names the other one.
    "round10_quoted_char_overload_does_not_close_bare_char": (
        _definer("public.review_probe", "char")
        + """
CREATE FUNCTION public.review_probe("char") RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'other';
END;
$$;
"""
        + _close("public.review_probe", '"char"')
    ),
}
for _i, (_a, _b) in enumerate(ROUND10_QUOTED_DISTINCT):
    ROUND10_QUOTED_MUST_REJECT[f"round10_quoted_distinct_{_i}"] = (
        _definer("public.review_probe", _a)
        + _overload(_b)
        + _close("public.review_probe", _b)
    )
for _i, (_a, _b) in enumerate(ROUND10_QUOTED_NONEXISTENT):
    ROUND10_QUOTED_MUST_REJECT[f"round10_quoted_nonexistent_{_i}"] = (
        _definer("public.review_probe", _a) + _close("public.review_probe", _b)
    )

ROUND10_QUOTED_MUST_ACCEPT = {}
for _i, (_a, _b) in enumerate(ROUND10_QUOTED_SAME):
    ROUND10_QUOTED_MUST_ACCEPT[f"round10_quoted_same_{_i}"] = (
        _definer("public.review_probe", _a) + _close("public.review_probe", _b)
    )

MUST_REJECT.update(ROUND10_QUOTED_MUST_REJECT)
MUST_ACCEPT.update(ROUND10_QUOTED_MUST_ACCEPT)


# ---------------------------------------------------------------------------
# Round 11 remediation (PR #246). Round 10 at e514eb4 left an executable
# false-green class around DO-block ACL semantics: static GRANT/REVOKE text
# inside a DO was replayed as if it definitely ran, and dynamic SQL was
# invisible because the payload is a string. PostgreSQL 17.11 confirmed eight
# P2 false-greens. Round 11 does not interpret IF/LOOP/EXCEPTION. A DO that
# might change routine EXECUTE is PROCEDURAL_ACL_UNKNOWN; UNKNOWN is not
# closure. Previously safe DO-based closures become conservative false-reds.
# ---------------------------------------------------------------------------

def _r11_probe() -> str:
    return (
        "CREATE FUNCTION public.review_probe()\n"
        "RETURNS text\n"
        "LANGUAGE plpgsql\n"
        "SECURITY DEFINER\n"
        "AS $body$\n"
        "BEGIN\n"
        "  RETURN 'unguarded';\n"
        "END;\n"
        "$body$;\n"
    )


def _r11_close() -> str:
    return (
        "REVOKE EXECUTE ON FUNCTION public.review_probe()\n"
        "FROM PUBLIC, anon, authenticated;\n"
    )


def _r11_grant_auth() -> str:
    return (
        "GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated;\n"
    )


ROUND11_P2_MUST_REJECT = {
    "round11_a_unreachable_static_revoke": _r11_probe() + """
DO $do$
BEGIN
  IF false THEN
    REVOKE EXECUTE ON FUNCTION public.review_probe()
    FROM PUBLIC, anon, authenticated;
  END IF;
END;
$do$;
""",
    "round11_a4_nested_unreachable_static_revoke": _r11_probe() + """
DO $$
BEGIN
  IF true THEN
    IF false THEN
      REVOKE EXECUTE ON FUNCTION public.review_probe()
      FROM PUBLIC, anon, authenticated;
    END IF;
  END IF;
END;
$$;
""",
    "round11_a5_exception_only_static_revoke": _r11_probe() + """
DO $$
BEGIN
  BEGIN
    NULL;
  EXCEPTION WHEN OTHERS THEN
    REVOKE EXECUTE ON FUNCTION public.review_probe()
    FROM PUBLIC, anon, authenticated;
  END;
END;
$$;
""",
    "round11_b_reachable_dynamic_grant": _r11_probe() + _r11_close() + """
DO $do$
BEGIN
  EXECUTE
    'GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated';
END;
$do$;
""",
    "round11_b3_dynamic_grant_behind_if_true": _r11_probe() + _r11_close() + """
DO $do$
BEGIN
  IF true THEN
    EXECUTE
      'GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated';
  END IF;
END;
$do$;
""",
    "round11_b4_execute_format_grant": _r11_probe() + _r11_close() + """
DO $do$
BEGIN
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated'
  );
END;
$do$;
""",
    "round11_b5_concatenated_constant_grant": _r11_probe() + _r11_close() + """
DO $do$
BEGIN
  EXECUTE
    'GRANT EXECUTE ON FUNCTION public.review_probe()'
    || ' TO authenticated';
END;
$do$;
""",
    "round11_b6_variable_assembled_grant": _r11_probe() + _r11_close() + """
DO $do$
DECLARE
  sql1 text;
  sql2 text;
BEGIN
  sql1 := 'GRANT EXECUTE ON FUNCTION public.review_probe()';
  sql2 := ' TO authenticated';
  EXECUTE sql1 || sql2;
END;
$do$;
""",
}

ROUND11_CONSERVATIVE_FALSE_RED = {
    "round11_a1_reachable_static_revoke": _r11_probe() + """
DO $do$
BEGIN
  IF true THEN
    REVOKE EXECUTE ON FUNCTION public.review_probe()
    FROM PUBLIC, anon, authenticated;
  END IF;
END;
$do$;
""",
    "round11_a2_unconditional_static_revoke": _r11_probe() + """
DO $do$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.review_probe()
  FROM PUBLIC, anon, authenticated;
END;
$do$;
""",
    "round11_a3_unreachable_static_grant_after_close": _r11_probe() + _r11_close() + """
DO $do$
BEGIN
  IF false THEN
    GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated;
  END IF;
END;
$do$;
""",
    "round11_b1_reachable_dynamic_revoke": _r11_probe() + """
DO $do$
BEGIN
  EXECUTE
    'REVOKE EXECUTE ON FUNCTION public.review_probe() FROM PUBLIC, anon, authenticated';
END;
$do$;
""",
    "round11_b2_unreachable_dynamic_grant": _r11_probe() + _r11_close() + """
DO $do$
BEGIN
  IF false THEN
    EXECUTE
      'GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated';
  END IF;
END;
$do$;
""",
    "round11_b7_exception_only_dynamic_grant": _r11_probe() + _r11_close() + """
DO $do$
BEGIN
  BEGIN
    NULL;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE
      'GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated';
  END;
END;
$do$;
""",
    "round11_b8_zero_iteration_dynamic_grant": _r11_probe() + _r11_close() + """
DO $do$
BEGIN
  FOR i IN 1..0 LOOP
    EXECUTE
      'GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated';
  END LOOP;
END;
$do$;
""",
}

ROUND11_ORDERING_MUST_REJECT = {
    "round11_revoke_then_unknown_stays_unknown": _r11_probe() + _r11_close() + """
DO $do$
BEGIN
  EXECUTE
    'GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated';
END;
$do$;
""",
    "round11_revoke_unknown_then_grant_is_open": _r11_probe() + _r11_close() + """
DO $do$
BEGIN
  EXECUTE
    'SELECT 1';
END;
$do$;
""" + _r11_grant_auth(),
    "round11_unknown_revoke_then_grant_is_open": _r11_probe() + """
DO $do$
BEGIN
  EXECUTE
    'SELECT 1';
END;
$do$;
""" + _r11_close() + _r11_grant_auth(),
}

ROUND11_ORDERING_MUST_ACCEPT = {
    "round11_unknown_then_exact_revoke_closes": _r11_probe() + """
DO $do$
BEGIN
  EXECUTE
    'GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated';
END;
$do$;
""" + _r11_close(),
    "round11_harmless_do_does_not_poison": _r11_probe() + _r11_close() + """
DO $$
BEGIN
  PERFORM 1;
END;
$$;
""",
    "round11_routine_body_execute_is_not_migration_acl": _r11_probe() + _r11_close() + """
CREATE FUNCTION public.decoy() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated';
END;
$$;
""",
    "round11_on_conflict_do_nothing_is_not_a_do_block": _r11_probe() + _r11_close() + """
INSERT INTO public.permissions (permission_key)
VALUES ('x')
ON CONFLICT (permission_key) DO NOTHING;
""",
}

MUST_REJECT.update(ROUND11_P2_MUST_REJECT)
MUST_REJECT.update(ROUND11_CONSERVATIVE_FALSE_RED)
MUST_REJECT.update(ROUND11_ORDERING_MUST_REJECT)
MUST_ACCEPT.update(ROUND11_ORDERING_MUST_ACCEPT)



class Round12ClosureTests(unittest.TestCase):
    """Exact regressions from the synchronized #246 independent reviews."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round12_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    @staticmethod
    def unguarded(name: str = "probe_fn", args: str = "p_org uuid") -> str:
        return (
            f"CREATE FUNCTION public.{name}({args}) RETURNS void\n"
            "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "BEGIN\n"
            "  UPDATE public.bins SET actual_qty = actual_qty - 1;\n"
            "END;\n"
            "$$;\n"
        )

    @staticmethod
    def close(name: str = "probe_fn", args: str = "uuid") -> str:
        return (
            f"REVOKE EXECUTE ON FUNCTION public.{name}({args}) "
            "FROM PUBLIC, anon, authenticated;\n"
        )

    def test_header_dollar_literal_cannot_impersonate_body_guard(self) -> None:
        sql = (
            "CREATE FUNCTION public.probe_fn("
            "p_org uuid, p_note text DEFAULT "
            "$d$PERFORM public.wardah_assert_org_member(p_org);$d$)\n"
            "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "BEGIN UPDATE public.bins SET actual_qty = 0; END;\n"
            "$$;\n"
        )
        self.assertTrue(self.verdict("header_dollar_default", sql))
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        definitions = guards.parse_definitions(sql, masked)
        self.assertEqual(len(definitions), 1)
        body = masked[definitions[0].body_span[0]:definitions[0].body_span[1]]
        self.assertNotIn("wardah_assert_org_member", body)

    def test_alter_routine_security_definer_is_detected(self) -> None:
        sql = (
            "CREATE FUNCTION public.promoted() RETURNS void "
            "LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN NULL; END; $$;\n"
            "ALTER ROUTINE public.promoted() SECURITY DEFINER;\n"
        )
        self.assertTrue(self.verdict("alter_routine", sql))
        self.assertTrue(
            self.verdict(
                "external_alter_routine",
                "ALTER ROUTINE public.external_routine() SECURITY DEFINER;\n",
            )
        )

    def test_out_only_parameters_do_not_enter_callable_identity(self) -> None:
        sql = (
            "CREATE FUNCTION public.out_probe(OUT x integer) "
            "LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN x := 1; END; $$;\n"
            "CREATE FUNCTION public.out_probe(integer) RETURNS integer "
            "LANGUAGE sql AS $$ SELECT $1 $$;\n"
            "REVOKE EXECUTE ON FUNCTION public.out_probe(integer) "
            "FROM PUBLIC, anon, authenticated;\n"
        )
        self.assertTrue(self.verdict("out_identity", sql))
        self.assertEqual(
            guards._parse_arg_list(
                "OUT x integer, INOUT y text, VARIADIC z integer[]"
            ),
            ("text", "integer[]"),
        )

    def test_unicode_delimited_do_language_is_owned_and_unknown(self) -> None:
        sql = (
            self.unguarded() + self.close()
            + 'DO LANGUAGE U&"plpgsql" $$\n'
            + "BEGIN\n"
            + "  EXECUTE 'GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
              "TO authenticated';\n"
            + "END;\n"
            + "$$;\n"
        )
        self.assertTrue(self.verdict("unicode_do_language", sql))

    def test_migration_time_helper_calls_fail_closed(self) -> None:
        helper = (
            "CREATE FUNCTION public.reopen_probe() RETURNS void "
            "LANGUAGE plpgsql AS $$\n"
            "BEGIN GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
            "TO authenticated; END; $$;\n"
        )
        cases = {
            "select_helper": helper + "SELECT public.reopen_probe();\n",
            "do_perform_helper": helper
                + "DO $$ BEGIN PERFORM public.reopen_probe(); END; $$;\n",
            "call_procedure": (
                "CREATE PROCEDURE public.reopen_proc() LANGUAGE plpgsql AS $$\n"
                "BEGIN GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                "TO authenticated; END; $$;\n"
                "CALL public.reopen_proc();\n"
            ),
        }
        for name, tail in cases.items():
            with self.subTest(case=name):
                sql = self.unguarded() + self.close() + tail
                self.assertTrue(self.verdict(name, sql))

    def test_schema_wide_grant_reopens_client_surface(self) -> None:
        sql = (
            self.unguarded() + self.close()
            + "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public "
              "TO authenticated;\n"
        )
        self.assertTrue(self.verdict("schema_grant", sql))

    def test_default_privilege_grant_before_create_is_unknown(self) -> None:
        sql = (
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
            "GRANT EXECUTE ON FUNCTIONS TO authenticated;\n"
            + self.unguarded()
            + "REVOKE EXECUTE ON FUNCTION public.probe_fn(uuid) FROM PUBLIC;\n"
        )
        self.assertTrue(self.verdict("default_privileges", sql))
        safe = self.unguarded() + self.close() + (
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
            "GRANT EXECUTE ON FUNCTIONS TO authenticated;\n"
        )
        self.assertEqual(self.verdict("default_after_create", safe), [])

    def test_role_membership_inheritance_blocks_closure_proof(self) -> None:
        sql = (
            self.unguarded() + self.close()
            + "CREATE ROLE stock_ops;\n"
            + "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) TO stock_ops;\n"
            + "GRANT stock_ops TO authenticated;\n"
        )
        self.assertTrue(self.verdict("role_membership", sql))

    def test_schema_wide_revoke_is_not_credited_as_exact_closure(self) -> None:
        sql = (
            self.unguarded()
            + "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public "
              "FROM PUBLIC, anon, authenticated;\n"
        )
        self.assertTrue(self.verdict("schema_revoke_conservative", sql))

if __name__ == "__main__":
    unittest.main(verbosity=2)
