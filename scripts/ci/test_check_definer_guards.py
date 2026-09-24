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
import inspect
import json
import pathlib
import re
import sys
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


#: The handler body `definer_outer_handler()` used until Round 26: the
#: privileged write itself. Round 26 refuses a guard whose block owns a handler
#: that can act unauthorized, since any earlier failure enters it (see
#: `handler_can_run_unauthorized()`), so this body now decides the verdict on
#: its own - which is exactly what the fixture exists NOT to let happen.
#: `Round26FixtureMigrationTests` keeps every non-catching condition that used
#: this body pinned, with it, as REJECT.
WRITING_HANDLER_BODY = "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"


def definer_outer_handler(
    handler: str, name: str = "f_probe", handler_body: str = "  NULL;\n"
) -> str:
    """A guard at the OUTER statement level whose own block handles `handler`.

    The handler is on the FUNCTION's own BEGIN, so the fixture cannot pass or
    fail for placement reasons: the only thing under test is whether that
    handler can catch the assertion's P0001.

    Round 26: the default handler body is `NULL;`, which Round 26 proves inert,
    so the condition is again the ONLY thing under test. A catching condition
    is still refused - it swallows the denial - and a non-catching one is
    still accepted. The previous body is `WRITING_HANDLER_BODY`.
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
        + handler_body
        + "END;\n"
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
        and the parser must not invent one for them.

        Round 25 fixture correction, expectation unchanged: this CASE statement
        was written `THEN NULL ELSE NULL END CASE;`, which PostgreSQL 17.11
        rejects (`syntax error at or near "ELSE"`) - each arm of a PL/pgSQL
        CASE is a statement list, so `NULL` needs its `;`. The statement walk
        reads that text the way PostgreSQL does, as one statement running to
        the `;`, so the invalid spelling no longer produced any frames. The
        valid spelling below compiles on 17.11 and pins the same fact."""
        body = (
            "<<auth_block>>\nBEGIN\n"
            "  CASE WHEN p_org IS NULL THEN NULL; ELSE NULL; END CASE;\n"
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


# ---------------------------------------------------------------------------
# Round 13: post-independent-review closure for PR #246
# ---------------------------------------------------------------------------
# Three independent reviews ran against the frozen head
# de35df2107820c05300992b486207e4f01c699f6. Gemini passed on its corpus; Codex
# and Claude/Fable each produced concrete false-greens outside it. Every
# fixture below was executed on a disposable PostgreSQL 17.11 before being
# written down: the SQL parses, and the unsafe runtime/catalog state it claims
# was read back from `pg_proc.prosecdef` and `has_function_privilege()`. A
# mutant PostgreSQL rejects is not evidence and none is used here.
class Round13ClosureTests(unittest.TestCase):
    """Exact regressions from the post-remediation #246 independent reviews."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round13_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    # -- shared fixtures ---------------------------------------------------
    @staticmethod
    def unguarded(name: str = "probe_fn", args: str = "p_org uuid",
                  or_replace: bool = False) -> str:
        head = "CREATE OR REPLACE FUNCTION" if or_replace else "CREATE FUNCTION"
        return (
            f"{head} public.{name}({args}) RETURNS void\n"
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

    @staticmethod
    def guarded(name: str = "probe_fn", args: str = "p_org uuid") -> str:
        return (
            f"CREATE FUNCTION public.{name}({args}) RETURNS void\n"
            "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "BEGIN\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            "  UPDATE public.bins SET actual_qty = actual_qty - 1;\n"
            "END;\n"
            "$$;\n"
        )

    @staticmethod
    def reopen_helper(name: str = "reopen_probe") -> str:
        return (
            f"CREATE FUNCTION public.{name}() RETURNS boolean\n"
            "LANGUAGE plpgsql AS $h$\n"
            "BEGIN\n"
            "  EXECUTE 'GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
            "TO authenticated';\n"
            "  RETURN true;\n"
            "END;\n"
            "$h$;\n"
        )

    # -- F1: dollar-tag boundary ------------------------------------------
    # PostgreSQL's unquoted identifiers admit `$` (scan.l ident_cont), so
    # `col$a$` is ONE identifier and opens no literal. The frozen reader
    # matched `$a$` there as a dollar tag and blanked everything up to the next
    # `$a$`, which on PostgreSQL 17.11 is executable SQL.
    def test_f1_identifier_adjacent_dollar_tag_cannot_open_a_literal(self) -> None:
        cases = {
            # The masked span swallows the whole unguarded definer definition.
            "hides_definer": (
                "CREATE TABLE public.marker_a (col$a$ integer);\n"
                + self.unguarded()
                + "CREATE TABLE public.marker_b (col$a$ integer);\n"
            ),
            # The definer is visible and closed, but the reopening GRANT that
            # PostgreSQL really executes is hidden inside the bogus span.
            "hides_grant": (
                self.unguarded() + self.close()
                + "CREATE TABLE public.marker_a (col$q$ integer);\n"
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "TO authenticated;\n"
                + "CREATE TABLE public.marker_b (col$q$ integer);\n"
            ),
        }
        for name, sql in cases.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: an identifier-adjacent `$` opened a dollar quote",
                )

    def test_f1_real_dollar_quoting_still_works(self) -> None:
        """The boundary must not cost any genuine dollar-quote spelling."""
        accepted = {
            "tagged_body": (
                "CREATE FUNCTION public.probe_fn(p_org uuid) RETURNS void\n"
                "LANGUAGE plpgsql SECURITY DEFINER AS $body$\n"
                "BEGIN\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "END;\n"
                "$body$;\n"
            ),
            "bare_body": self.guarded(),
            # `$1` is a positional parameter, never a tag.
            "positional_parameter": (
                "CREATE FUNCTION public.probe_fn(p_org uuid) RETURNS void\n"
                "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
                "BEGIN\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "  EXECUTE 'SELECT $1' USING p_org;\n"
                "END;\n"
                "$$;\n"
            ),
            # The mirrored half of the same bug: the bogus span used to hide a
            # REAL revoke too, so a genuinely closed function read as open.
            # PostgreSQL executes this REVOKE (oracle: PUBLIC and
            # authenticated both lose EXECUTE), so accepting it is correct.
            "identifier_adjacent_tag_does_not_hide_a_revoke": (
                self.unguarded()
                + "CREATE TABLE public.marker_a (col$r$ integer);\n"
                + "REVOKE EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "FROM PUBLIC, anon, authenticated;\n"
                + "CREATE TABLE public.marker_b (col$r$ integer);\n"
            ),
            # A tag after whitespace, a comma or an operator is still a tag,
            # because none of those is an identifier character.
            "tag_after_separator": (
                self.unguarded() + self.close()
                + "INSERT INTO public.notes (body) VALUES ($n$plain$n$);\n"
            ),
        }
        for name, sql in accepted.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

        # The nested-literal guard still holds: a guard named inside a real
        # nested dollar literal is not an executable call.
        self.assertTrue(
            self.verdict(
                "nested_literal_guard_mention",
                "CREATE FUNCTION public.probe_fn(p_org uuid) RETURNS void\n"
                "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
                "BEGIN\n"
                "  RAISE NOTICE '%', "
                "$t$public.wardah_assert_org_member(p_org)$t$;\n"
                "  UPDATE public.bins SET actual_qty = 0;\n"
                "END;\n"
                "$$;\n",
            )
        )

    def test_f1_close_tag_is_not_subject_to_the_boundary(self) -> None:
        """The boundary belongs to OPENING a literal, never to closing one.

        Inside a dollar-quoted string PostgreSQL's lexer looks for the exact
        delimiter and does not apply identifier rules, so an
        identifier-adjacent close tag DOES close it - oracle:
        `SELECT length($$ab col$$)` is 6, i.e. the `$$` after `col` ended the
        literal. Applying the open-side boundary here would have desynchronized
        the masker from PostgreSQL in the opposite direction, leaving the rest
        of the file masked as literal content.
        """
        sql = (
            "CREATE FUNCTION public.probe_fn(p_org uuid) RETURNS void\n"
            "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "BEGIN\n"
            "  UPDATE public.bins SET col$$ = 0;\n"
            "END;\n"
            "$$;\n"
        )
        masked, problems = guards.mask_sql_checked(sql)
        # The body ended at `col$$`, so what follows is ordinary SQL text and
        # the trailing `$$;` opens an UNTERMINATED body - reported, not
        # silently treated as safe.
        self.assertTrue(problems)
        self.assertTrue(self.verdict("close_tag_adjacent", sql))

    def test_f1_dollar_tag_reader_enforces_the_boundary(self) -> None:
        """The shared reader itself, so every consumer inherits one rule."""
        self.assertIsNone(guards._dollar_tag_at("col$a$", 3))
        self.assertIsNone(guards._dollar_tag_at("a1$t$", 2))
        self.assertIsNone(guards._dollar_tag_at("_x$t$", 2))
        # A `$` is itself an identifier CONTINUATION character, so a tag may
        # not begin immediately after one either.
        self.assertIsNone(guards._dollar_tag_at("a$$$", 2))
        self.assertEqual(guards._dollar_tag_at(" $a$", 1), "$a$")
        self.assertEqual(guards._dollar_tag_at("($$", 1), "$$")
        self.assertEqual(guards._dollar_tag_at("$$", 0), "$$")
        self.assertIsNone(guards._dollar_tag_at("$1", 0))

    # -- F2: ALTER SECURITY body ownership --------------------------------
    # Creating a routine does not run its body, and Scanner v1 does not
    # evaluate DO branch reachability. Neither text may demote a function.
    # Oracle: victim keeps prosecdef = true after both.
    def test_f2_alter_security_text_in_a_body_is_not_a_demotion(self) -> None:
        cases = {
            "routine_body": (
                self.unguarded()
                + "CREATE FUNCTION public.maintenance_later() RETURNS void\n"
                  "LANGUAGE plpgsql AS $m$\n"
                  "BEGIN\n"
                  "  ALTER FUNCTION public.probe_fn(uuid) SECURITY INVOKER;\n"
                  "END;\n"
                  "$m$;\n"
            ),
            "unreachable_do_branch": (
                self.unguarded()
                + "DO $do$\n"
                  "BEGIN\n"
                  "  IF false THEN\n"
                  "    ALTER FUNCTION public.probe_fn(uuid) SECURITY INVOKER;\n"
                  "  END IF;\n"
                  "END;\n"
                  "$do$;\n"
            ),
            # A DO that MAY demote earns no proven demotion either: the
            # function must still be judged as SECURITY DEFINER.
            "reachable_do_branch": (
                self.unguarded()
                + "DO $do$\n"
                  "BEGIN\n"
                  "  ALTER FUNCTION public.probe_fn(uuid) SECURITY INVOKER;\n"
                  "END;\n"
                  "$do$;\n"
            ),
        }
        for name, sql in cases.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: inert ALTER SECURITY text demoted a live "
                    f"SECURITY DEFINER function",
                )

    def test_f2_top_level_alter_security_is_still_modelled(self) -> None:
        """Body ownership must not cost the real top-level statement."""
        # A genuine top-level demotion still silences the finding.
        self.assertEqual(
            self.verdict(
                "top_level_invoker",
                self.unguarded()
                + "ALTER FUNCTION public.probe_fn(uuid) SECURITY INVOKER;\n",
            ),
            [],
        )
        # A genuine top-level promotion is still found, for all three spellings.
        for keyword in ("FUNCTION", "PROCEDURE", "ROUTINE"):
            with self.subTest(promote=keyword):
                self.assertTrue(
                    self.verdict(
                        f"top_level_definer_{keyword.lower()}",
                        "CREATE FUNCTION public.probe_fn(p_org uuid) "
                        "RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$\n"
                        "BEGIN UPDATE public.bins SET actual_qty = 0; END;\n"
                        "$$;\n"
                        f"ALTER {keyword} public.probe_fn(uuid) "
                        "SECURITY DEFINER;\n",
                    )
                )
        # Ordering both ways.
        self.assertEqual(
            self.verdict(
                "promote_then_demote",
                "CREATE FUNCTION public.probe_fn(p_org uuid) RETURNS void "
                "LANGUAGE plpgsql SECURITY INVOKER AS $$\n"
                "BEGIN UPDATE public.bins SET actual_qty = 0; END;\n$$;\n"
                "ALTER FUNCTION public.probe_fn(uuid) SECURITY DEFINER;\n"
                "ALTER FUNCTION public.probe_fn(uuid) SECURITY INVOKER;\n",
            ),
            [],
        )
        self.assertTrue(
            self.verdict(
                "demote_then_promote",
                self.unguarded()
                + "ALTER FUNCTION public.probe_fn(uuid) SECURITY INVOKER;\n"
                + "ALTER FUNCTION public.probe_fn(uuid) SECURITY DEFINER;\n",
            )
        )

    # -- F3: DO with an E'' / U&'' string body ----------------------------
    # PostgreSQL accepts any string constant as a DO code body. Oracle: each
    # form below moved `authenticated` from false to true on the victim.
    def test_f3_string_bodied_do_blocks_stay_procedurally_unknown(self) -> None:
        inner = (
            "BEGIN EXECUTE \\'GRANT EXECUTE ON FUNCTION "
            "public.probe_fn(uuid) TO authenticated\\'; END"
        )
        uinner = (
            "BEGIN EXECUTE \\0027GRANT EXECUTE ON FUNCTION "
            "public.probe_fn(uuid) TO authenticated\\0027; END"
        )
        cases = {
            "do_e_string": f"DO E'{inner}';\n",
            "do_lower_e_string": f"DO e'{inner}';\n",
            "do_uamp_string": f"DO U&'{uinner}';\n",
            "do_lower_uamp_string": f"DO u&'{uinner}';\n",
            "do_language_then_e_string": f"DO LANGUAGE plpgsql E'{inner}';\n",
        }
        for name, tail in cases.items():
            with self.subTest(case=name):
                sql = self.unguarded() + self.close() + tail
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a string-bodied DO vanished from procedural "
                    f"analysis after a full revoke",
                )

    def test_f3_plain_string_do_is_still_unknown_and_dollar_do_unchanged(self) -> None:
        # The already-covered plain `'...'` body keeps failing closed.
        self.assertTrue(
            self.verdict(
                "do_plain_string",
                self.unguarded() + self.close()
                + "DO 'BEGIN PERFORM 1; END';\n",
            )
        )
        # `ON CONFLICT ... DO NOTHING` is still not a DO statement.
        self.assertEqual(
            self.verdict(
                "on_conflict_do_update",
                self.unguarded() + self.close()
                + "INSERT INTO public.permissions (permission_key) "
                  "VALUES ('x')\n"
                  "ON CONFLICT (permission_key) DO UPDATE "
                  "SET permission_key = 'x';\n",
            ),
            [],
        )

    # -- F4 + Codex P2: migration-time same-file helper invocation --------
    # Oracle: every statement below executed `public.reopen_probe()` and
    # reopened `authenticated` EXECUTE on the victim.
    def test_f4_same_file_helper_invocation_is_acl_unknown(self) -> None:
        helper = self.reopen_helper()
        cases = {
            # Codex: PostgreSQL resolves the Unicode-delimited identifier to
            # the same-file helper; the frozen raw fallback looked only for the
            # rendered `"reopen_probe"` spelling.
            "codex_unicode_identifier_call":
                'SELECT public.U&"reopen_prob\\0065"();\n',
            "codex_uescape_variant":
                'SELECT public.U&"reopen_prob!0065" UESCAPE \'!\' ();\n',
            # The 6-digit `\+XXXXXX` escape is a separate decode branch, and
            # PostgreSQL 17.11 resolves it to the same helper.
            "codex_six_digit_escape":
                'SELECT public.U&"reopen_prob\\+000065"();\n',
            "do_assignment":
                "DO $do$\nDECLARE ok boolean;\nBEGIN\n"
                "  ok := public.reopen_probe();\nEND;\n$do$;\n",
            "do_if_expression":
                "DO $do$\nBEGIN\n"
                "  IF public.reopen_probe() THEN NULL; END IF;\nEND;\n$do$;\n",
            "insert_values":
                "INSERT INTO public.migration_log (ok) "
                "VALUES (public.reopen_probe());\n",
            "update_expression":
                "UPDATE public.migration_log SET ok = public.reopen_probe();\n",
            "delete_predicate":
                "DELETE FROM public.migration_log "
                "WHERE public.reopen_probe();\n",
            "top_level_values":
                "VALUES (public.reopen_probe());\n",
            "merge_statement":
                "MERGE INTO public.migration_log t\n"
                "USING (SELECT true AS s) s ON t.ok = s.s\n"
                "WHEN NOT MATCHED THEN INSERT (ok) "
                "VALUES (public.reopen_probe());\n",
            "quoted_identifier_call":
                'SELECT public."reopen_probe"();\n',
        }
        for name, tail in cases.items():
            with self.subTest(case=name):
                sql = self.unguarded() + self.close() + helper + tail
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a migration-time same-file helper call left the "
                    f"surface provably closed",
                )

    def test_f4_mere_mention_of_a_helper_name_does_not_fail_closed(self) -> None:
        """Conservative must not mean indiscriminate."""
        helper = self.reopen_helper()
        accepted = {
            "name_in_a_literal": helper
                + "INSERT INTO public.notes (body) "
                  "VALUES ('reopen_probe() is documented here');\n",
            "name_in_a_comment": helper
                + "-- reopen_probe() must be run by hand\n"
                  "SELECT 1;\n",
            "name_in_a_block_comment": helper
                + "/* call reopen_probe() later */\nSELECT 1;\n",
            "different_routine_call": helper
                + "SELECT public.some_other_routine();\n",
            "quoted_non_call_reference": helper
                + 'SELECT 1 AS "reopen_probe";\n',
            "no_helper_statements": "SELECT 1;\n"
                "INSERT INTO public.migration_log (ok) VALUES (true);\n"
                "UPDATE public.migration_log SET ok = false;\n"
                "DELETE FROM public.migration_log WHERE ok IS NULL;\n",
        }
        for name, tail in accepted.items():
            with self.subTest(accept=name):
                sql = self.guarded() + tail
                self.assertEqual(self.verdict(name, sql), [], name)

    # -- F5: GRANT before CREATE OR REPLACE -------------------------------
    # `CREATE OR REPLACE FUNCTION` preserves the existing function's owner and
    # permissions. Oracle: `authenticated` EXECUTE granted before the replace
    # was still true afterwards, with PUBLIC revoked.
    def test_f5_grant_before_or_replace_survives(self) -> None:
        sql = (
            "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) TO authenticated;\n"
            + self.unguarded(or_replace=True)
            + "REVOKE EXECUTE ON FUNCTION public.probe_fn(uuid) FROM PUBLIC;\n"
        )
        self.assertTrue(
            self.verdict("grant_before_or_replace", sql),
            "a pre-replace GRANT that PostgreSQL preserves was dropped from "
            "the ACL model",
        )

    def test_f5_pre_replace_model_stays_conservative(self) -> None:
        # The same GRANT after the CREATE is still detected (unchanged).
        self.assertTrue(
            self.verdict(
                "grant_after_create",
                self.unguarded() + self.close()
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "TO authenticated;\n",
            )
        )
        # A genuinely fully closed OR REPLACE still passes.
        self.assertEqual(
            self.verdict(
                "or_replace_fully_closed",
                self.unguarded(or_replace=True) + self.close(),
            ),
            [],
        )
        # A pre-replace GRANT is not cancelled by a PUBLIC-only revoke, but IS
        # cancelled by a revoke that names the role.
        self.assertEqual(
            self.verdict(
                "pre_grant_then_full_revoke",
                "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                "TO authenticated;\n"
                + self.unguarded(or_replace=True) + self.close(),
            ),
            [],
        )
        # An ordinary new CREATE introduces no pre-existing-ACL assumption.
        self.assertEqual(
            self.verdict("plain_create_closed", self.unguarded() + self.close()),
            [],
        )
        # An earlier REVOKE earns no closure credit for the replaced identity:
        # closure must be proven after the definition.
        self.assertTrue(
            self.verdict(
                "revoke_before_or_replace_is_not_closure",
                self.close() + self.unguarded(or_replace=True),
            )
        )

    # -- F6: ALTER RENAME / SET SCHEMA identity mutation ------------------
    # Oracle: after RENAME and after SET SCHEMA the routine is the SAME
    # SECURITY DEFINER function, and a GRANT on the new identity reaches it.
    def test_f6_routine_identity_mutation_fails_closed(self) -> None:
        cases = {
            "rename_then_grant_new_identity": (
                self.unguarded() + self.close()
                + "ALTER FUNCTION public.probe_fn(uuid) RENAME TO probe_fn_v2;\n"
                + "GRANT EXECUTE ON FUNCTION public.probe_fn_v2(uuid) "
                  "TO authenticated;\n"
            ),
            "set_schema_then_grant": (
                self.unguarded() + self.close()
                + "ALTER FUNCTION public.probe_fn(uuid) SET SCHEMA archive;\n"
                + "GRANT EXECUTE ON FUNCTION archive.probe_fn(uuid) "
                  "TO authenticated;\n"
            ),
            # The mutation alone is enough: Scanner v1 does not model the new
            # identity, so it cannot claim the closure still holds.
            "rename_alone": (
                self.unguarded() + self.close()
                + "ALTER FUNCTION public.probe_fn(uuid) RENAME TO probe_fn_v2;\n"
            ),
            "alter_routine_rename_spelling": (
                self.unguarded() + self.close()
                + "ALTER ROUTINE public.probe_fn(uuid) RENAME TO probe_v2;\n"
            ),
            "rename_a_routine_used_in_acl_proof": (
                self.guarded()
                + "CREATE FUNCTION public.other_fn(p_org uuid) RETURNS void\n"
                  "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
                  "BEGIN UPDATE public.bins SET actual_qty = 0; END;\n$$;\n"
                + self.close("other_fn")
                + "ALTER FUNCTION public.other_fn(uuid) RENAME TO other_fn_v2;\n"
            ),
            # Renaming any routine INTO a recognized helper name means the
            # guard the scanner read is not the guard the database will run.
            "rename_into_recognized_guard_name": (
                self.guarded()
                + "CREATE FUNCTION public.noop_helper(uuid) RETURNS void\n"
                  "LANGUAGE plpgsql AS $n$ BEGIN NULL; END; $n$;\n"
                + "ALTER FUNCTION public.noop_helper(uuid) "
                  "RENAME TO wardah_assert_org_member;\n"
            ),
            "set_schema_into_recognized_guard_path": (
                self.guarded()
                + "CREATE FUNCTION archive.wardah_assert_org_member(uuid) "
                  "RETURNS void LANGUAGE plpgsql AS $n$ BEGIN NULL; END; $n$;\n"
                + "ALTER FUNCTION archive.wardah_assert_org_member(uuid) "
                  "SET SCHEMA public;\n"
            ),
        }
        for name, sql in cases.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: routine identity mutation was not modelled and "
                    f"did not fail closed",
                )

    def test_f6_identity_mutation_of_unrelated_routines_is_not_a_finding(self) -> None:
        accepted = {
            # A rename of a routine this file neither defines as a definer nor
            # uses in an ACL proof, and whose new name is not a guard.
            "unrelated_rename": self.guarded()
                + "ALTER FUNCTION public.legacy_report(uuid) "
                  "RENAME TO legacy_report_v2;\n",
            # Inert RENAME text inside a routine body is not a top-level
            # statement, exactly as ALTER SECURITY text is not (F2).
            "rename_text_in_routine_body": self.unguarded() + self.close()
                + "CREATE FUNCTION public.later_rename() RETURNS void\n"
                  "LANGUAGE plpgsql AS $m$\n"
                  "BEGIN\n"
                  "  ALTER FUNCTION public.probe_fn(uuid) "
                  "RENAME TO probe_fn_v2;\n"
                  "END;\n$m$;\n",
            # An ALTER that changes something else entirely is untouched.
            "alter_set_search_path": self.unguarded() + self.close()
                + "ALTER FUNCTION public.probe_fn(uuid) "
                  "SET search_path = public;\n",
        }
        for name, sql in accepted.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    # -- F7: type qualification may-be equivalence ------------------------
    # Oracle: `GRANT ... public.v7(mood)` reaches `public.v7(public.mood)`, and
    # `GRANT ... public.v7b(pg_catalog.regclass)` reaches `public.v7b(regclass)`.
    def test_f7_may_be_equivalent_type_spellings_keep_a_grant_alive(self) -> None:
        cases = {
            "custom_type_unqualified_grant": (
                self.unguarded(args="p_mood public.mood")
                + self.close(args="public.mood")
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(mood) "
                  "TO authenticated;\n"
            ),
            "custom_type_qualified_grant": (
                self.unguarded(args="p_mood mood")
                + self.close(args="mood")
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(public.mood) "
                  "TO authenticated;\n"
            ),
            "builtin_catalog_qualified_grant": (
                self.unguarded(args="p_rel regclass")
                + self.close(args="regclass")
                + "GRANT EXECUTE ON FUNCTION "
                  "public.probe_fn(pg_catalog.regclass) TO authenticated;\n"
            ),
            "builtin_unqualified_grant": (
                self.unguarded(args="p_rel pg_catalog.regclass")
                + self.close(args="pg_catalog.regclass")
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(regclass) "
                  "TO authenticated;\n"
            ),
        }
        for name, sql in cases.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: an applicable GRANT was dropped because two "
                    f"spellings of one type looked unrelated",
                )

    def test_f7_exact_type_identity_is_not_collapsed(self) -> None:
        """Only the may-match direction widens; exact identity stays strict."""
        # Distinct custom types in distinct schemas are still distinct.
        self.assertFalse(
            guards._may_be_same_type(
                guards._normalize_arg_type("archive.mood"),
                guards._normalize_arg_type("public.mood"),
            )
        )
        self.assertNotEqual(
            guards._normalize_arg_type("archive.mood"),
            guards._normalize_arg_type("public.mood"),
        )
        # Different names never collapse, qualified or not.
        self.assertFalse(
            guards._may_be_same_type(
                guards._normalize_arg_type("public.mood"),
                guards._normalize_arg_type("temper"),
            )
        )
        # A REVOKE still earns closure only for the spelling it provably names.
        self.assertTrue(
            self.verdict(
                "revoke_on_other_schema_type_is_not_closure",
                self.unguarded(args="p_mood public.mood")
                + "REVOKE EXECUTE ON FUNCTION public.probe_fn(archive.mood) "
                  "FROM PUBLIC, anon, authenticated;\n",
            )
        )
        # And the exact relation still keeps qualified/unqualified apart.
        qualified = guards.Identity(
            "public", "probe_fn", False,
            (guards._normalize_arg_type("public.mood"),),
        )
        bare = guards.Identity(
            "public", "probe_fn", False, (guards._normalize_arg_type("mood"),)
        )
        self.assertFalse(qualified.same_function(bare))
        self.assertTrue(qualified.may_be_same_function(bare))

    # -- F8: bare `raise` borrowed as a PL/pgSQL RAISE --------------------
    # Oracle: the function below is SECURITY DEFINER and a non-member call
    # reached the UPDATE without any exception being raised.
    def test_f8_a_bare_raise_identifier_is_not_a_denial(self) -> None:
        cases = {
            "select_alias": "    v_flag := (SELECT 1 AS raise);\n",
            "column_reference": "    v_flag := raise;\n",
            "alias_in_from": "    v_flag := (SELECT r.x FROM public.t AS raise(x));\n",
            "cte_name":
                "    v_flag := (WITH raise AS (SELECT 1 x) "
                "SELECT x FROM raise);\n",
            "quoted_identifier": '    v_flag := (SELECT 1 AS "RAISE");\n',
        }
        for name, deny in cases.items():
            with self.subTest(case=name):
                sql = (
                    "CREATE FUNCTION public.probe_fn(p_org uuid) RETURNS void\n"
                    "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
                    "DECLARE v_flag integer;\n"
                    "BEGIN\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    f"{deny}"
                    "  END IF;\n"
                    "  UPDATE public.bins SET actual_qty = 0;\n"
                    "END;\n"
                    "$$;\n"
                )
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a bare `raise` identifier counted as a denying "
                    f"PL/pgSQL RAISE statement",
                )

    def test_f8_real_raise_statements_still_deny(self) -> None:
        def probe(deny: str) -> str:
            return (
                "CREATE FUNCTION public.probe_fn(p_org uuid) RETURNS void\n"
                "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
                "BEGIN\n"
                "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                f"{deny}"
                "  END IF;\n"
                "  UPDATE public.bins SET actual_qty = 0;\n"
                "END;\n"
                "$$;\n"
            )

        for name, deny in {
            "raise_exception": "    RAISE EXCEPTION 'TENANT_DENIED';\n",
            "raise_exception_using":
                "    RAISE EXCEPTION 'TENANT_DENIED' USING HINT = 'no';\n",
            "raise_sqlstate":
                "    RAISE EXCEPTION SQLSTATE '28000';\n",
            "bare_reraise": "    RAISE;\n",
        }.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, probe(deny)), [], name)

        # Non-aborting RAISE is still not a denial.
        for name, deny in {
            "notice": "    RAISE NOTICE 'not a denial';\n",
            "warning": "    RAISE WARNING 'not a denial';\n",
        }.items():
            with self.subTest(reject=name):
                self.assertTrue(self.verdict(name, probe(deny)), name)

    # -- F9: UESCAPE with an escape-string operand ------------------------
    # Oracle: `UESCAPE E'!'` is accepted by PostgreSQL 17.11 and the GRANT
    # below resolved to the role `authenticated`. Decoding the identifier
    # against the DEFAULT backslash instead produces a plausible but WRONG
    # role name, which never trips the unresolved-grantee fail-closed path.
    def test_f9_uescape_escape_string_operand_is_resolved_or_fails_closed(self) -> None:
        cases = {
            "uescape_e_string":
                'GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) '
                'TO U&"authenticate!0064" UESCAPE E\'!\';\n',
            "uescape_lower_e_string":
                'GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) '
                'TO U&"authenticate!0064" UESCAPE e\'!\';\n',
            # An operand this reader cannot pin down must never be decoded
            # against a guessed escape character.
            "uescape_e_string_backslash":
                'GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) '
                'TO U&"authenticate\\0064" UESCAPE E\'\\\\\';\n',
        }
        for name, tail in cases.items():
            with self.subTest(case=name):
                sql = self.unguarded() + self.close() + tail
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a UESCAPE operand was decoded against the wrong "
                    f"escape character and the GRANT disappeared",
                )

    def test_f9_uescape_reader_resolves_or_refuses_each_operand_form(self) -> None:
        """PostgreSQL 17.11 accepts exactly `'c'` and `E'c'` here - a simple
        string literal - and rejects `N'c'`, `U&'c'` and a two-character
        operand. The reader must agree on both sides of that line, because a
        WRONG identity is worse than an unresolved one: it never trips the
        unresolved-grantee fail-closed path."""
        for text in (
            'U&"authenticate!0064" UESCAPE \'!\'',
            'U&"authenticate!0064" UESCAPE E\'!\'',
            'U&"authenticate!0064" UESCAPE e\'!\'',
        ):
            with self.subTest(spelling=text):
                masked, problems = guards.mask_sql_checked(text)
                self.assertEqual(problems, [])
                read = guards._read_delimited_identifier(text, 0, masked)
                self.assertIsNotNone(read)
                self.assertEqual(read[0], "authenticated")
        for text in (
            'U&"authenticate!0064" UESCAPE N\'!\'',
            'U&"authenticate!0064" UESCAPE \'!!\'',
            'U&"authenticate!0064" UESCAPE U&\'!\'',
        ):
            with self.subTest(unresolved=text):
                masked, _ = guards.mask_sql_checked(text)
                self.assertIsNone(
                    guards._read_delimited_identifier(text, 0, masked)
                )

    def test_f9_plain_uescape_and_default_escape_still_resolve(self) -> None:
        """The plain operand and the default backslash keep working."""
        for name, tail in {
            "plain_uescape":
                'GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) '
                'TO U&"authenticate!0064" UESCAPE \'!\';\n',
            "default_backslash":
                'GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) '
                'TO U&"authenticate\\0064";\n',
            "comment_between_identifier_and_uescape":
                'GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) '
                'TO U&"authenticate!0064" /* c */ UESCAPE \'!\';\n',
        }.items():
            with self.subTest(case=name):
                sql = self.unguarded() + self.close() + tail
                self.assertTrue(self.verdict(name, sql), name)

    # -- F10: ACL/membership/default-privilege effects inside DO ----------
    # Oracle: each DO below moved `authenticated` from false to true on the
    # victim, through role membership and through default privileges.
    def test_f10_acl_affecting_statements_inside_do_are_unknown(self) -> None:
        cases = {
            "do_role_membership_grant": (
                self.unguarded() + self.close()
                + "CREATE ROLE stock_ops;\n"
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "TO stock_ops;\n"
                + "DO $do$\nBEGIN\n"
                  "  GRANT stock_ops TO authenticated WITH INHERIT TRUE;\n"
                  "END;\n$do$;\n"
            ),
            "do_default_privileges": (
                "DO $do$\nBEGIN\n"
                "  ALTER DEFAULT PRIVILEGES IN SCHEMA public\n"
                "  GRANT EXECUTE ON FUNCTIONS TO authenticated;\n"
                "END;\n$do$;\n"
                + self.unguarded()
                + "REVOKE EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "FROM PUBLIC;\n"
            ),
            "do_static_routine_grant": (
                self.unguarded() + self.close()
                + "DO $do$\nBEGIN\n"
                  "  GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "TO authenticated;\n"
                  "END;\n$do$;\n"
            ),
            "do_alter_group_add_user": (
                self.unguarded() + self.close()
                + "CREATE ROLE stock_ops;\n"
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "TO stock_ops;\n"
                + "DO $do$\nBEGIN\n"
                  "  ALTER GROUP stock_ops ADD USER authenticated;\n"
                  "END;\n$do$;\n"
            ),
            "do_alter_role_inherit": (
                self.unguarded() + self.close()
                + "CREATE ROLE stock_ops;\n"
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "TO stock_ops;\n"
                + "DO $do$\nBEGIN\n"
                  "  ALTER ROLE authenticated INHERIT;\n"
                  "END;\n$do$;\n"
            ),
            "do_revoke_text": (
                self.unguarded() + self.close()
                + "DO $do$\nBEGIN\n"
                  "  REVOKE stock_ops FROM authenticated;\n"
                  "END;\n$do$;\n"
            ),
        }
        for name, sql in cases.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a DO body that may change effective routine "
                    f"execution rights did not become ACL-unknown",
                )

    def test_f10_harmless_do_bodies_are_still_provable(self) -> None:
        accepted = {
            "do_no_acl_text": self.unguarded() + self.close()
                + "DO $do$\nBEGIN\n  PERFORM 1;\nEND;\n$do$;\n",
            "do_plain_dml": self.unguarded() + self.close()
                + "DO $do$\nBEGIN\n"
                  "  UPDATE public.migration_log SET ok = true;\n"
                  "END;\n$do$;\n",
            "acl_word_only_in_a_do_literal": self.unguarded() + self.close()
                + "DO $do$\nBEGIN\n"
                  "  INSERT INTO public.notes (body) "
                  "VALUES ('GRANT EXECUTE was reviewed');\n"
                  "END;\n$do$;\n",
            "acl_word_only_in_a_do_comment": self.unguarded() + self.close()
                + "DO $do$\nBEGIN\n"
                  "  -- GRANT EXECUTE is intentionally NOT done here\n"
                  "  PERFORM 1;\nEND;\n$do$;\n",
        }
        for name, sql in accepted.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    # -- F12: legacy role-membership syntax at top level -------------------
    # Oracle: `ALTER GROUP stock_ops ADD USER authenticated` is the documented
    # legacy alias for GRANT and moved `authenticated` to true. `ALTER ROLE
    # ... ADD USER` and `ALTER GROUP ... ADD ROLE` are both syntax errors
    # there, so only the confirmed spelling is recognized.
    def test_f12_legacy_group_membership_blocks_closure_proof(self) -> None:
        cases = {
            "alter_group_add_user": (
                self.unguarded() + self.close()
                + "CREATE ROLE stock_ops;\n"
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "TO stock_ops;\n"
                + "ALTER GROUP stock_ops ADD USER authenticated;\n"
            ),
            "alter_group_add_user_quoted": (
                self.unguarded() + self.close()
                + "CREATE ROLE stock_ops;\n"
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "TO stock_ops;\n"
                + 'ALTER GROUP stock_ops ADD USER "authenticated";\n'
            ),
            "alter_role_inherit": (
                self.unguarded() + self.close()
                + "CREATE ROLE stock_ops;\n"
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "TO stock_ops;\n"
                + "ALTER ROLE authenticated INHERIT;\n"
            ),
        }
        for name, sql in cases.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a legacy role-membership change to a client role "
                    f"left the surface provably closed",
                )

    def test_f12_unrelated_role_ddl_is_not_a_membership_change(self) -> None:
        accepted = {
            "alter_group_other_member": self.unguarded() + self.close()
                + "CREATE ROLE stock_ops;\nCREATE ROLE stock_lead;\n"
                + "ALTER GROUP stock_ops ADD USER stock_lead;\n",
            "alter_role_password_free_option": self.unguarded() + self.close()
                + "ALTER ROLE stock_ops NOLOGIN;\n",
            "create_role_only": self.unguarded() + self.close()
                + "CREATE ROLE stock_ops;\n",
        }
        for name, sql in accepted.items():
            with self.subTest(accept=name):
                self.assertEqual(self.verdict(name, sql), [], name)

    # -- existing role-membership checks are not weakened ------------------
    def test_round12_role_membership_check_is_unchanged(self) -> None:
        self.assertTrue(
            self.verdict(
                "grant_role_to_authenticated",
                self.unguarded() + self.close()
                + "CREATE ROLE stock_ops;\n"
                + "GRANT EXECUTE ON FUNCTION public.probe_fn(uuid) "
                  "TO stock_ops;\n"
                + "GRANT stock_ops TO authenticated;\n",
            )
        )


# ---------------------------------------------------------------------------
# Round 14: `>>` is PostgreSQL's right-shift operator, not only a label end
# ---------------------------------------------------------------------------
# Round 13 (F8) made a denying RAISE prove it sits where a PL/pgSQL statement
# may BEGIN, and accepted `>>` there as the terminator of a `<<label>>`.
# PostgreSQL also spells integer right shift `>>`, so an ordinary expression
# whose right operand is an identifier named `raise` puts a bare `raise`
# directly after `>>` - and it counted as a real RAISE statement again. The
# exception F8 itself introduced reopened the very false green F8 closed.
#
# The oracle decides which correction is smallest, rather than the Round 13
# comment that claimed `>>` was needed. On PostgreSQL 17.11:
#
#   * `<<lbl>> RAISE EXCEPTION 'x';`  ->  ERROR: syntax error at or near
#     "RAISE". A label owns a BLOCK or a LOOP, never a bare statement, so a
#     real RAISE after a labelled construct is ALWAYS reached through `BEGIN`
#     or `LOOP` - both of which _STATEMENT_OPENER_KEYWORDS already admits.
#   * `<<lbl>> BEGIN RAISE ...; END lbl;` and `<<lp>> LOOP RAISE ...; END LOOP
#     lp;` are both valid, and both reach the RAISE through those keywords.
#   * `8 >> raise` is valid and evaluates to 4 - spaced, unspaced,
#     parenthesised, with an intervening comment, in a nested SELECT, over a
#     column named `raise`, and over a function PARAMETER named `raise`.
#
# So `>>` can never legitimately precede a RAISE statement: the branch that
# accepted it was pure false-green surface with no real case to defend, and
# deleting it is the whole correction. Nothing else about statement position,
# label parsing or block ownership changes.
class Round14ShiftOperatorTests(unittest.TestCase):
    """The Codex `>>` P2 from the Round 13 closure review of 6109f8a7."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round14_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    @staticmethod
    def boolean_probe(deny_body: str, args: str = "p_org uuid") -> str:
        """An unguarded SECURITY DEFINER routine whose ONLY candidate
        authorization boundary is `deny_body`, inside the negated-predicate
        deny branch, followed by privileged work.

        There is deliberately no `raise` in a DECLARE section here. A PL/pgSQL
        variable declared `raise integer := 1;` follows the DECLARE keyword,
        which IS a statement position, so the scanner reads it as an
        outer-level aborting RAISE and rejects the routine for that unrelated
        reason - a pre-existing conservative false RED, not this finding. A
        fixture resting on it would go green without testing the shift class
        at all, so the `raise` identifier below is always a column or a
        parameter and the token after `>>` is the only one in the body.
        """
        return (
            f"CREATE FUNCTION public.probe_fn({args}) RETURNS void\n"
            "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "DECLARE v_flag integer;\n"
            "BEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            f"{deny_body}"
            "  END IF;\n"
            "\n"
            "  UPDATE public.bins\n"
            "  SET actual_qty = 0\n"
            "  WHERE org_id = p_org;\n"
            "END;\n"
            "$$;\n"
        )

    # -- the exact Codex reproducer ---------------------------------------
    def test_codex_right_shift_reproducer_is_rejected(self) -> None:
        """Oracle (PostgreSQL 17.11): the routine is `prosecdef = true` and
        executable by both PUBLIC and `authenticated`; a NON-MEMBER call
        raised nothing and drove the privileged UPDATE (bins.actual_qty
        99 -> 0). The frozen head returned []."""
        sql = self.boolean_probe(
            "    v_flag := (\n"
            "      SELECT 8 >> raise\n"
            "      FROM public.raise_source\n"
            "      LIMIT 1\n"
            "    );\n"
        )
        self.assertTrue(
            self.verdict("codex_right_shift", sql),
            "a right-shift expression made a bare `raise` identifier count as "
            "a denying PL/pgSQL RAISE statement",
        )

    # -- every required variant, over a COLUMN named `raise` ---------------
    def test_right_shift_spellings_never_supply_a_denial(self) -> None:
        select = "(SELECT 8 %s raise FROM public.raise_source LIMIT 1)"
        cases = {
            "spaced": select % ">>",
            "no_space": "(SELECT 8>>raise FROM public.raise_source LIMIT 1)",
            "parenthesised":
                "(SELECT (8 >> raise) FROM public.raise_source LIMIT 1)",
            "block_comment_between":
                "(SELECT 8 >> /* c */ raise "
                "FROM public.raise_source LIMIT 1)",
            "line_comment_between":
                "(SELECT 8 >> -- why\n      raise "
                "FROM public.raise_source LIMIT 1)",
            "newline_between":
                "(SELECT 8 >>\n      raise "
                "FROM public.raise_source LIMIT 1)",
            # Left shift is the mirror spelling and must not manufacture a
            # label terminator either.
            "left_shift": select % "<<",
        }
        for name, expr in cases.items():
            with self.subTest(case=name):
                sql = self.boolean_probe(f"    v_flag := {expr};\n")
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a shift operator supplied an authorization "
                    f"boundary PostgreSQL never executes",
                )

    def test_right_shift_over_a_parameter_named_raise_is_rejected(self) -> None:
        """The PL/pgSQL-assignment form, without the confounding DECLARE.
        Oracle: a function PARAMETER may be named `raise`, and
        `RETURN 8 >> raise` returns 4."""
        sql = self.boolean_probe(
            "    v_flag := 8 >> raise;\n", args="p_org uuid, raise integer"
        )
        self.assertTrue(self.verdict("parameter_named_raise", sql))

    def test_statement_start_helper_rejects_a_shift_operator(self) -> None:
        """The shared helper itself, so BOTH callers inherit one rule.

        parse_blocks() asks it whether a RAISE token is a denying statement;
        unconditional_abort_before() asks it whether an earlier RAISE already
        ended the invocation. Correcting one caller would have left the two
        disagreeing about what a statement position is.
        """
        for text in ("8 >> raise", "8>>raise", "(8 >> raise", "8 <<raise",
                     "8 >>\n      raise", "8 >>\traise", "8 >>> raise",
                     "(j->>'k')::int >> raise"):
            with self.subTest(shift=text):
                self.assertFalse(
                    guards._is_statement_start(text, text.index("raise"))
                )
        # A single `>` was never a label terminator and still is not.
        self.assertFalse(guards._is_statement_start("a > raise", 4))
        # Every position where PostgreSQL really admits a statement still does.
        #
        # `DECLARE RAISE` was in this list when Round 14 was written, on the
        # assumption that DECLARE opens a statement. Round 16 put that to the
        # oracle and it is FALSE: `DECLARE RAISE EXCEPTION 'x';` is a syntax
        # error on PostgreSQL 17.11, because the parser reads the token after
        # DECLARE as a variable NAME - `DECLARE RAISE integer := 7;` compiles
        # and returns 7. The case is therefore not a statement position at
        # all, and asserting it was asserting a false fact about PostgreSQL.
        # It now lives in Round16DeclareIdentifierTests as a proven
        # NON-opener; keeping it here would have forced `declare` to stay in
        # the opener set and with it two live misclassifications.
        for text in ("; RAISE", "THEN RAISE", "ELSE RAISE", "BEGIN RAISE",
                     "LOOP RAISE", "RAISE"):
            with self.subTest(opener=text):
                self.assertTrue(
                    guards._is_statement_start(text, text.index("RAISE"))
                )

    # -- real denial controls ---------------------------------------------
    def test_genuine_raise_boundaries_still_deny(self) -> None:
        for name, deny in {
            "then_raise": "    RAISE EXCEPTION 'denied';\n",
            "semicolon_raise":
                "    v_flag := 1;\n    RAISE EXCEPTION 'denied';\n",
            "raise_using":
                "    RAISE EXCEPTION 'denied' USING HINT = 'no';\n",
            "raise_sqlstate": "    RAISE EXCEPTION SQLSTATE '28000';\n",
            # A real RAISE that FOLLOWS a shift expression is still a real
            # RAISE: the correction narrows what counts as a statement START,
            # it does not distrust a body that contains `>>`.
            "raise_after_a_shift_expression":
                "    v_flag := 8 >> 1;\n    RAISE EXCEPTION 'denied';\n",
            # The two ways a RAISE can genuinely follow a LABELLED construct,
            # which is what the deleted `>>` branch claimed to serve. Oracle:
            # both are valid, and in both the RAISE is preceded by the `;`
            # ending the labelled construct - never by the label's own `>>`.
            "raise_after_a_labelled_block_end":
                "    <<inner>>\n    BEGIN\n      NULL;\n    END inner;\n"
                "    RAISE EXCEPTION 'denied';\n",
            "raise_after_a_labelled_loop_end":
                "    <<lp>>\n    LOOP\n      EXIT lp;\n    END LOOP lp;\n"
                "    RAISE EXCEPTION 'denied';\n",
            # A jsonb `->>` is another `>>` producer; a following real RAISE
            # still arrives through the statement separator.
            "raise_after_a_jsonb_arrow":
                "    v_flag := (j->>'k')::int;\n"
                "    RAISE EXCEPTION 'denied';\n",
        }.items():
            with self.subTest(accept=name):
                self.assertEqual(
                    self.verdict(name, self.boolean_probe(deny)), [], name
                )

    def test_nested_begin_raise_stays_rejected_for_its_own_reason(self) -> None:
        """A RAISE wrapped in a nested BEGIN inside the deny branch is NOT a
        recognized boundary, and that is a SEPARATE, older rule: PR #241
        Finding 3/4 requires the deny branch to raise at the IF's OWN nesting
        level. Verified unchanged at the frozen head, so Round 14 neither
        relies on it nor relaxes it - `BEGIN RAISE` is proven at the helper
        level in test_statement_start_helper_rejects_a_shift_operator instead.
        """
        sql = self.boolean_probe(
            "    BEGIN\n      RAISE EXCEPTION 'denied';\n    END;\n"
        )
        self.assertTrue(self.verdict("nested_begin_raise", sql))

    def test_non_aborting_raise_levels_remain_non_denials(self) -> None:
        for level in ("NOTICE", "WARNING", "INFO", "LOG", "DEBUG"):
            with self.subTest(level=level):
                sql = self.boolean_probe(f"    RAISE {level} 'not a denial';\n")
                self.assertTrue(self.verdict(f"raise_{level.lower()}", sql))

    # -- label machinery must not regress ---------------------------------
    def test_real_labelled_constructs_still_parse(self) -> None:
        """`<<auth_block>> BEGIN ... END auth_block;` is the form PostgreSQL
        actually accepts - a label owning a bare RAISE is a syntax error - and
        it must still produce a real labelled frame."""
        body = (
            "<<auth_block>>\n"
            "BEGIN\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            "END auth_block;\n"
        )
        self.assertIn("auth_block", guards._block_labels(body, body).values())
        frames = guards.parse_blocks(body, body)
        self.assertIn(
            "auth_block", [f.label for f in frames if f.kind == "BEGIN"]
        )
        # The labelled-EXIT bypass that machinery protects still trips.
        self.assertTrue(
            self.verdict(
                "labelled_exit_still_rejected",
                "CREATE FUNCTION public.probe_fn(p_org uuid) RETURNS void\n"
                "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
                "<<auth_block>>\n"
                "BEGIN\n"
                "  UPDATE public.bins SET actual_qty = 0;\n"
                "  EXIT auth_block;\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "END auth_block;\n"
                "$$;\n",
            )
        )
        # A labelled LOOP - the other construct a label may own - is still a
        # labelled frame too.
        loop = (
            "<<lp>>\n"
            "LOOP\n"
            "  RAISE EXCEPTION 'denied';\n"
            "END LOOP lp;\n"
        )
        self.assertIn("lp", guards._block_labels(loop, loop).values())

    def test_shift_expressions_do_not_manufacture_label_structure(self) -> None:
        """A shift operator must not invent a labelled frame for the block
        machinery either - the same confusion seen from the other side."""
        body = (
            "BEGIN\n"
            "  v_flag := 8 >> 1;\n"
            "  v_other := 1 << 3;\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            "END;\n"
        )
        self.assertEqual(guards._block_labels(body, body), {})
        frames = guards.parse_blocks(body, body)
        self.assertEqual([f.label for f in frames if f.kind == "BEGIN"], [None])
        # And a routine whose body merely contains shifts is still judged on
        # its real guard.
        self.assertEqual(
            self.verdict(
                "shift_body_with_real_guard",
                "CREATE FUNCTION public.probe_fn(p_org uuid) RETURNS void\n"
                "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
                "DECLARE v_flag integer;\n"
                "BEGIN\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "  v_flag := 8 >> 1;\n"
                "  UPDATE public.bins SET actual_qty = 0;\n"
                "END;\n"
                "$$;\n",
            ),
            [],
        )


# ---------------------------------------------------------------------------
# Round 15: `END LOOP <label>` closes a loop; it does not open a RAISE
# ---------------------------------------------------------------------------
# Round 14 kept `LOOP` as a statement opener because `LOOP RAISE EXCEPTION ...`
# is genuine. PostgreSQL also closes a labelled loop as `END LOOP <label>;`,
# and `raise` is an ordinary label there, so the loop's END-LABEL read as the
# start of a RAISE statement.
#
# Oracle (PostgreSQL 17.11), every form compiled and raised NOTHING:
#   <<raise>> LOOP EXIT raise; END LOOP raise;
#   <<raise>> WHILE false LOOP NULL; END LOOP raise;
#   <<raise>> FOR i IN 1..0 LOOP NULL; END LOOP raise;
#   <<raise>> FOREACH x IN ARRAY a LOOP NULL; END LOOP raise;
# and `LOOP RAISE EXCEPTION 'denied'; END LOOP;` really raised P0001, so the
# identifier and the statement stay distinguishable. The quoted end-labels
# `"raise"` and `"RAISE"` are valid too; a Unicode `U&"rais\0065"` label is a
# syntax ERROR there, so there is no such form to support.
#
# Both callers of the shared helper were wrong, in OPPOSITE directions:
#   * parse_blocks() recorded the end label as the IF frame's raise_pos, so a
#     non-raising deny branch looked like an authorization boundary. Proven
#     unsafe: prosecdef = true, PUBLIC and authenticated both executable, and
#     a non-member call raised nothing and drove the privileged UPDATE
#     (bins.actual_qty 77 -> 0). check_file() returned [].
#   * unconditional_abort_before() counted the end label as an earlier
#     outer-level abort, so a real PERFORM guard after it was written off as
#     unreachable - a false RED on a correctly guarded routine.
class Round15LoopEndLabelTests(unittest.TestCase):
    """`END LOOP raise` must not be parsed as a RAISE statement."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round15_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    @staticmethod
    def boolean_probe(deny_body: str) -> str:
        """An unguarded SECURITY DEFINER routine whose only candidate
        authorization boundary is `deny_body`, followed by privileged work.

        The DECLARE section exists so every fixture below is SQL PostgreSQL
        actually compiles - each one was run through the 17.11 oracle. It
        deliberately declares no variable named `raise`: that name follows the
        DECLARE keyword, which IS a statement position, so it trips a separate
        pre-existing conservative false RED (Round 14) and a fixture resting on
        it would go green without testing this class at all.
        """
        return (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void\n"
            "LANGUAGE plpgsql\n"
            "SECURITY DEFINER\n"
            "AS $$\n"
            "DECLARE\n"
            "  v integer;\n"
            "  v_x integer;\n"
            "  v_arr integer[] := '{}';\n"
            "BEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            f"{deny_body}"
            "  END IF;\n"
            "\n"
            "  UPDATE public.bins\n"
            "  SET actual_qty = 0\n"
            "  WHERE org_id = p_org;\n"
            "END;\n"
            "$$;\n"
        )

    # -- 1. the reproducer, inside the IF branch --------------------------
    def test_loop_end_label_in_deny_branch_is_rejected(self) -> None:
        sql = self.boolean_probe(
            "    <<raise>>\n"
            "    WHILE false LOOP\n"
            "      NULL;\n"
            "    END LOOP raise;\n"
        )
        self.assertTrue(
            self.verdict("deny_branch_end_label", sql),
            "a loop END-LABEL named `raise` counted as a denying PL/pgSQL "
            "RAISE statement",
        )
        # And the frame itself must not record it, which is the defect proper.
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        definition = guards.parse_definitions(sql, masked)[0]
        body = masked[definition.start: definition.body_span[1]]
        raw_body = sql[definition.start: definition.body_span[1]]
        frames = guards.parse_blocks(body, raw_body)
        for frame in frames:
            if frame.kind == "IF":
                self.assertIsNone(
                    frame.raise_pos,
                    "the IF frame still records the loop end-label as a raise",
                )

    # -- 2. before a real PERFORM guard (the second caller) ---------------
    def test_loop_end_label_does_not_make_a_real_guard_unreachable(self) -> None:
        sql = (
            "CREATE FUNCTION public.probe_fn(p_org uuid) RETURNS void\n"
            "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "BEGIN\n"
            "  <<raise>>\n"
            "  WHILE false LOOP\n"
            "    NULL;\n"
            "  END LOOP raise;\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
            "END;\n"
            "$$;\n"
        )
        self.assertEqual(
            self.verdict("guard_after_end_label", sql),
            [],
            "an end label named `raise` was treated as an earlier abort and "
            "a real guard after it was reported unreachable",
        )
        masked, _ = guards.mask_sql_checked(sql)
        definition = guards.parse_definitions(sql, masked)[0]
        body = masked[definition.start: definition.body_span[1]]
        raw_body = sql[definition.start: definition.body_span[1]]
        frames = guards.parse_blocks(body, raw_body)
        guard_at = guards.GUARD_RE.search(body).start()
        self.assertFalse(
            guards.unconditional_abort_before(body, frames, guard_at)
        )
        self.assertFalse(
            guards.is_unreachable_at(body, frames, guard_at, raw_body)
        )

    # -- 3. combined with a nested BEGIN / EXCEPTION section --------------
    def test_loop_end_label_with_nested_begin_and_handler(self) -> None:
        """The end label must stay inert even where a real RAISE would be
        swallowed, so neither rule can lean on the other."""
        cases = {
            # The deny branch wraps the loop in its own BEGIN ... EXCEPTION
            # block. Nothing here denies anything.
            "nested_begin_with_handler": self.boolean_probe(
                "    BEGIN\n"
                "      <<raise>>\n"
                "      LOOP\n"
                "        EXIT raise;\n"
                "      END LOOP raise;\n"
                "    EXCEPTION WHEN OTHERS THEN\n"
                "      NULL;\n"
                "    END;\n"
            ),
            # A labelled FOR loop, the other oracle-valid spelling.
            "labelled_for_loop": self.boolean_probe(
                "    <<raise>>\n"
                "    FOR i IN 1..0 LOOP\n"
                "      NULL;\n"
                "    END LOOP raise;\n"
            ),
            # Keyword folding: PostgreSQL is case-insensitive here, and the
            # label keeps its own case.
            "mixed_case_end_loop": self.boolean_probe(
                "    <<RaIsE>>\n"
                "    LOOP\n"
                "      EXIT RaIsE;\n"
                "    end loop RaIsE;\n"
            ),
            # An inner labelled loop closing inside an outer one.
            "nested_loops_inner_label": self.boolean_probe(
                "    <<outer>>\n"
                "    LOOP\n"
                "      <<raise>>\n"
                "      LOOP\n"
                "        EXIT raise;\n"
                "      END LOOP raise;\n"
                "      EXIT outer;\n"
                "    END LOOP outer;\n"
            ),
            # Comments on BOTH sides of the LOOP keyword.
            "comments_around_loop_keyword": self.boolean_probe(
                "    <<raise>>\n"
                "    LOOP\n"
                "      EXIT raise;\n"
                "    END /* a */ LOOP /* b */ raise;\n"
            ),
            # A real shift expression inside the loop, so the Round 14 and
            # Round 15 rules are exercised in one body.
            "shift_inside_loop_with_end_label": self.boolean_probe(
                "    <<raise>>\n"
                "    LOOP\n"
                "      v := 8 >> 1;\n"
                "      EXIT raise;\n"
                "    END LOOP raise;\n"
            ),
            # A labelled FOREACH loop.
            "labelled_foreach_loop": self.boolean_probe(
                "    <<raise>>\n"
                "    FOREACH v_x IN ARRAY v_arr LOOP\n"
                "      NULL;\n"
                "    END LOOP raise;\n"
            ),
        }
        for name, sql in cases.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a loop end-label supplied an authorization "
                    f"boundary PostgreSQL never executes",
                )

    # -- spacing and comments must not decide -----------------------------
    def test_end_label_recognition_is_independent_of_spacing(self) -> None:
        """Every spelling below is oracle-valid. The masker turns a comment
        into whitespace before the helper sees it, which is why one backward
        word scan covers all of them."""
        cases = {
            "same_line": "    END LOOP raise;\n",
            "newline_before_label": "    END LOOP\n      raise;\n",
            "block_comment": "    END LOOP /* c */ raise;\n",
            "line_comment": "    END LOOP -- why\n      raise;\n",
            "newline_between_end_and_loop": "    END\n    LOOP raise;\n",
            "tabs": "    END\tLOOP\traise;\n",
        }
        for name, tail in cases.items():
            with self.subTest(case=name):
                sql = self.boolean_probe(
                    "    <<raise>>\n    LOOP\n      EXIT raise;\n" + tail
                )
                self.assertTrue(self.verdict(name, sql), name)

    def test_statement_start_helper_reads_end_loop_as_a_close(self) -> None:
        """The shared helper itself, so BOTH callers inherit one rule."""
        for text in (
            "  END LOOP raise;",
            "  END LOOP\n    raise;",
            "  END LOOP         raise;",   # masked block comment
            "  END\n  LOOP raise;",
            "  END\tLOOP\traise;",
        ):
            with self.subTest(close=text):
                self.assertFalse(
                    guards._is_statement_start(text, text.lower().rindex("raise"))
                )
        # Everything that genuinely OPENS a loop body still admits a RAISE.
        for text in (
            "  LOOP RAISE EXCEPTION 'x';",
            "  <<lp>>\n  LOOP RAISE EXCEPTION 'x';",
            "  WHILE x LOOP RAISE EXCEPTION 'x';",
            "  FOR i IN 1..3 LOOP RAISE EXCEPTION 'x';",
            "  FOREACH v IN ARRAY a LOOP RAISE EXCEPTION 'x';",
            "  END LOOP; RAISE EXCEPTION 'x';",
        ):
            with self.subTest(open=text):
                self.assertTrue(
                    guards._is_statement_start(text, text.rindex("RAISE"))
                )
        # A labelled BLOCK closes as `END <label>;`, and `END` was never an
        # opener - so that form needed no change and still reads as inert.
        self.assertFalse(guards._is_statement_start("  END raise;", 6))

    # -- quoted end-labels -------------------------------------------------
    def test_quoted_loop_end_labels_are_never_a_raise(self) -> None:
        """Oracle: `<<"raise">> ... END LOOP "raise";` and the `"RAISE"`
        spelling are both valid. The masker blanks quoted-identifier CONTENT
        while keeping the delimiters, so no RAISE token survives there at
        all - this pins that, rather than assuming it."""
        for name, label in (("lower", '"raise"'), ("upper", '"RAISE"')):
            with self.subTest(case=name):
                sql = self.boolean_probe(
                    f"    <<{label}>>\n"
                    "    LOOP\n"
                    f"      EXIT {label};\n"
                    f"    END LOOP {label};\n"
                )
                self.assertTrue(self.verdict(f"quoted_{name}", sql))
                masked, problems = guards.mask_sql_checked(sql)
                self.assertEqual(problems, [])
                self.assertNotIn("raise", masked.lower()[masked.index("END LOOP"):])

    # -- Round 14 must stay closed ----------------------------------------
    def test_round14_shift_operator_stays_closed(self) -> None:
        """`>>` must still not open a statement, through the refactored path."""
        for text in ("8 >> raise", "8>>raise", "(8 >> raise)",
                     "8 >>         raise", "(j->>'k')::int >> raise"):
            with self.subTest(shift=text):
                self.assertFalse(
                    guards._is_statement_start(text, text.index("raise"))
                )
        select = "(SELECT 8 %s raise FROM public.raise_source LIMIT 1)"
        for name, expr in {
            "spaced": select % ">>",
            "no_space": "(SELECT 8>>raise FROM public.raise_source LIMIT 1)",
            "parenthesised":
                "(SELECT (8 >> raise) FROM public.raise_source LIMIT 1)",
            "block_comment":
                "(SELECT 8 >> /* c */ raise "
                "FROM public.raise_source LIMIT 1)",
            "nested_select":
                "(SELECT (SELECT 8 >> raise "
                "FROM public.raise_source LIMIT 1))",
        }.items():
            with self.subTest(expression=name):
                self.assertTrue(
                    self.verdict(
                        f"r14_{name}", self.boolean_probe(f"    v := {expr};\n")
                    )
                )
        # A PARAMETER named raise, and a COLUMN named raise, both stay
        # ordinary identifiers.
        self.assertTrue(
            self.verdict(
                "r14_parameter_named_raise",
                "CREATE FUNCTION public.probe_fn(p_org uuid, raise integer)\n"
                "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
                "DECLARE v integer;\n"
                "BEGIN\n"
                "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                "    v := 8 >> raise;\n"
                "  END IF;\n"
                "  UPDATE public.bins SET actual_qty = 0;\n"
                "END;\n$$;\n",
            )
        )

    # -- real RAISE controls ----------------------------------------------
    def test_genuine_raise_boundaries_still_deny(self) -> None:
        for name, deny in {
            "then_raise": "    RAISE EXCEPTION 'denied';\n",
            "semicolon_raise": "    v := 1;\n    RAISE EXCEPTION 'denied';\n",
            "raise_using": "    RAISE EXCEPTION 'denied' USING HINT = 'no';\n",
            "raise_sqlstate": "    RAISE EXCEPTION SQLSTATE '28000';\n",
            # A real RAISE after a labelled loop's close still reaches the `;`.
            "raise_after_end_loop_label":
                "    <<lp>>\n    LOOP\n      EXIT lp;\n    END LOOP lp;\n"
                "    RAISE EXCEPTION 'denied';\n",
            # ... including when that label is itself named `raise`.
            "raise_after_end_loop_named_raise":
                "    <<raise>>\n    LOOP\n      EXIT raise;\n"
                "    END LOOP raise;\n"
                "    RAISE EXCEPTION 'denied';\n",
        }.items():
            with self.subTest(accept=name):
                self.assertEqual(
                    self.verdict(name, self.boolean_probe(deny)), [], name
                )

    def test_loop_wrapped_raise_stays_rejected_for_its_own_reason(self) -> None:
        """A genuine `LOOP RAISE EXCEPTION ...` still classifies as a real
        RAISE statement - that is proven at the helper level in
        test_statement_start_helper_reads_end_loop_as_a_close.

        End to end, a RAISE wrapped in a LOOP *inside the deny branch* is
        still not a recognized boundary, for a SEPARATE and older reason: PR
        #241 Finding 3/4 requires the deny branch to raise at the IF's OWN
        nesting level, so a raise one frame deeper never set raise_pos. All
        five loop forms below behave identically at the frozen head
        f620f392 and here, so Round 15 neither relies on that rule nor
        relaxes it.
        """
        for name, deny in {
            "loop": "    LOOP\n      RAISE EXCEPTION 'denied';\n    END LOOP;\n",
            "labelled_loop":
                "    <<lp>>\n    LOOP\n      RAISE EXCEPTION 'denied';\n"
                "    END LOOP lp;\n",
            "while_loop":
                "    WHILE true LOOP\n      RAISE EXCEPTION 'denied';\n"
                "    END LOOP;\n",
            "for_loop":
                "    FOR i IN 1..3 LOOP\n      RAISE EXCEPTION 'denied';\n"
                "    END LOOP;\n",
            "foreach_loop":
                "    FOREACH v_x IN ARRAY v_arr LOOP\n"
                "      RAISE EXCEPTION 'denied';\n    END LOOP;\n",
        }.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(f"loop_wrapped_{name}", self.boolean_probe(deny))
                )

    def test_non_aborting_raise_levels_remain_non_denials(self) -> None:
        for level in ("NOTICE", "WARNING", "INFO", "LOG", "DEBUG"):
            with self.subTest(level=level):
                self.assertTrue(
                    self.verdict(
                        f"raise_{level.lower()}",
                        self.boolean_probe(f"    RAISE {level} 'not a denial';\n"),
                    )
                )

    # -- label machinery unchanged ----------------------------------------
    def test_label_parsing_is_untouched(self) -> None:
        """The end-label read is two keywords, not a label parser: label
        identity still comes only from _block_labels()/_labelled_opener()."""
        loop = (
            "<<raise>>\n"
            "WHILE false LOOP\n"
            "  NULL;\n"
            "END LOOP raise;\n"
        )
        self.assertIn("raise", guards._block_labels(loop, loop).values())
        frames = guards.parse_blocks(loop, loop)
        self.assertIn("raise", [f.label for f in frames if f.kind == "LOOP"])
        block = (
            "<<auth_block>>\n"
            "BEGIN\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            "END auth_block;\n"
        )
        self.assertIn("auth_block", guards._block_labels(block, block).values())
        # The labelled-EXIT bypass still trips, including on a loop labelled
        # `raise`.
        self.assertTrue(
            self.verdict(
                "labelled_exit_still_rejected",
                "CREATE FUNCTION public.probe_fn(p_org uuid) RETURNS void\n"
                "LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
                "<<auth_block>>\n"
                "BEGIN\n"
                "  UPDATE public.bins SET actual_qty = 0;\n"
                "  EXIT auth_block;\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "END auth_block;\n"
                "$$;\n",
            )
        )


# ---------------------------------------------------------------------------
# Round 16: DECLARE opens a declaration section, not a statement
# ---------------------------------------------------------------------------
# `declare` sat in _STATEMENT_OPENER_KEYWORDS, so the identifier in
# `DECLARE raise integer := 1;` read as the start of a RAISE statement.
#
# Oracle (PostgreSQL 17.11). A RAISE statement cannot follow DECLARE at all -
# every spelling is a syntax error, because the parser takes the token after
# DECLARE as a variable NAME and then chokes on the message literal:
#
#   DECLARE RAISE EXCEPTION 'x'; BEGIN ... END          -> syntax error
#   DECLARE \n RAISE EXCEPTION 'x'; BEGIN ... END       -> syntax error
#   BEGIN DECLARE RAISE EXCEPTION 'x'; BEGIN ... END;   -> syntax error
#
# and `DECLARE RAISE integer := 7; BEGIN RETURN RAISE; END` compiles and
# returns 7 - proof that the token is a name. The real form reaches its RAISE
# through BEGIN, which is still an opener:
#
#   DECLARE x integer; BEGIN RAISE EXCEPTION 'x'; END   -> valid
#
# Every declaration form naming the variable `raise` is valid there: bare,
# initialised, custom-typed, `ALIAS FOR $1`, and CONSTANT.
#
# Both callers of the shared helper were wrong, in OPPOSITE directions:
#   * parse_blocks() recorded the declared identifier as the IF frame's
#     raise_pos (170, token 'raise '), so a deny branch that denies nothing
#     read as an authorization boundary. Proven unsafe: prosecdef = true,
#     PUBLIC and authenticated both executable, and a non-member call raised
#     nothing and drove the privileged UPDATE (bins.actual_qty 55 -> 0).
#     check_file() returned [].
#   * unconditional_abort_before() counted it as an earlier outer-level
#     abort, so a real PERFORM guard after an outer `DECLARE raise integer :=
#     1;` was reported unreachable - a false RED on a routine the oracle
#     shows really denies (guard raised TENANT_MEMBERSHIP_REQUIRED, and the
#     UPDATE did not run for the non-member).
class Round16DeclareIdentifierTests(unittest.TestCase):
    """`DECLARE raise` must not be parsed as a RAISE statement."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round16_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    @staticmethod
    def boolean_probe(deny_body: str) -> str:
        """An unguarded SECURITY DEFINER routine whose only candidate
        authorization boundary is `deny_body`, followed by privileged work."""
        return (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void\n"
            "LANGUAGE plpgsql\n"
            "SECURITY DEFINER\n"
            "AS $$\n"
            "BEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            f"{deny_body}"
            "  END IF;\n"
            "\n"
            "  UPDATE public.bins\n"
            "  SET actual_qty = 0\n"
            "  WHERE org_id = p_org;\n"
            "END;\n"
            "$$;\n"
        )

    # -- 1. deny branch with a DECLARE variable named raise ----------------
    def test_declared_identifier_in_deny_branch_is_rejected(self) -> None:
        sql = self.boolean_probe(
            "    DECLARE\n"
            "      raise integer := 1;\n"
            "    BEGIN\n"
            "      raise := 2;\n"
            "    END;\n"
        )
        self.assertTrue(
            self.verdict("deny_branch_declare", sql),
            "a DECLARE'd variable named `raise` counted as a denying "
            "PL/pgSQL RAISE statement",
        )
        # The defect proper: the IF frame must not record it.
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        definition = guards.parse_definitions(sql, masked)[0]
        body = masked[definition.start: definition.body_span[1]]
        raw_body = sql[definition.start: definition.body_span[1]]
        for frame in guards.parse_blocks(body, raw_body):
            if frame.kind == "IF":
                self.assertIsNone(
                    frame.raise_pos,
                    "the IF frame still records the declared identifier as a "
                    "raise",
                )

    # -- 2. outer DECLARE raise before a real PERFORM guard ---------------
    def test_declared_identifier_does_not_make_a_guard_unreachable(self) -> None:
        sql = (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void\n"
            "LANGUAGE plpgsql\n"
            "SECURITY DEFINER\n"
            "AS $$\n"
            "DECLARE\n"
            "  raise integer := 1;\n"
            "BEGIN\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            "\n"
            "  UPDATE public.bins\n"
            "  SET actual_qty = 0\n"
            "  WHERE org_id = p_org;\n"
            "END;\n"
            "$$;\n"
        )
        self.assertEqual(
            self.verdict("guard_after_declare", sql),
            [],
            "a declared identifier named `raise` was treated as an earlier "
            "abort and a real guard after it was reported unreachable",
        )
        masked, _ = guards.mask_sql_checked(sql)
        definition = guards.parse_definitions(sql, masked)[0]
        body = masked[definition.start: definition.body_span[1]]
        raw_body = sql[definition.start: definition.body_span[1]]
        frames = guards.parse_blocks(body, raw_body)
        guard_at = guards.GUARD_RE.search(body).start()
        self.assertFalse(
            guards.unconditional_abort_before(body, frames, guard_at)
        )
        self.assertFalse(
            guards.is_unreachable_at(body, frames, guard_at, raw_body)
        )

    # -- 3. DECLARE raise then a genuine BEGIN RAISE control --------------
    def test_declare_section_then_begin_raise_still_denies(self) -> None:
        """The oracle's valid form: the real RAISE arrives through BEGIN, so
        removing `declare` from the opener set must not cost it."""
        sql = (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "DECLARE\n"
            "  raise integer := 1;\n"
            "BEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    RAISE EXCEPTION 'TENANT_DENIED';\n"
            "  END IF;\n"
            "\n"
            "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
            "END;\n"
            "$$;\n"
        )
        self.assertEqual(self.verdict("declare_then_begin_raise", sql), [])

    # -- 4. combined with nested block / loop / exception structure -------
    def test_declared_identifier_with_nested_structure(self) -> None:
        cases = {
            # A nested DECLARE ... BEGIN ... EXCEPTION block. Nothing denies.
            "nested_declare_with_handler": self.boolean_probe(
                "    DECLARE\n"
                "      raise integer := 1;\n"
                "    BEGIN\n"
                "      raise := 2;\n"
                "    EXCEPTION WHEN OTHERS THEN\n"
                "      NULL;\n"
                "    END;\n"
            ),
            # A declared identifier used inside a loop.
            "declare_then_loop": self.boolean_probe(
                "    DECLARE\n"
                "      raise integer := 1;\n"
                "    BEGIN\n"
                "      WHILE raise < 2 LOOP\n"
                "        raise := raise + 1;\n"
                "      END LOOP;\n"
                "    END;\n"
            ),
            # Round 15's end-label and Round 16's declaration in one body.
            "declare_and_loop_end_label": self.boolean_probe(
                "    DECLARE\n"
                "      raise integer := 1;\n"
                "    BEGIN\n"
                "      <<raise_lbl>>\n"
                "      LOOP\n"
                "        EXIT raise_lbl;\n"
                "      END LOOP raise_lbl;\n"
                "    END;\n"
            ),
            # Round 14's shift and Round 16's declaration in one body.
            "declare_and_shift": self.boolean_probe(
                "    DECLARE\n"
                "      raise integer := 1;\n"
                "      v integer;\n"
                "    BEGIN\n"
                "      v := 8 >> raise;\n"
                "    END;\n"
            ),
        }
        for name, sql in cases.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: a declaration supplied an authorization "
                    f"boundary PostgreSQL never executes",
                )

    # -- every declaration form the oracle accepts ------------------------
    def test_every_valid_declaration_form_is_inert(self) -> None:
        """Bare, initialised, custom-typed, ALIAS FOR and CONSTANT - all five
        compile on PostgreSQL 17.11 with the variable named `raise`."""
        cases = {
            "bare": "      raise integer;\n    BEGIN\n      raise := 1;\n",
            "initialised":
                "      raise integer := 1;\n    BEGIN\n      raise := 2;\n",
            "custom_type":
                "      raise public.some_type;\n    BEGIN\n      NULL;\n",
            "constant":
                "      raise CONSTANT integer := 1;\n    BEGIN\n      NULL;\n",
        }
        for name, decl in cases.items():
            with self.subTest(case=name):
                sql = self.boolean_probe(
                    "    DECLARE\n" + decl + "    END;\n"
                )
                self.assertTrue(self.verdict(f"form_{name}", sql), name)
        # `ALIAS FOR $1` needs a positional parameter, so it gets its own body.
        alias = (
            "CREATE FUNCTION public.probe_fn(p_org uuid, integer)\n"
            "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "DECLARE\n"
            "  raise ALIAS FOR $2;\n"
            "BEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    PERFORM raise;\n"
            "  END IF;\n"
            "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
            "END;\n"
            "$$;\n"
        )
        self.assertTrue(self.verdict("form_alias_for", alias))

    def test_statement_start_helper_rejects_a_declaration(self) -> None:
        """The shared helper and the shared opener set, so BOTH callers
        inherit one rule rather than being patched separately."""
        self.assertNotIn("declare", guards._STATEMENT_OPENER_KEYWORDS)
        self.assertEqual(
            guards._STATEMENT_OPENER_KEYWORDS,
            frozenset({"then", "else", "begin", "loop"}),
        )
        for text in (
            "  DECLARE\n    raise integer := 1;",
            "  DECLARE raise integer;",
            "  declare\n\traise integer;",
            "  DECLARE         raise integer;",   # masked comment
        ):
            with self.subTest(declaration=text):
                self.assertFalse(
                    guards._is_statement_start(text, text.lower().rindex("raise"))
                )
        # Every position where PostgreSQL really admits a statement still does.
        for text in ("; RAISE", "THEN RAISE", "ELSE RAISE", "BEGIN RAISE",
                     "LOOP RAISE", "RAISE"):
            with self.subTest(opener=text):
                self.assertTrue(
                    guards._is_statement_start(text, text.index("RAISE"))
                )

    # -- genuine RAISE controls -------------------------------------------
    def test_genuine_raise_boundaries_still_deny(self) -> None:
        for name, deny in {
            "then_raise": "    RAISE EXCEPTION 'denied';\n",
            "semicolon_raise":
                "    PERFORM 1;\n    RAISE EXCEPTION 'denied';\n",
            "raise_using":
                "    RAISE EXCEPTION 'denied' USING HINT = 'no';\n",
            "raise_sqlstate": "    RAISE EXCEPTION SQLSTATE '28000';\n",
            # A real RAISE after a DECLARE section's BEGIN.
            "raise_after_declare_begin":
                "    DECLARE\n      raise integer := 1;\n"
                "    BEGIN\n      NULL;\n    END;\n"
                "    RAISE EXCEPTION 'denied';\n",
        }.items():
            with self.subTest(accept=name):
                self.assertEqual(
                    self.verdict(name, self.boolean_probe(deny)), [], name
                )

    def test_non_aborting_raise_levels_remain_non_denials(self) -> None:
        for level in ("NOTICE", "WARNING", "INFO", "LOG", "DEBUG"):
            with self.subTest(level=level):
                self.assertTrue(
                    self.verdict(
                        f"raise_{level.lower()}",
                        self.boolean_probe(
                            f"    RAISE {level} 'not a denial';\n"
                        ),
                    )
                )

    # -- Rounds 13-15 must stay closed ------------------------------------
    def test_rounds_13_to_15_stay_closed(self) -> None:
        """One helper serves them all, so each earlier correction is
        re-proven through the corrected path."""
        # Round 15: the loop END-LABEL.
        for text in ("  END LOOP raise;", "  END LOOP\n    raise;",
                     "  END\tLOOP\traise;", "  END LOOP         raise;"):
            with self.subTest(round15=text):
                self.assertFalse(
                    guards._is_statement_start(text, text.lower().rindex("raise"))
                )
        # Round 14: the shift operator.
        for text in ("8 >> raise", "8>>raise", "(8 >> raise)",
                     "8 >>         raise", "(j->>'k')::int >> raise"):
            with self.subTest(round14=text):
                self.assertFalse(
                    guards._is_statement_start(text, text.index("raise"))
                )
        # Round 13 F8: an ordinary identifier in SQL.
        for text in ("SELECT 1 AS raise", "SELECT raise FROM t",
                     "v := raise"):
            with self.subTest(round13=text):
                self.assertFalse(
                    guards._is_statement_start(text, text.index("raise"))
                )
        # And end to end for each round, so the verdicts are proven too.
        self.assertTrue(
            self.verdict(
                "r15_end_loop_label",
                self.boolean_probe(
                    "    <<raise>>\n    WHILE false LOOP\n      NULL;\n"
                    "    END LOOP raise;\n"
                ),
            )
        )
        self.assertTrue(
            self.verdict(
                "r14_shift",
                self.boolean_probe(
                    "    PERFORM (SELECT 8 >> raise "
                    "FROM public.raise_source LIMIT 1);\n"
                ),
            )
        )
        self.assertTrue(
            self.verdict(
                "r13_as_raise",
                self.boolean_probe("    PERFORM (SELECT 1 AS raise);\n"),
            )
        )

class Round17DeclarationRegionTests(unittest.TestCase):
    """Declarations and assignment targets are not RAISE statements.

    Round 16 removed `declare` from the opener set, which settled the FIRST
    declaration of a variable named `raise`. Two siblings survived it, because
    neither is reached through the DECLARE keyword, and every fixture below was
    compiled on PostgreSQL 17.11 before it was asserted on:

      * a SECOND or THIRD declaration arrives after the `;` that ends the
        previous one, and `;` opens a statement - a false GREEN: the oracle
        shows the routine denies nothing and a non-member drove the privileged
        UPDATE (bins.actual_qty 55 -> 0) while check_file() returned [];
      * `raise := 2` arrives after the BEGIN that ends the declaration section,
        and `begin` rightly opens a statement - a false RED: the oracle shows
        the assignment aborts nothing (the authorized path writes the assigned
        value) and the real PERFORM guard after it denies a non-member with
        TENANT_MEMBERSHIP_REQUIRED, yet the guard was called unreachable.
    """

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round17_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    @staticmethod
    def boolean_probe(deny_body: str) -> str:
        """An unguarded SECURITY DEFINER routine whose only candidate
        authorization boundary is `deny_body`, followed by privileged work."""
        return (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void\n"
            "LANGUAGE plpgsql\n"
            "SECURITY DEFINER\n"
            "AS $$\n"
            "BEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            f"{deny_body}"
            "  END IF;\n"
            "\n"
            "  UPDATE public.bins\n"
            "  SET actual_qty = 0\n"
            "  WHERE org_id = p_org;\n"
            "END;\n"
            "$$;\n"
        )

    @staticmethod
    def guarded_probe(prelude: str, epilogue: str = "") -> str:
        """A routine whose real guard sits at the function's outer level, after
        `prelude`. The oracle denies a non-member in every form used here."""
        return (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void\n"
            "LANGUAGE plpgsql\n"
            "SECURITY DEFINER\n"
            "AS $$\n"
            f"{prelude}"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            "\n"
            "  UPDATE public.bins\n"
            "  SET actual_qty = 0\n"
            "  WHERE org_id = p_org;\n"
            f"{epilogue}"
            "END;\n"
            "$$;\n"
        )

    def body_of(self, sql: str):
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        definition = guards.parse_definitions(sql, masked)[0]
        return (
            masked[definition.start: definition.body_span[1]],
            sql[definition.start: definition.body_span[1]],
        )

    # -- 1. a SECOND declaration named raise -------------------------------
    def test_second_declaration_is_not_a_raise(self) -> None:
        """Oracle: compiles, raises nothing, and a non-member reached the
        privileged UPDATE (55 -> 0). It must be rejected."""
        sql = self.boolean_probe(
            "    DECLARE\n"
            "      x integer := 1;\n"
            "      raise integer := 2;\n"
            "    BEGIN\n"
            "      x := x + raise;\n"
            "    END;\n"
        )
        self.assertTrue(
            self.verdict("second_declaration", sql),
            "a second DECLARE'd variable named `raise`, reached through the "
            "`;` of the previous declaration, counted as a denying RAISE",
        )
        body, raw_body = self.body_of(sql)
        for frame in guards.parse_blocks(body, raw_body):
            if frame.kind == "IF":
                self.assertIsNone(
                    frame.raise_pos,
                    "the IF frame still records a declaration identifier as "
                    "its raise_pos",
                )

    # -- 2. a THIRD declaration named raise --------------------------------
    def test_third_declaration_is_not_a_raise(self) -> None:
        sql = self.boolean_probe(
            "    DECLARE\n"
            "      a integer := 1;\n"
            "      b integer := 2;\n"
            "      raise integer := 3;\n"
            "    BEGIN\n"
            "      a := b + raise;\n"
            "    END;\n"
        )
        self.assertTrue(
            self.verdict("third_declaration", sql),
            "position in the declaration list changed the classification",
        )

    # -- 3. `raise := 2` immediately after BEGIN ---------------------------
    def test_assignment_after_begin_is_not_an_abort(self) -> None:
        """The false RED. Oracle: the assignment executes and aborts nothing,
        and the guard after it really denies a non-member."""
        sql = self.guarded_probe(
            "DECLARE\n"
            "  raise integer := 1;\n"
            "BEGIN\n"
            "  raise := 2;\n"
            "\n"
        )
        self.assertEqual(
            self.verdict("assignment_after_begin", sql),
            [],
            "an assignment to a variable named `raise` counted as an earlier "
            "abort and a real guard after it was reported unreachable",
        )
        body, raw_body = self.body_of(sql)
        frames = guards.parse_blocks(body, raw_body)
        guard_at = guards.GUARD_RE.search(body).start()
        self.assertFalse(
            guards.unconditional_abort_before(body, frames, guard_at),
            "the assignment still reads as an outer-level aborting RAISE",
        )
        self.assertFalse(
            guards.is_unreachable_at(body, frames, guard_at, raw_body)
        )

    # -- 4. a nested DECLARE section ---------------------------------------
    def test_nested_declaration_section(self) -> None:
        """The inner BEGIN ends the inner DECLARE; the outer BEGIN, which lies
        BEFORE it, must not be mistaken for the section's opener."""
        sql = (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "BEGIN\n"
            "  DECLARE\n"
            "    x integer;\n"
            "    raise integer := 1;\n"
            "  BEGIN\n"
            "    raise := 2;\n"
            "    x := raise;\n"
            "  END;\n"
            "\n"
            "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
            "END;\n"
            "$$;\n"
        )
        self.assertTrue(
            self.verdict("nested_declaration", sql),
            "a nested DECLARE section's identifier authorized nothing yet the "
            "routine was accepted",
        )

    # -- 5. the control that matters most: DECLARE then a genuine RAISE ----
    def test_real_raise_after_the_sections_begin_still_denies(self) -> None:
        """Suppression must END at the BEGIN that closes the declaration
        section, or every real `DECLARE ...; BEGIN RAISE ...` guard is lost."""
        for name, deny in (
            ("exception", "RAISE EXCEPTION 'TENANT_DENIED';"),
            ("sqlstate", "RAISE SQLSTATE 'P0001';"),
        ):
            sql = (
                "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
                "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
                "DECLARE\n"
                "  raise integer := 1;\n"
                "BEGIN\n"
                "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                f"    {deny}\n"
                "  END IF;\n"
                "\n"
                "  UPDATE public.bins SET actual_qty = raise "
                "WHERE org_id = p_org;\n"
                "END;\n"
                "$$;\n"
            )
            self.assertEqual(
                self.verdict(f"real_raise_{name}", sql),
                [],
                f"a genuine `{deny}` after the declaration section's BEGIN "
                "stopped being recognized",
            )

    # -- 6. declaration + assignment before a real guard -------------------
    def test_every_declaration_form_stays_inert_before_a_real_guard(self) -> None:
        """All the shapes PostgreSQL 17.11 accepts for a variable named
        `raise`, each verified to compile, and each followed by a real guard
        the oracle shows denies a non-member."""
        prelude = (
            "DECLARE\n"
            "  d1 integer;\n"
            "  d2 integer := 1;\n"
            "  d3 CONSTANT integer := 2;\n"
            "  d4 public.bins.actual_qty%TYPE;\n"
            "  d5 public.bins%ROWTYPE;\n"
            "\n"
            "  -- a comment between declarations\n"
            "  /* and a block comment */\n"
            "  RaIsE integer := 3;\n"
            "BEGIN\n"
            "  RaIsE := 4;\n"
            "\n"
        )
        self.assertEqual(
            self.verdict("all_declaration_forms", self.guarded_probe(prelude)),
            [],
            "a valid declaration form or a mixed-case assignment was read as "
            "an abort",
        )
        # PL/pgSQL also spells assignment with a bare `=` on 17.11.
        self.assertEqual(
            self.verdict(
                "bare_equals_assignment",
                self.guarded_probe(
                    "DECLARE\n  raise integer := 1;\nBEGIN\n  raise = 2;\n\n"
                ),
            ),
            [],
        )

    # -- 7. combined with the EXCEPTION-handler surface --------------------
    def test_declaration_region_with_exception_handlers(self) -> None:
        """A handler that cannot catch P0001 leaves the guard standing; one
        that can still swallows it. Both verified on the oracle."""
        # Round 26: this block DECLARES, so its non-catching handler must
        # re-raise to be provably inert; the `NULL;` form - which completes
        # normally and would keep any declaration side effect - is refused.
        self.assertEqual(
            self.verdict(
                "handler_not_catching",
                self.guarded_probe(
                    "DECLARE\n  raise integer := 1;\nBEGIN\n  raise := 2;\n\n",
                    "EXCEPTION WHEN unique_violation THEN\n  RAISE;\n",
                ),
            ),
            [],
            "a handler for an unrelated condition invalidated a real guard",
        )
        self.assertTrue(
            self.verdict(
                "handler_not_catching_null",
                self.guarded_probe(
                    "DECLARE\n  raise integer := 1;\nBEGIN\n  raise := 2;\n\n",
                    "EXCEPTION WHEN unique_violation THEN\n  NULL;\n",
                ),
            ),
            "Round 26: a normally-completing handler on a declaring block was "
            "accepted",
        )
        self.assertTrue(
            self.verdict(
                "handler_catching",
                self.guarded_probe(
                    "DECLARE\n  raise integer := 1;\nBEGIN\n  raise := 2;\n\n",
                    "EXCEPTION WHEN raise_exception THEN\n  NULL;\n",
                ),
            ),
            "a handler that catches P0001 swallowed the denial and the "
            "routine was still accepted",
        )

    # -- 8. combined with RETURN reachability and the loop/shift surfaces --
    def test_declaration_region_with_earlier_remediations(self) -> None:
        # RETURN still ends the invocation, so a guard after it is unreachable.
        self.assertTrue(
            self.verdict(
                "return_before_guard",
                "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
                "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
                "DECLARE\n"
                "  raise integer := 1;\n"
                "BEGIN\n"
                "  raise := 2;\n"
                "  RETURN;\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n"
                "END;\n"
                "$$;\n",
            ),
            "a guard after an unconditional RETURN was treated as reachable",
        )
        # Round 15's end label and Round 14's shift, inside a declaration
        # section that Round 17 now suppresses. Nothing here denies.
        self.assertTrue(
            self.verdict(
                "declaration_with_loop_label_and_shift",
                self.boolean_probe(
                    "    DECLARE\n"
                    "      v integer := 1;\n"
                    "      raise integer := 2;\n"
                    "    BEGIN\n"
                    "      <<raise>>\n"
                    "      WHILE false LOOP\n"
                    "        v := 8 >> raise;\n"
                    "      END LOOP raise;\n"
                    "    END;\n"
                ),
            ),
            "an end label, a shift operand and a declaration identifier "
            "together still read as an authorization boundary",
        )

    # -- 9. `declare` is UNRESERVED, so the word alone opens nothing --------
    def test_identifier_named_declare_opens_no_section(self) -> None:
        """`SELECT declare INTO v FROM t` runs on 17.11, so the bare word is a
        legal identifier. If it opened a region, the span would swallow the
        real outer-level abort after it and a routine whose guard genuinely
        cannot run would be accepted."""
        sql = (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "DECLARE\n"
            "  v integer;\n"
            "BEGIN\n"
            "  SELECT declare INTO v FROM public.t LIMIT 1;\n"
            "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
            "END;\n"
            "$$;\n"
        )
        self.assertTrue(
            self.verdict("identifier_declare", sql),
            "an identifier named `declare` opened a declaration section that "
            "swallowed a real outer-level abort",
        )
        body, _ = self.body_of(sql)
        starts = [s for s, _e in guards._declaration_spans(body)]
        self.assertEqual(
            len(starts), 1, "the identifier was counted as a second section"
        )
        # A label legitimately precedes one, though.
        labelled = "<<blk>> DECLARE raise integer := 1; BEGIN NULL; END blk;"
        self.assertTrue(
            guards._opens_declaration_section(labelled, labelled.index("DECLARE")),
            "`<<label>> DECLARE ... BEGIN ... END label;` is valid on 17.11 "
            "and its section must still be modelled",
        )

    # -- 10. the shared helpers themselves, so BOTH callers inherit them ---
    def test_shared_helpers_model_the_region_and_assignments(self) -> None:
        body = (
            "DECLARE\n"
            "  a integer := 1;\n"
            "  raise integer := 2;\n"
            "BEGIN\n"
            "  raise := 3;\n"
            "  RAISE EXCEPTION 'x';\n"
            "END;\n"
        )
        section_end = body.index("BEGIN")
        self.assertEqual(
            guards._declaration_spans(body),
            ((body.index("DECLARE") + len("DECLARE"), section_end),),
            "the declaration section does not end at its own BEGIN",
        )
        self.assertTrue(
            guards._in_declaration_section(body, body.index("raise integer"))
        )
        self.assertFalse(
            guards._in_declaration_section(body, body.index("raise := 3"))
        )
        self.assertTrue(
            guards._is_assignment_target(body, body.index("raise := 3"))
        )
        self.assertFalse(
            guards._is_assignment_target(body, body.index("RAISE EXCEPTION"))
        )
        # The one classifier both callers share.
        self.assertFalse(
            guards._is_statement_start(body, body.index("raise integer")),
            "a declaration identifier can still begin a statement",
        )
        self.assertFalse(
            guards._is_statement_start(body, body.index("raise := 3")),
            "an assignment target can still begin a statement",
        )
        self.assertTrue(
            guards._is_statement_start(body, body.index("RAISE EXCEPTION")),
            "the genuine RAISE after the section's BEGIN was lost",
        )

    # -- 11. earlier rounds, re-proven through the corrected path ---------
    def test_rounds_13_to_16_stay_closed(self) -> None:
        self.assertTrue(
            self.verdict(
                "r16_first_declaration",
                self.boolean_probe(
                    "    DECLARE\n      raise integer := 1;\n"
                    "    BEGIN\n      raise := 2;\n    END;\n"
                ),
            ),
            "Round 16's first declaration reopened",
        )
        self.assertTrue(
            self.verdict(
                "r15_end_loop_label",
                self.boolean_probe(
                    "    <<raise>>\n    WHILE false LOOP\n      NULL;\n"
                    "    END LOOP raise;\n"
                ),
            ),
            "Round 15's loop end label reopened",
        )
        self.assertTrue(
            self.verdict(
                "r14_shift",
                self.boolean_probe(
                    "    PERFORM (SELECT 8 >> raise "
                    "FROM public.raise_source LIMIT 1);\n"
                ),
            ),
            "Round 14's shift operand reopened",
        )
        self.assertTrue(
            self.verdict(
                "r13_as_raise",
                self.boolean_probe("    PERFORM (SELECT 1 AS raise);\n"),
            ),
            "Round 13's bare identifier reopened",
        )
        # The recognized boolean idiom, end to end, with a declaration section
        # above it. (Only the negated `IF NOT ... THEN RAISE` form counts as a
        # guard; the positive `IF ... THEN NULL; ELSE RAISE` shape is rejected
        # on this head and on fec61081 alike, so ELSE is exercised at the
        # helper level below rather than through check_file().)
        sql = (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\n"
            "DECLARE\n  raise integer := 1;\nBEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    RAISE EXCEPTION 'x';\n  END IF;\n"
            "\n  UPDATE public.bins SET actual_qty = 0 "
            "WHERE org_id = p_org;\nEND;\n$$;\n"
        )
        self.assertEqual(
            self.verdict("genuine_then", sql),
            [],
            "a genuine RAISE after THEN stopped being recognized",
        )
        # Every opener that admits a real RAISE, through the corrected path.
        for opener in ("THEN", "ELSE", "BEGIN", "LOOP", "NULL;"):
            fragment = f"{opener}\n  RAISE EXCEPTION 'x';\n"
            self.assertTrue(
                guards._is_statement_start(
                    fragment, fragment.index("RAISE EXCEPTION")
                ),
                f"a real RAISE after `{opener}` stopped opening a statement",
            )


class _Round18Base(unittest.TestCase):
    """Shared fixtures for Round 18.

    Every SQL string asserted on below was compiled on PostgreSQL 17.11 as a
    `SECURITY DEFINER` routine and then EXECUTED by a non-member role, against a
    `public.bins` row seeded at 55, with `public.wardah_is_org_member()` and
    `public.wardah_assert_org_member()` behaving exactly as this repository's
    helpers do. Every routine came back `prosecdef = true` and executable by the
    client role, so the verdicts asserted here are verdicts about live
    authorization behavior, not about text.
    """

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round18_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    @staticmethod
    def routine(body: str) -> str:
        """A SECURITY DEFINER routine whose body is exactly `body`."""
        return (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $body$\n"
            f"{body}"
            "END;\n"
            "$body$;\n"
        )

    def body_of(self, sql: str):
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        definition = guards.parse_definitions(sql, masked)[0]
        return (
            masked[definition.start: definition.body_span[1]],
            sql[definition.start: definition.body_span[1]],
        )

    PRIVILEGED_WRITE = (
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
    )


class Round18DeclareEvidenceTests(_Round18Base):
    """A raw `>>` or a raw `$` must not manufacture a DECLARE section.

    Round 17 checked the POSITION of a DECLARE token but accepted two single
    characters as structural proof, and PostgreSQL 17.11 accepts both of them in
    ordinary executable text:

      * `>>` is the integer right-shift operator, so `SELECT 8 >> declare INTO v
        FROM t` - with `declare` an ordinary column - opened a section, as did
        `8>>declare`, `8 >> /* c */ declare` and `SELECT a << b >> declare`;
      * `$` continues an unquoted identifier (scan.l ident_cont), so
        `col$declare` - one identifier - opened one too.

    The manufactured span runs to the next BEGIN, or to the end of the body when
    there is none, and every RAISE inside it stops counting.
    """

    # -- RED case A: a real outer abort hidden, a DEAD guard credited --------
    def test_right_shift_declare_does_not_hide_an_outer_abort(self) -> None:
        """Oracle: `SELECT 8 >> declare INTO v FROM public.t_decl` then
        `RAISE EXCEPTION 'NOT_IMPLEMENTED'` aborts for member and non-member
        alike (bins stayed 55), so the PERFORM after it is dead code that can
        never authorize anything. The scanner used to return []."""
        sql = self.routine(
            "DECLARE\n"
            "  v integer;\n"
            "BEGIN\n"
            "  SELECT 8 >> declare INTO v FROM public.t_decl LIMIT 1;\n"
            "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            + self.PRIVILEGED_WRITE
        )
        self.assertTrue(
            self.verdict("shift_hides_outer_abort", sql),
            "a right-shift operand named `declare` opened a declaration span "
            "that hid a real outer-level abort, and the dead guard after it "
            "was credited as an authorization boundary",
        )
        body, _ = self.body_of(sql)
        self.assertEqual(
            len(guards._declaration_spans(body)),
            1,
            "the shift operand was counted as a second declaration section",
        )

    # -- RED case B: a real deny hidden inside its own branch ---------------
    def test_right_shift_declare_does_not_hide_a_real_deny(self) -> None:
        """Oracle: this routine denies a non-member with
        TENANT_MEMBERSHIP_REQUIRED and leaves bins at 55, and a member reaches
        the write. It must be accepted; the manufactured span rejected it."""
        self.assertEqual(
            self.verdict(
                "shift_hides_real_deny",
                self.routine(
                    "DECLARE\n"
                    "  v integer;\n"
                    "BEGIN\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    SELECT 8 >> declare INTO v FROM public.t_decl LIMIT 1;\n"
                    "    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';\n"
                    "  END IF;\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            [],
            "a shift operand named `declare` swallowed the RAISE of the deny "
            "branch it sits in, so a real guard read as no boundary at all",
        )

    # -- RED case C: `col$declare` ------------------------------------------
    def test_identifier_containing_a_dollar_opens_no_section(self) -> None:
        """Oracle: `col$declare` is ONE identifier - `v := col$declare` runs on
        17.11 - and the routine aborts at NOT_IMPLEMENTED, so the PERFORM is
        dead. `_dollar_tag_at()` refuses the `$` because no tag closes."""
        sql = self.routine(
            "DECLARE\n"
            "  col$declare integer := 1;\n"
            "  v integer;\n"
            "BEGIN\n"
            "  v := col$declare;\n"
            "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            + self.PRIVILEGED_WRITE
        )
        self.assertTrue(
            self.verdict("col_dollar_declare", sql),
            "`col$declare` opened a declaration span from a bare `$`",
        )
        body, _ = self.body_of(sql)
        self.assertEqual(
            len(guards._declaration_spans(body)),
            1,
            "the identifier's `$` was read as a body-opening dollar quote",
        )

    # -- RED case D: `a << b >> declare` ------------------------------------
    def test_composed_shift_declare_opens_no_section(self) -> None:
        """Oracle: `SELECT a << b >> declare INTO v FROM t` runs on 17.11. The
        `<<` here follows an OPERAND, which is what separates it from a label."""
        sql = self.routine(
            "DECLARE\n"
            "  v integer;\n"
            "  a integer := 64;\n"
            "  b integer := 1;\n"
            "BEGIN\n"
            "  SELECT a << b >> declare INTO v FROM public.t_decl LIMIT 1;\n"
            "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n"
            + self.PRIVILEGED_WRITE
        )
        self.assertTrue(
            self.verdict("composed_shift_declare", sql),
            "`a << b >> declare` was read as `<<b>> DECLARE`",
        )
        body, _ = self.body_of(sql)
        self.assertEqual(
            len(guards._declaration_spans(body)),
            1,
            "the composed shift expression manufactured a section",
        )

    # -- the spellings 17.11 accepts around the operator -------------------
    def test_every_accepted_shift_spelling_opens_no_section(self) -> None:
        """`8 >> declare`, `8>>declare`, a comment between, and a newline plus
        tab between all run on 17.11 and none is a declaration section."""
        for name, operand in (
            ("spaced", "8 >> declare"),
            ("tight", "8>>declare"),
            ("commented", "8 >> /* c */ declare"),
            ("newline_tab", "8 >>\n\tdeclare"),
            ("composed", "a << b >> declare"),
        ):
            with self.subTest(name):
                sql = self.routine(
                    "DECLARE\n"
                    "  v integer;\n"
                    "  a integer := 64;\n"
                    "  b integer := 1;\n"
                    "BEGIN\n"
                    f"  SELECT {operand} INTO v FROM public.t_decl LIMIT 1;\n"
                    "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
                    "  PERFORM public.wardah_assert_org_member(p_org);\n"
                    + self.PRIVILEGED_WRITE
                )
                self.assertTrue(
                    self.verdict(f"shift_{name}", sql),
                    f"`{operand}` manufactured a declaration section",
                )

    # -- the structural cases that MUST keep their section -----------------
    def test_real_declaration_sections_are_still_modelled(self) -> None:
        """Every opener verified on 17.11: body start (`$$` and `$tag$`, with
        and without whitespace), `;`, BEGIN, THEN, ELSE, LOOP, and a complete
        `<<label>>`."""
        for name, prefix in (
            ("plain_body", "DECLARE\n  raise integer := 1;\nBEGIN\n"),
            ("label", "<<blk>>\nDECLARE\n  raise integer := 1;\nBEGIN\n"),
            ("label_tight", "<<blk>>DECLARE\n  raise integer := 1;\nBEGIN\n"),
            (
                "quoted_label",
                '<<"Blk">>\nDECLARE\n  raise integer := 1;\nBEGIN\n',
            ),
        ):
            with self.subTest(name):
                # The declaration is the only candidate RAISE; if its section
                # were lost the identifier would count as a denying statement
                # and this unguarded routine would be accepted.
                sql = self.routine(
                    f"{prefix}"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    raise := 2;\n"
                    "  END IF;\n"
                    + self.PRIVILEGED_WRITE
                )
                self.assertTrue(
                    self.verdict(f"section_{name}", sql),
                    f"the `{name}` declaration section stopped being modelled",
                )

    def test_tagged_and_untagged_body_openers_prove_a_section(self) -> None:
        """A body-opening DECLARE is preceded by the dollar quote that opens the
        body. `$$`, `$tag$`, and either with no whitespace before DECLARE, all
        run on 17.11 and all must keep their section."""
        for name, tag, gap in (
            ("dollar_dollar", "$$", "\n"),
            ("dollar_dollar_tight", "$$", ""),
            ("tagged", "$body$", "\n"),
            ("tagged_tight", "$body$", ""),
        ):
            with self.subTest(name):
                sql = (
                    "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
                    f"RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS {tag}"
                    f"{gap}DECLARE\n"
                    "  raise integer := 1;\n"
                    "BEGIN\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    raise := 2;\n"
                    "  END IF;\n"
                    + self.PRIVILEGED_WRITE
                    + f"END;\n{tag};\n"
                )
                self.assertTrue(
                    self.verdict(f"opener_{name}", sql),
                    f"the `{tag}` body opener stopped proving a section",
                )

    # -- the helpers, so BOTH consumers inherit one answer -----------------
    def test_declare_evidence_helpers_are_structural(self) -> None:
        opener = "$body$\nDECLARE x integer;\nBEGIN NULL; END\n"
        self.assertTrue(
            guards._opens_declaration_section(opener, opener.index("DECLARE")),
            "a `$body$` body opener no longer proves a section",
        )
        for text in (
            "$body$\nv := 8 >> declare;\n",
            "$body$\nv := col$declare;\n",
            "$body$\nv := a << b >> declare;\n",
            "$body$\nv := col$$declare;\n",
            "$body$\nv := x$abc$declare;\n",
        ):
            with self.subTest(text.strip()):
                self.assertFalse(
                    guards._opens_declaration_section(
                        text, text.index("declare")
                    ),
                    f"{text.strip()!r} manufactured a declaration section",
                )
        labelled = "$body$\n<<blk>> DECLARE raise integer := 1; BEGIN NULL; END blk;"
        self.assertTrue(
            guards._opens_declaration_section(
                labelled, labelled.index("DECLARE")
            ),
            "`<<label>> DECLARE` lost its section",
        )
        self.assertEqual(
            guards._labelled_declare_offsets(labelled),
            frozenset({labelled.index("DECLARE")}),
            "the labelled DECLARE was not recognized forward from its `<<`",
        )
        shift = "$body$\nv := a << b >> declare;\n"
        self.assertEqual(
            guards._labelled_declare_offsets(shift),
            frozenset(),
            "a right-shift expression was recorded as a labelled DECLARE",
        )
        # The dollar-tag boundary is `_dollar_tag_at()`'s, not a second rule.
        tagged = "$body$\nDECLARE x integer;\n"
        self.assertTrue(
            guards._ends_dollar_body_opener(tagged, tagged.index("$\n"))
        )
        ident = "v := col$declare;"
        self.assertFalse(
            guards._ends_dollar_body_opener(ident, ident.index("$"))
        )


class Round18AssignmentTargetTests(_Round18Base):
    """A qualified or subscripted target beginning with `raise` is not a RAISE.

    Round 17 stopped after the first identifier word, so `raise.actual_qty := 2`
    and `raise[1] := 2` were counted as aborting RAISE statements. Both forms
    were compiled and run on 17.11: each assigns, each reads its value back, and
    NEITHER aborts - so a deny branch holding only one of them denies nothing,
    and the oracle shows a non-member driving the privileged UPDATE
    (bins.actual_qty 55 -> 0) while check_file() returned [].
    """

    # -- RED case E: `raise.actual_qty := 2` -------------------------------
    def test_qualified_target_is_not_raise_evidence(self) -> None:
        sql = self.routine(
            "DECLARE\n"
            "  raise public.bins;\n"
            "BEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    raise.actual_qty := 2;\n"
            "  END IF;\n"
            + self.PRIVILEGED_WRITE
        )
        self.assertTrue(
            self.verdict("qualified_target", sql),
            "`raise.actual_qty := 2` counted as a denying RAISE; the oracle "
            "shows a non-member reached the privileged UPDATE (55 -> 0)",
        )
        body, raw_body = self.body_of(sql)
        for frame in guards.parse_blocks(body, raw_body):
            if frame.kind == "IF":
                self.assertIsNone(
                    frame.raise_pos,
                    "the IF frame still records an assignment target as its "
                    "raise_pos",
                )

    # -- RED case F: `raise[1] := 2` ---------------------------------------
    def test_subscript_target_is_not_raise_evidence(self) -> None:
        sql = self.routine(
            "DECLARE\n"
            "  raise integer[];\n"
            "BEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    raise[1] := 2;\n"
            "  END IF;\n"
            + self.PRIVILEGED_WRITE
        )
        self.assertTrue(
            self.verdict("subscript_target", sql),
            "`raise[1] := 2` counted as a denying RAISE; the oracle shows a "
            "non-member reached the privileged UPDATE (55 -> 0)",
        )
        body, raw_body = self.body_of(sql)
        for frame in guards.parse_blocks(body, raw_body):
            if frame.kind == "IF":
                self.assertIsNone(frame.raise_pos)

    # -- every target form the oracle accepted -----------------------------
    def test_every_accepted_target_form_is_an_assignment(self) -> None:
        """Each of these was compiled, executed and read back on 17.11 with
        `raise` as the variable name, and none of them aborts."""
        for target in (
            "raise := 2",
            "raise = 2",
            "raise.actual_qty := 2",
            "raise.actual_qty = 2",
            "raise /* c */ . /* c */ actual_qty := 2",
            'raise."Odd Field" := 2',
            "raise[1] := 2",
            "raise[1] = 2",
            "raise [1] := 2",
            "raise[1][2] := 2",
            "raise[1:2] := ARRAY[7,7]",
            "raise[idx[1]] := 2",
            "raise[1].actual_qty := 2",
            "raise.arr[1] := 2",
            "raise.a.b.c := 2",
            "raise[1].a[1].subfield := 2",
            'raise[1]."Odd Field" := 2',
        ):
            with self.subTest(target):
                masked, problems = guards.mask_sql_checked(f"{target};\n")
                self.assertEqual(problems, [])
                self.assertTrue(
                    guards._is_assignment_target(masked, 0),
                    f"`{target}` was not recognized as an assignment target",
                )
                # Through the shared classifier, on MASKED text - which is what
                # both consumers pass, and what turns a comment into whitespace.
                masked, problems = guards.mask_sql_checked(
                    f"BEGIN\n{target};\n"
                )
                self.assertEqual(problems, [])
                self.assertFalse(
                    guards._is_statement_start(masked, 6),
                    f"`{target}` still opens a statement after BEGIN",
                )

    # -- and no real RAISE may be swallowed by the selector consumer -------
    def test_no_real_raise_reads_as_an_assignment_target(self) -> None:
        """A RAISE statement continues with a level, a format literal, a
        condition name, SQLSTATE, USING, or the `;` of a bare re-raise. None of
        those begins with `.` or `[`, and none is an assignment operator."""
        for statement in (
            "RAISE EXCEPTION 'x'",
            "RAISE EXCEPTION 'a = b'",
            "RAISE EXCEPTION 'x' USING ERRCODE = 'P0001'",
            "RAISE WARNING 'x'",
            "RAISE SQLSTATE 'P0001'",
            "RAISE unique_violation",
            "RAISE NOTICE '%', arr[1]",
            "RAISE",
        ):
            with self.subTest(statement):
                masked, problems = guards.mask_sql_checked(f"{statement};\n")
                self.assertEqual(problems, [])
                self.assertFalse(
                    guards._is_assignment_target(masked, 0),
                    f"`{statement}` read as an assignment target",
                )
                fragment = f"BEGIN\n{statement};\n"
                masked, problems = guards.mask_sql_checked(fragment)
                self.assertEqual(problems, [])
                self.assertTrue(
                    guards._is_statement_start(masked, 6),
                    f"`{statement}` stopped opening a statement",
                )

    # -- the selector consumer refuses to run away -------------------------
    def test_selector_consumer_is_bounded(self) -> None:
        """An incomplete selector consumes nothing: a `[` with no `]`, a `[`
        that reaches the statement's `;` first, and a `.` with no identifier
        after it all leave the position where it was."""
        for text in ("raise[1 := 2", "raise[1; x := 2", "raise. := 2"):
            with self.subTest(text):
                self.assertFalse(
                    guards._is_assignment_target(text, 0),
                    f"`{text}` was consumed as a complete target",
                )
        self.assertEqual(
            guards._skip_subscript("raise[idx[1]] := 2", 5),
            13,
            "nested subscript brackets are not balanced",
        )
        self.assertIsNone(
            guards._skip_subscript("raise[1; x := 2", 5),
            "a subscript scan crossed the statement terminator",
        )


class Round18ComposedMutantTests(_Round18Base):
    """Fresh composed mutants crossing both Round-17 P2 families.

    Each was compiled on PostgreSQL 17.11 as a `SECURITY DEFINER` routine
    (`prosecdef = true`, executable by the client role) and then run by a
    non-member AND by a member against a `public.bins` row seeded at 55. The
    expected verdict below is the one that matches the observed live behavior.
    """

    def test_dollar_identifier_with_a_trailing_nested_block(self) -> None:
        """M1. Oracle: denies a non-member (bins stayed 55). The trailing
        `BEGIN` used to terminate the span `col$declare` manufactured, so the
        real deny fell inside it and the guard vanished."""
        self.assertEqual(
            self.verdict(
                "m1_dollar_ident_nested_block",
                self.routine(
                    "DECLARE\n"
                    "  col$declare integer := 1;\n"
                    "  v integer;\n"
                    "BEGIN\n"
                    "  v := col$declare;\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';\n"
                    "  END IF;\n"
                    + self.PRIVILEGED_WRITE
                    + "  BEGIN\n    NULL;\n  END;\n"
                ),
            ),
            [],
            "`col$declare` plus a trailing nested BEGIN hid a real deny",
        )

    def test_labelled_declare_holding_a_qualified_target(self) -> None:
        """M2. Oracle: denies a non-member at the outer PERFORM (bins stayed
        55); a member reaches the write. The labelled DECLARE must keep its
        section AND the qualified target inside it must not abort."""
        self.assertEqual(
            self.verdict(
                "m2_labelled_declare_qualified_target",
                self.routine(
                    "DECLARE\n"
                    "  v integer;\n"
                    "BEGIN\n"
                    "  <<blk>>\n"
                    "  DECLARE\n"
                    "    raise public.bins;\n"
                    "  BEGIN\n"
                    "    raise.actual_qty := 2;\n"
                    "    v := 1;\n"
                    "  END blk;\n"
                    "\n"
                    "  PERFORM public.wardah_assert_org_member(p_org);\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            [],
            "a labelled DECLARE section plus a qualified assignment target "
            "rejected a guard the oracle proves denies a non-member",
        )

    def test_subscript_target_then_a_real_assertion(self) -> None:
        """M3. Oracle: `raise[1] := 2` aborts nothing, then the assertion denies
        a non-member (bins stayed 55) and a member reaches the write."""
        self.assertEqual(
            self.verdict(
                "m3_subscript_then_assertion",
                self.routine(
                    "DECLARE\n"
                    "  raise integer[];\n"
                    "BEGIN\n"
                    "  raise[1] := 2;\n"
                    "  PERFORM public.wardah_assert_org_member(p_org);\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            [],
            "a subscripted assignment target counted as an earlier abort and "
            "made a real assertion look unreachable",
        )

    def test_end_loop_label_with_a_qualified_target(self) -> None:
        """M4. Round 15's end label and Round 18's qualified target together.
        Oracle: the assertion denies a non-member (bins stayed 55)."""
        self.assertEqual(
            self.verdict(
                "m4_end_loop_label_qualified_target",
                self.routine(
                    "DECLARE\n"
                    "  raise public.bins;\n"
                    "BEGIN\n"
                    "  <<raise>>\n"
                    "  WHILE false LOOP\n"
                    "    raise.actual_qty := 2;\n"
                    "  END LOOP raise;\n"
                    "\n"
                    "  PERFORM public.wardah_assert_org_member(p_org);\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            [],
            "an end label named raise plus a qualified target rejected a real "
            "assertion",
        )

    def test_non_catching_handler_with_a_qualified_target(self) -> None:
        """M5. Oracle: `WHEN unique_violation` does not catch the assertion's
        P0001, so a non-member is denied (bins stayed 55) and a member writes."""
        self.assertEqual(
            self.verdict(
                "m5_noncatching_handler_qualified_target",
                self.routine(
                    "DECLARE\n"
                    "  raise public.bins;\n"
                    "BEGIN\n"
                    "  raise.actual_qty := 2;\n"
                    "  PERFORM public.wardah_assert_org_member(p_org);\n"
                    + self.PRIVILEGED_WRITE
                    + "EXCEPTION WHEN unique_violation THEN\n  RAISE;\n"
                ),
            ),
            [],
            "a qualified assignment target under a non-catching handler "
            "rejected a real assertion",
        )

    def test_declaration_region_with_a_right_shift_raise(self) -> None:
        """M6. Round 14's `8 >> raise` inside a routine that also has a real
        declaration region. Oracle: denies a non-member (bins stayed 55)."""
        self.assertEqual(
            self.verdict(
                "m6_declare_region_shift_raise",
                self.routine(
                    "DECLARE\n"
                    "  declare_ok integer := 1;\n"
                    "  v integer;\n"
                    "BEGIN\n"
                    "  SELECT 8 >> raise INTO v FROM public.raise_source "
                    "LIMIT 1;\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';\n"
                    "  END IF;\n"
                    "  UPDATE public.bins SET actual_qty = declare_ok - 1 "
                    "WHERE org_id = p_org;\n"
                ),
            ),
            [],
            "Round 14's shift operand reopened inside a declaration region",
        )

    def test_composed_shift_in_a_deny_branch_with_a_later_target(self) -> None:
        """M7. Oracle: denies a non-member (bins stayed 55); a member writes."""
        self.assertEqual(
            self.verdict(
                "m7_composed_shift_deny_later_target",
                self.routine(
                    "DECLARE\n"
                    "  raise public.bins;\n"
                    "  v integer;\n"
                    "  a integer := 64;\n"
                    "  b integer := 1;\n"
                    "BEGIN\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    SELECT a << b >> declare INTO v FROM public.t_decl "
                    "LIMIT 1;\n"
                    "    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';\n"
                    "  END IF;\n"
                    "  raise.actual_qty := 2;\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            [],
            "`a << b >> declare` in a deny branch hid the branch's own RAISE",
        )

    def test_others_handler_with_an_assign_only_deny_branch(self) -> None:
        """M8. Oracle: NOTHING aborts - a non-member drove bins 55 -> 0 - so
        this routine must be reported however the handler is written."""
        self.assertTrue(
            self.verdict(
                "m8_others_handler_assign_only_deny",
                self.routine(
                    "DECLARE\n"
                    "  raise public.bins;\n"
                    "BEGIN\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    raise.actual_qty := 2;\n"
                    "  END IF;\n"
                    + self.PRIVILEGED_WRITE
                    + "EXCEPTION WHEN OTHERS THEN\n  RAISE;\n"
                ),
            ),
            "a deny branch that only assigns to a qualified target was "
            "accepted as an authorization boundary",
        )

    def test_both_families_in_one_routine(self) -> None:
        """M9. Both defects bite at once: the qualified target used to be an
        outer abort AND the composed shift used to hide the real deny. Oracle:
        denies a non-member (bins stayed 55); a member writes."""
        self.assertEqual(
            self.verdict(
                "m9_both_families",
                self.routine(
                    "DECLARE\n"
                    "  raise public.bins;\n"
                    "  v integer;\n"
                    "  a integer := 64;\n"
                    "  b integer := 1;\n"
                    "BEGIN\n"
                    "  raise.actual_qty := 2;\n"
                    "  SELECT a << b >> declare INTO v FROM public.t_decl "
                    "LIMIT 1;\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';\n"
                    "  END IF;\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            [],
            "a qualified target and a composed shift together rejected a "
            "guard the oracle proves denies a non-member",
        )


class Round18RegressionBatteryTests(_Round18Base):
    """Rounds 13-17, re-proven through the corrected classifiers."""

    def test_every_real_raise_opener_still_opens_a_statement(self) -> None:
        for opener in ("THEN", "ELSE", "BEGIN", "LOOP", "NULL;"):
            for raise_form in (
                "RAISE EXCEPTION 'x'",
                "RAISE SQLSTATE 'P0001'",
                "RAISE EXCEPTION 'x' USING ERRCODE = 'P0001'",
            ):
                with self.subTest(opener=opener, raise_form=raise_form):
                    fragment = f"{opener}\n  {raise_form};\n"
                    masked, problems = guards.mask_sql_checked(fragment)
                    self.assertEqual(problems, [])
                    self.assertTrue(
                        guards._is_statement_start(
                            masked, masked.index("RAISE")
                        ),
                        f"a real `{raise_form}` after `{opener}` stopped "
                        f"opening a statement",
                    )

    def test_declare_then_begin_raise_still_denies(self) -> None:
        self.assertEqual(
            self.verdict(
                "declare_then_begin_raise",
                self.routine(
                    "DECLARE\n"
                    "  raise integer := 1;\n"
                    "BEGIN\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';\n"
                    "  END IF;\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            [],
            "a genuine RAISE after a declaration section's BEGIN was lost",
        )

    def test_bare_re_raise_in_a_handler_is_still_a_statement(self) -> None:
        fragment = "EXCEPTION WHEN OTHERS THEN\n  RAISE;\n"
        masked, problems = guards.mask_sql_checked(fragment)
        self.assertEqual(problems, [])
        self.assertTrue(
            guards._is_statement_start(masked, masked.index("RAISE;")),
            "a bare re-RAISE in a handler stopped opening a statement",
        )

    def test_round_17_declaration_spellings_stay_inert(self) -> None:
        """Every declaration spelling of a variable named `raise` that 17.11
        accepts. None of them denies anything, so each unguarded routine must
        still be reported."""
        for name, declarations in (
            ("first", "  raise integer := 1;\n"),
            ("second", "  x integer := 1;\n  raise integer := 2;\n"),
            (
                "third",
                "  x integer := 1;\n  y integer := 2;\n"
                "  raise integer := 3;\n",
            ),
            ("uninitialized", "  raise integer;\n"),
            ("constant", "  raise CONSTANT integer := 1;\n"),
            ("custom_type", "  raise public.bins;\n"),
            ("alias_for", "  raise ALIAS FOR p_org;\n"),
            ("pct_type", "  raise public.bins.actual_qty%TYPE;\n"),
            ("pct_rowtype", "  raise public.bins%ROWTYPE;\n"),
        ):
            with self.subTest(name):
                self.assertTrue(
                    self.verdict(
                        f"r17_declaration_{name}",
                        self.routine(
                            "DECLARE\n"
                            f"{declarations}"
                            "BEGIN\n"
                            "  IF NOT public.wardah_is_org_member(p_org) "
                            "THEN\n"
                            "    NULL;\n"
                            "  END IF;\n"
                            + self.PRIVILEGED_WRITE
                        ),
                    ),
                    f"the `{name}` declaration of `raise` was treated as a "
                    f"denying statement",
                )

    def test_round_13_to_15_identifier_forms_stay_inert(self) -> None:
        for name, deny_body in (
            ("r15_end_loop_label",
             "    <<raise>>\n    WHILE false LOOP\n      NULL;\n"
             "    END LOOP raise;\n"),
            ("r14_shift_spaced",
             "    PERFORM (SELECT 8 >> raise FROM public.raise_source "
             "LIMIT 1);\n"),
            ("r14_shift_tight",
             "    PERFORM (SELECT 8>>raise FROM public.raise_source "
             "LIMIT 1);\n"),
            ("r14_shift_commented",
             "    PERFORM (SELECT 8 >> /* c */ raise FROM "
             "public.raise_source LIMIT 1);\n"),
            ("r14_column_named_raise",
             "    PERFORM (SELECT raise FROM public.raise_source LIMIT 1);\n"),
            ("r13_as_raise", "    PERFORM (SELECT 1 AS raise);\n"),
            ("r17_assign_colon_equals",
             "    raise := 2;\n"),
            ("r17_assign_bare_equals",
             "    raise = 2;\n"),
        ):
            with self.subTest(name):
                self.assertTrue(
                    self.verdict(
                        name,
                        self.routine(
                            "DECLARE\n"
                            "  raise integer := 1;\n"
                            "BEGIN\n"
                            "  IF NOT public.wardah_is_org_member(p_org) "
                            "THEN\n"
                            f"{deny_body}"
                            "  END IF;\n"
                            + self.PRIVILEGED_WRITE
                        ),
                    ),
                    f"`{name}` reopened as a denying RAISE",
                )

    def test_return_and_labelled_exit_reachability_still_hold(self) -> None:
        self.assertTrue(
            self.verdict(
                "return_before_guard",
                self.routine(
                    "DECLARE\n"
                    "  raise public.bins;\n"
                    "BEGIN\n"
                    "  raise.actual_qty := 2;\n"
                    "  RETURN;\n"
                    "  PERFORM public.wardah_assert_org_member(p_org);\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            "a guard after an unconditional RETURN was treated as reachable",
        )
        self.assertTrue(
            self.verdict(
                "labelled_exit_past_guard",
                self.routine(
                    "DECLARE\n"
                    "  raise integer[];\n"
                    "BEGIN\n"
                    "  <<outer>>\n"
                    "  BEGIN\n"
                    "    IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "      raise[1] := 2;\n"
                    "      EXIT outer;\n"
                    "    END IF;\n"
                    "  END outer;\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            "a labelled EXIT past a deny branch was accepted",
        )

    def test_p0001_swallowing_still_rejects_a_guard(self) -> None:
        for handler in (
            "WHEN OTHERS",
            "WHEN raise_exception",
            "WHEN plpgsql_error",
            "WHEN SQLSTATE 'P0001'",
            "WHEN SQLSTATE 'P0000'",
        ):
            with self.subTest(handler):
                self.assertTrue(
                    self.verdict(
                        f"swallow_{abs(hash(handler))}",
                        self.routine(
                            "DECLARE\n"
                            "  raise public.bins;\n"
                            "BEGIN\n"
                            "  raise.actual_qty := 2;\n"
                            "  PERFORM public.wardah_assert_org_member("
                            "p_org);\n"
                            + self.PRIVILEGED_WRITE
                            + f"EXCEPTION {handler} THEN\n  NULL;\n"
                        ),
                    ),
                    f"`{handler}` stopped swallowing the assertion's P0001",
                )

    def test_standalone_perform_assertion_is_still_accepted(self) -> None:
        self.assertEqual(
            self.verdict(
                "standalone_perform",
                self.routine(
                    "BEGIN\n"
                    "  PERFORM public.wardah_assert_org_member(p_org);\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            [],
            "the plain standalone PERFORM assertion stopped being accepted",
        )

    def test_numbered_migrations_122_to_191_stay_clean(self) -> None:
        """The whole reviewed corpus, through the corrected classifiers."""
        root = pathlib.Path(__file__).resolve().parents[2] / "sql" / "migrations"
        files = sorted(
            p for p in root.glob("*.sql")
            if p.name[:3].isdigit() and 122 <= int(p.name[:3]) <= 191
        )
        self.assertEqual(len(files), 61, "the reviewed sweep changed size")
        findings = {p.name: guards.check_file(p) for p in files}
        self.assertEqual(
            {name: out for name, out in findings.items() if out},
            {},
            "the 122-191 sweep stopped being clean",
        )


# ---------------------------------------------------------------------------
# Round 19
# ---------------------------------------------------------------------------
# Two classes of false green survived Round 18, both confirmed by independent
# review and both reproduced here against PostgreSQL 17.11 before being closed.
#
# P1 - IDENTIFIER ALPHABET DRIFT. _is_assignment_target() and _previous_word()
#   each walked a word with `str.isalnum() or "_"`, which is NOT PostgreSQL's
#   ident_cont. scan.l accepts `$` and EVERY high-bit byte, so on 17.11
#   `raise$x`, `raise$`, `raisé` and `raise\U0001F600` are each ONE
#   identifier - and `str.isalnum()`, a Unicode CATEGORY test, excludes
#   combining marks, format characters, punctuation and emoji outright. The
#   consequences ran in both directions: an ordinary assignment `raise$x := 2`
#   was read as a RAISE statement and manufactured a deny boundary, and the
#   suffix of `col$then` was read as the keyword THEN, so the column's alias
#   `raise` opened a statement it never opens.
#
# P2 - SQL-EXPRESSION THEN / ELSE / LOOP AS DECLARE EVIDENCE.
#   _opens_block_position() delegated to the statement-position classifier,
#   whose opener set contains `then`, `else`, `begin` and `loop`. All four also
#   occur inside ordinary SQL - THEN and ELSE as CASE keywords, `begin` and
#   `loop` as unreserved column names - so `SELECT CASE WHEN true THEN declare
#   ELSE 0 END INTO v FROM t` manufactured a declaration section whose span
#   swallowed a later real `RAISE EXCEPTION`, and the dead guard after that
#   abort was credited as the routine's authorization boundary.
#
# Every SQL string below was compiled on PostgreSQL 17.11 as a SECURITY DEFINER
# routine and EXECUTED by a non-member role against a `public.bins` row seeded
# at 55. Every one came back `prosecdef = true` and executable by the client
# role, so each assertion is about live authorization behaviour.


class _Round19Base(_Round18Base):
    """Round 18's fixtures and routine shape, under a Round 19 file name."""

    # PostgreSQL ident_cont accepts every non-ASCII code point. These four are
    # ones str.isalnum() rejects, one per Unicode category that used to escape:
    # Mn (combining mark), Po (punctuation), Cf (format) and So (symbol).
    NON_ASCII_CONT = ("́", "·", "​", "\U0001F600")

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round19_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)


class Round19IdentifierAlphabetTests(_Round19Base):
    """One PostgreSQL unquoted-identifier alphabet, in every walk."""

    def test_the_file_spells_the_alphabet_once(self) -> None:
        """PARSER-INTERNAL. `_IDENT_CONT_RE` is DERIVED from `_IDENT_CONT`, so
        the dollar-tag reader and the statement model cannot drift apart again,
        and neither walk carries its own narrower class."""
        self.assertEqual(
            guards._IDENT_CONT_RE.pattern, f"[{guards._IDENT_CONT}]"
        )
        self.assertEqual(
            guards._UNQUOTED_IDENT_RE.pattern,
            f"[{guards._IDENT_START}][{guards._IDENT_CONT}]*",
        )
        for ch in ("$", *self.NON_ASCII_CONT):
            self.assertTrue(
                guards._IDENT_CONT_RE.match(ch),
                f"{ch!r} continues an identifier on 17.11 but not here",
            )
            if ch != "$":
                self.assertFalse(
                    ch.isalnum(),
                    f"{ch!r} no longer distinguishes ident_cont from isalnum()",
                )

    def test_dollar_continues_an_assignment_target(self) -> None:
        """Oracle: each of these declares ONE integer variable and assigns to
        it. The routine raises nothing, the non-member reaches the privileged
        UPDATE and bins.actual_qty goes 55 -> 0, so the IF branch denies
        nothing. check_file() used to return []."""
        for name, target in (
            ("dollar_suffix", "raise$x"),
            ("dollar_tail", "raise$"),
            ("double_dollar", "raise$$x"),
        ):
            for op in (":=", "="):
                with self.subTest(target=target, op=op):
                    self.assertTrue(
                        self.verdict(
                            f"{name}_{'walrus' if op == ':=' else 'eq'}",
                            self.routine(
                                f"DECLARE\n  {target} integer;\n"
                                "BEGIN\n"
                                "  IF NOT public.wardah_is_org_member(p_org)"
                                " THEN\n"
                                f"    {target} {op} 2;\n"
                                "  END IF;\n" + self.PRIVILEGED_WRITE
                            ),
                        ),
                        f"`{target} {op} 2` - an ordinary assignment on 17.11 -"
                        " still counts as a RAISE statement",
                    )

    def test_non_ascii_continues_an_assignment_target(self) -> None:
        """Oracle: `raise` plus any non-ASCII code point is ONE identifier that
        17.11 declares and assigns to; the non-member reached the UPDATE in
        every case. str.isalnum() said otherwise for all four."""
        for i, ch in enumerate(self.NON_ASCII_CONT):
            with self.subTest(codepoint=f"U+{ord(ch):04X}"):
                target = "raise" + ch
                self.assertTrue(
                    self.verdict(
                        f"non_ascii_target_{i}",
                        self.routine(
                            f"DECLARE\n  {target} integer;\n"
                            "BEGIN\n"
                            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                            f"    {target} := 2;\n"
                            "  END IF;\n" + self.PRIVILEGED_WRITE
                        ),
                    ),
                    f"U+{ord(ch):04X} stopped continuing an identifier",
                )

    def test_keyword_shaped_suffix_is_not_the_previous_word(self) -> None:
        """Oracle: `col$then` and `coĺthen` are single columns on 17.11, so
        `SELECT col$then raise INTO v FROM t` selects one under the alias
        `raise` and raises nothing - the non-member reached the UPDATE. Walking
        back over `isalnum() + "_"` stopped at the `$` and read `then`, which
        opens a statement, so the alias manufactured a deny boundary."""
        for i, column in enumerate(("col$then", "coĺthen")):
            with self.subTest(column=column):
                self.assertTrue(
                    self.verdict(
                        f"suffix_previous_word_{i}",
                        self.routine(
                            "DECLARE\n  v integer;\n"
                            "BEGIN\n"
                            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                            f"    SELECT {column} raise INTO v"
                            " FROM public.t_decl LIMIT 1;\n"
                            "  END IF;\n" + self.PRIVILEGED_WRITE
                        ),
                    ),
                    f"the `then` inside `{column}` still opened a statement",
                )

    def test_previous_word_refuses_a_position_inside_a_token(self) -> None:
        """PARSER-INTERNAL. `col$then$raise` is ONE identifier on 17.11, and
        `\\bRAISE\\b` still matches its tail because `$` is not a `\\w`
        character. No word precedes a position that is INSIDE a token, so none
        is reported - and the plain spellings keep theirs."""
        for text, expected in (
            ("col$then$raise", ""),
            ("col$then raise", "col$then"),
            ("IF x THEN raise", "then"),
            ("END LOOP raise", "loop"),
            ("stmt; raise", ""),
        ):
            with self.subTest(text=text):
                self.assertEqual(
                    guards._previous_word(text, text.rindex("raise"))[0],
                    expected,
                )

    def test_ordinary_target_leaves_a_later_guard_reachable(self) -> None:
        """FALSE-RED direction, the other shared consumer. Oracle: each routine
        denies a non-member with TENANT_MEMBERSHIP_REQUIRED and bins stays 55,
        so the standalone PERFORM really is the boundary and must not be
        written off as unreachable behind a manufactured earlier abort."""
        for name, decl, stmt in (
            ("dollar", "raise$x integer;", "raise$x := 2;"),
            ("non_ascii", "raisé integer;", "raisé := 2;"),
            (
                "suffix_alias",
                "v integer;",
                "SELECT col$then raise INTO v FROM public.t_decl LIMIT 1;",
            ),
        ):
            with self.subTest(case=name):
                self.assertEqual(
                    self.verdict(
                        f"reachable_{name}",
                        self.routine(
                            f"DECLARE\n  {decl}\n"
                            "BEGIN\n"
                            f"  {stmt}\n"
                            "  PERFORM public.wardah_assert_org_member(p_org);\n"
                            + self.PRIVILEGED_WRITE
                        ),
                    ),
                    [],
                    "an ordinary identifier made a real guard look unreachable",
                )


class Round19DeclareBlockEvidenceTests(_Round19Base):
    """A DECLARE section needs a block position, not a keyword-shaped word."""

    FAKE_EVIDENCE = (
        (
            "case_then",
            "SELECT CASE WHEN true THEN declare ELSE 0 END"
            " INTO v_x FROM public.t_decl LIMIT 1;",
        ),
        (
            "case_else",
            "SELECT CASE WHEN false THEN 0 ELSE declare END"
            " INTO v_x FROM public.t_decl LIMIT 1;",
        ),
        ("loop_ident", "SELECT loop declare INTO v_x FROM public.t_decl LIMIT 1;"),
        (
            "loop_label",
            "SELECT loop << b >> declare INTO v_x FROM public.t_decl LIMIT 1;",
        ),
        ("begin_ident", "SELECT begin declare INTO v_x FROM public.t_decl LIMIT 1;"),
    )

    def test_sql_expression_declare_does_not_hide_an_outer_abort(self) -> None:
        """FALSE-GREEN direction. Oracle: every one of these compiles, and the
        call aborts at NOT_IMPLEMENTED for member and non-member alike (bins
        stayed 55), so the PERFORM after it is dead code that can never
        authorize anything. check_file() used to return []."""
        for name, stmt in self.FAKE_EVIDENCE:
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(
                        f"fake_declare_{name}",
                        self.routine(
                            "DECLARE\n  v_x integer;\n  b integer := 1;\n"
                            "BEGIN\n"
                            f"  {stmt}\n"
                            "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
                            "  PERFORM public.wardah_assert_org_member(p_org);\n"
                            + self.PRIVILEGED_WRITE
                        ),
                    ),
                    f"`{name}` manufactured a declaration section that hid a"
                    " real outer-level abort, and the dead guard after it was"
                    " credited as an authorization boundary",
                )
                body, _ = self.body_of(
                    self.routine(
                        "DECLARE\n  v_x integer;\n  b integer := 1;\n"
                        "BEGIN\n"
                        f"  {stmt}\n" + self.PRIVILEGED_WRITE
                    )
                )
                self.assertEqual(
                    len(guards._declaration_spans(body)),
                    1,
                    f"`{name}` still opened a second declaration section",
                )

    # Which of the five the scanner can still see a real deny THROUGH. Every
    # one of the five routines below really denies a non-member on 17.11
    # (TENANT_MEMBERSHIP_REQUIRED, bins left at 55), so `True` is the correct
    # verdict and `False` records a FAIL-CLOSED residue.
    #
    # Round 19 recorded three of the five as a FAIL-CLOSED residue:
    # `_control_frames()` pushed a frame for the TOKEN `loop` or `begin`, so the
    # bare column name left that frame on the stack and the RAISE that followed
    # no longer saw the IF as `stack[-1]`. Round 19 named what closing it would
    # take - "the loop-header and SQL-expression reading Scanner v1 deliberately
    # does not do" - and declined to guess.
    #
    # Round 21 built exactly that reading, because the SAME missing proof was
    # the Codex A1 acceptance bypass in the other direction: a frame pushed from
    # a bare SQL `begin` took the EXCEPTION section away from the real block and
    # a swallowed assertion read as live. `_owns_control_frame()` now proves the
    # opener before pushing, so no frame is manufactured here either, and the
    # residue closes as a consequence rather than by a special case.
    #
    # The verdicts below are therefore now all `True`, which is the verdict this
    # table always named as the correct one. Re-proved on PostgreSQL 17.11 at
    # Round 21: each of the three raises TENANT_MEMBERSHIP_REQUIRED for a
    # non-member and leaves bins.actual_qty at 55, so the IF really is the
    # authorization boundary the scanner now sees. The FALSE-GREEN direction is
    # unchanged and still asserted above: all five must still be REJECTED when
    # the same statement is used to hide an outer-level abort.
    DENY_VISIBLE_THROUGH = {
        "case_then": True,
        "case_else": True,
        "loop_ident": True,
        "loop_label": True,
        "begin_ident": True,
    }

    def test_sql_expression_declare_does_not_hide_a_real_deny(self) -> None:
        """FALSE-RED direction. Oracle: each routine denies a non-member with
        TENANT_MEMBERSHIP_REQUIRED and leaves bins at 55, so the IF really is
        an authorization boundary. The CASE arms now read as one; see
        DENY_VISIBLE_THROUGH for the three that stay fail-closed and why."""
        for name, stmt in self.FAKE_EVIDENCE:
            with self.subTest(case=name):
                findings = self.verdict(
                    f"fake_declare_deny_{name}",
                    self.routine(
                        "DECLARE\n  v_x integer;\n  b integer := 1;\n"
                        "BEGIN\n"
                        "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                        f"    {stmt}\n"
                        "    RAISE EXCEPTION"
                        " 'TENANT_MEMBERSHIP_REQUIRED';\n"
                        "  END IF;\n" + self.PRIVILEGED_WRITE
                    ),
                )
                self.assertEqual(
                    findings == [],
                    self.DENY_VISIBLE_THROUGH[name],
                    f"`{name}` changed which side of the fail-closed boundary"
                    " it falls on",
                )

    def test_a_stolen_end_loop_does_not_prove_a_loop(self) -> None:
        """Frame closure alone is not proof. Oracle:
        `LOOP SELECT loop declare INTO v FROM t; EXIT; END LOOP;` runs on 17.11,
        and the identifier's frame is pushed INSIDE the real loop, so it steals
        the END LOOP that pops the innermost frame and comes back closed. The
        routine still aborts at NOT_IMPLEMENTED, so the PERFORM is dead."""
        self.assertTrue(
            self.verdict(
                "stolen_end_loop",
                self.routine(
                    "DECLARE\n  v_x integer;\n"
                    "BEGIN\n"
                    "  LOOP SELECT loop declare INTO v_x"
                    " FROM public.t_decl LIMIT 1; EXIT; END LOOP;\n"
                    "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
                    "  PERFORM public.wardah_assert_org_member(p_org);\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            "a stolen END LOOP still proved the identifier `loop` opened one",
        )

    def test_a_subquery_loop_column_does_not_prove_the_header(self) -> None:
        """A real WHILE header whose condition selects a column named `loop`.
        Oracle: this runs, aborts at NOT_IMPLEMENTED, and the PERFORM is dead.
        The header's LOOP keyword must be the one the frame belongs to."""
        self.assertTrue(
            self.verdict(
                "subquery_loop_column",
                self.routine(
                    "DECLARE\n  v_x integer;\n"
                    "BEGIN\n"
                    "  WHILE (SELECT loop FROM public.t_decl LIMIT 1) = 0 LOOP\n"
                    "    SELECT loop declare INTO v_x"
                    " FROM public.t_decl LIMIT 1;\n"
                    "    EXIT;\n"
                    "  END LOOP;\n"
                    "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
                    "  PERFORM public.wardah_assert_org_member(p_org);\n"
                    + self.PRIVILEGED_WRITE
                ),
            ),
            "a `loop` column inside a loop header proved a declaration section",
        )

    def test_real_declaration_sections_still_open(self) -> None:
        """Every block position PostgreSQL 17.11 really accepts a DECLARE at.
        Each routine below denies a non-member with TENANT_MEMBERSHIP_REQUIRED
        and leaves bins at 55, and each is accepted through a declaration the
        scanner must keep modelling."""
        guard = "  PERFORM public.wardah_assert_org_member(p_org);\n"
        for name, body in (
            ("body_start", "DECLARE\n  v integer;\nBEGIN\n" + guard),
            ("labelled", "<<blk>> DECLARE\n  v integer;\nBEGIN\n" + guard),
            ("labelled_tight", "<<blk>>DECLARE\n  v integer;\nBEGIN\n" + guard),
            (
                "after_semicolon",
                "BEGIN\n" + guard
                + "  DECLARE v integer; BEGIN v := 1; END;\n",
            ),
            (
                "after_if_then",
                "BEGIN\n  IF true THEN DECLARE v integer;"
                " BEGIN v := 1; END; END IF;\n" + guard,
            ),
            (
                "after_else",
                "BEGIN\n  IF false THEN NULL; ELSE DECLARE v integer;"
                " BEGIN v := 1; END; END IF;\n" + guard,
            ),
            (
                "after_elsif_then",
                "BEGIN\n  IF false THEN NULL; ELSIF true THEN"
                " DECLARE v integer; BEGIN v := 1; END; END IF;\n" + guard,
            ),
            (
                "after_bare_loop",
                "BEGIN\n  LOOP DECLARE v integer; BEGIN EXIT; END;"
                " END LOOP;\n" + guard,
            ),
            (
                "after_labelled_loop",
                "BEGIN\n  <<lp>> LOOP DECLARE v integer; BEGIN EXIT lp; END;"
                " END LOOP;\n" + guard,
            ),
            (
                "after_while_loop",
                "BEGIN\n  WHILE false LOOP DECLARE v integer;"
                " BEGIN EXIT; END; END LOOP;\n" + guard,
            ),
            (
                "after_for_loop",
                "DECLARE\n  i integer;\nBEGIN\n  FOR i IN 1..1 LOOP"
                " DECLARE v integer; BEGIN EXIT; END; END LOOP;\n" + guard,
            ),
            (
                "after_foreach_loop",
                "DECLARE\n  i integer;\nBEGIN\n  FOREACH i IN ARRAY ARRAY[1]"
                " LOOP DECLARE v integer; BEGIN EXIT; END; END LOOP;\n" + guard,
            ),
            (
                "after_labelled_while_loop",
                "BEGIN\n  <<lp>> WHILE false LOOP DECLARE v integer;"
                " BEGIN EXIT lp; END; END LOOP;\n" + guard,
            ),
            (
                "after_adjacent_begin",
                "BEGIN DECLARE v integer; BEGIN v := 1; END;\n" + guard,
            ),
        ):
            with self.subTest(case=name):
                self.assertEqual(
                    self.verdict(
                        f"real_declare_{name}",
                        self.routine(body + self.PRIVILEGED_WRITE),
                    ),
                    [],
                    f"the `{name}` declaration position stopped being accepted",
                )

    def test_a_declared_raise_variable_is_still_inert(self) -> None:
        """Round 16/17 through the narrowed evidence: a variable named `raise`
        declared at one of the positions above stays a declaration, so it
        neither manufactures a boundary nor hides a later guard."""
        self.assertTrue(
            self.verdict(
                "declared_raise_inert",
                self.routine(
                    "<<blk>> DECLARE\n  raise integer;\n"
                    "BEGIN\n"
                    "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    "    raise := 2;\n"
                    "  END IF;\n" + self.PRIVILEGED_WRITE
                ),
            ),
            "a labelled declaration of a variable named `raise` denied nothing"
            " and was still read as a boundary",
        )


class Round19ComposedMutantTests(_Round19Base):
    """PostgreSQL-valid mutants combining both Round 19 families.

    Each was compiled and executed on 17.11. `wrote` records whether the
    privileged UPDATE ran for a NON-MEMBER: True means the routine authorizes
    nothing and the scanner must report a finding.
    """

    # (name, body, must_reject)
    MUTANTS = (
        (
            "m1_dollar_target_and_case_then",
            "DECLARE\n  raise$x integer;\n  v_x integer;\n"
            "BEGIN\n"
            "  SELECT CASE WHEN true THEN declare ELSE 0 END"
            " INTO v_x FROM public.t_decl LIMIT 1;\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    raise$x := 2;\n"
            "  END IF;\n",
            True,
        ),
        (
            "m2_case_then_and_qualified_target_dead_guard",
            "DECLARE\n  raise public.qty_rec;\n  v_x integer;\n"
            "BEGIN\n"
            "  SELECT CASE WHEN true THEN declare ELSE 0 END"
            " INTO v_x FROM public.t_decl LIMIT 1;\n"
            "  raise.actual_qty := 2;\n"
            "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n",
            True,
        ),
        (
            "m3_non_ascii_target_and_case_else",
            "DECLARE\n  raisé integer;\n  v_x integer;\n"
            "BEGIN\n"
            "  SELECT CASE WHEN false THEN 0 ELSE declare END"
            " INTO v_x FROM public.t_decl LIMIT 1;\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    raisé := 2;\n"
            "  END IF;\n",
            True,
        ),
        (
            "m4_end_loop_dollar_label",
            "DECLARE\n  v_x integer;\n"
            "BEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    <<raise$x>> WHILE false LOOP NULL; END LOOP raise$x;\n"
            "  END IF;\n",
            True,
        ),
        (
            "m5_shift_raise_and_case_then",
            "DECLARE\n  raise integer;\n  v_x integer;\n"
            "BEGIN\n"
            "  SELECT CASE WHEN true THEN declare ELSE 0 END"
            " INTO v_x FROM public.t_decl LIMIT 1;\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    SELECT 8 >> raise INTO v_x;\n"
            "  END IF;\n",
            True,
        ),
        (
            "m6_labelled_declare_and_subscript_target",
            "<<blk>> DECLARE\n  raise integer[];\n"
            "BEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    raise[1] := 2;\n"
            "  END IF;\n",
            True,
        ),
        (
            "m7_case_then_and_dollar_target_real_deny",
            "DECLARE\n  raise$x integer;\n  v_x integer;\n"
            "BEGIN\n"
            "  SELECT CASE WHEN true THEN declare ELSE 0 END"
            " INTO v_x FROM public.t_decl LIMIT 1;\n"
            "  raise$x := 2;\n"
            "  PERFORM public.wardah_assert_org_member(p_org);\n",
            False,
        ),
        (
            "m8_case_else_and_non_ascii_target_real_deny",
            "DECLARE\n  raisé integer;\n  v_x integer;\n"
            "BEGIN\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    SELECT CASE WHEN false THEN 0 ELSE declare END"
            " INTO v_x FROM public.t_decl LIMIT 1;\n"
            "    raisé := 2;\n"
            "    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';\n"
            "  END IF;\n",
            False,
        ),
        (
            "m9_case_then_span_closed_and_dollar_target",
            "DECLARE\n  raise$x integer;\n  v_x integer;\n"
            "BEGIN\n"
            "  SELECT CASE WHEN true THEN declare ELSE 0 END"
            " INTO v_x FROM public.t_decl LIMIT 1;\n"
            "  BEGIN NULL; END;\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    raise$x := 2;\n"
            "  END IF;\n",
            True,
        ),
        (
            "m10_case_else_span_closed_and_suffix_alias",
            "DECLARE\n  v_x integer;\n"
            "BEGIN\n"
            "  SELECT CASE WHEN false THEN 0 ELSE declare END"
            " INTO v_x FROM public.t_decl LIMIT 1;\n"
            "  BEGIN NULL; END;\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    SELECT col$then raise INTO v_x"
            " FROM public.t_decl LIMIT 1;\n"
            "  END IF;\n",
            True,
        ),
        (
            "m11_loop_label_span_closed_and_non_ascii_target",
            "DECLARE\n  raisé integer;\n  v_x integer;\n  b integer := 1;\n"
            "BEGIN\n"
            "  SELECT loop << b >> declare INTO v_x"
            " FROM public.t_decl LIMIT 1;\n"
            "  BEGIN NULL; END;\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    raisé := 2;\n"
            "  END IF;\n",
            True,
        ),
        (
            "m12_begin_ident_span_closed_and_subscript_field_target",
            "DECLARE\n  raise public.qty_rec[];\n  v_x integer;\n"
            "BEGIN\n"
            "  SELECT begin declare INTO v_x FROM public.t_decl LIMIT 1;\n"
            "  BEGIN NULL; END;\n"
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    raise[1].actual_qty := 2;\n"
            "  END IF;\n",
            True,
        ),
    )

    def test_composed_mutants_match_runtime_semantics(self) -> None:
        for name, body, must_reject in self.MUTANTS:
            with self.subTest(mutant=name):
                findings = self.verdict(
                    name, self.routine(body + self.PRIVILEGED_WRITE)
                )
                if must_reject:
                    self.assertTrue(
                        findings,
                        f"{name} authorizes nothing on 17.11 and was accepted",
                    )
                else:
                    self.assertEqual(
                        findings,
                        [],
                        f"{name} really denies a non-member on 17.11 and was"
                        " rejected",
                    )


class Round19RegressionBatteryTests(_Round19Base):
    """Prior closure classes, re-proved through the Round 19 classifiers."""

    def test_every_real_raise_form_still_denies(self) -> None:
        """Oracle: each spelling aborts a non-member with no write, in each
        position PostgreSQL accepts it."""
        for i, stmt in enumerate(
            (
                "RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';",
                "RAISE SQLSTATE '28000';",
                "RAISE EXCEPTION 'denied' USING ERRCODE = '28000';",
                "RAISE insufficient_privilege;",
                "RAISE 'denied %', p_org;",
            )
        ):
            with self.subTest(statement=stmt):
                self.assertEqual(
                    self.verdict(
                        f"real_raise_{i}",
                        self.routine(
                            "BEGIN\n"
                            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                            f"    {stmt}\n"
                            "  END IF;\n" + self.PRIVILEGED_WRITE
                        ),
                    ),
                    [],
                    f"`{stmt}` stopped being a recognized denial",
                )

    def test_every_real_raise_opener_still_opens_a_statement(self) -> None:
        """PARSER-INTERNAL, through the rewritten `_previous_word()`."""
        for opener in ("THEN", "ELSE", "BEGIN", "LOOP", "NULL;", ";"):
            fragment = f"{opener}\n  RAISE EXCEPTION 'x';\n"
            with self.subTest(opener=opener):
                self.assertTrue(
                    guards._is_statement_start(
                        fragment, fragment.index("RAISE EXCEPTION")
                    ),
                    f"a real RAISE after `{opener}` stopped opening a statement",
                )

    def test_non_aborting_raise_levels_stay_non_aborting(self) -> None:
        """NOTICE/WARNING/INFO/LOG/DEBUG report without aborting, so a guard
        after one is still reachable."""
        for level in ("NOTICE", "WARNING", "INFO", "LOG", "DEBUG"):
            with self.subTest(level=level):
                self.assertEqual(
                    self.verdict(
                        f"non_aborting_{level.lower()}",
                        self.routine(
                            f"BEGIN\n  RAISE {level} 'hello';\n"
                            "  PERFORM public.wardah_assert_org_member(p_org);\n"
                            + self.PRIVILEGED_WRITE
                        ),
                    ),
                    [],
                    f"RAISE {level} started aborting",
                )

    def test_prior_round_identifier_forms_stay_inert(self) -> None:
        """Rounds 13-18, each a `raise` that PostgreSQL 17.11 raises nothing
        for, in a branch that therefore denies nothing."""
        for name, decl, stmt in (
            ("alias", "v_flag integer;", "v_flag := (SELECT 1 AS raise);"),
            (
                "shift_spaced",
                "raise integer := 1; v_flag integer;",
                "SELECT 8 >> raise INTO v_flag;",
            ),
            (
                "shift_tight",
                "raise integer := 1; v_flag integer;",
                "SELECT 8>>raise INTO v_flag;",
            ),
            (
                "end_loop_label",
                "v_flag integer;",
                "<<raise>> WHILE false LOOP NULL; END LOOP raise;",
            ),
            ("declared_assign_walrus", "raise integer;", "raise := 2;"),
            ("declared_assign_eq", "raise integer;", "raise = 2;"),
            ("field_target", "raise public.qty_rec;", "raise.actual_qty := 2;"),
            ("quoted_field_target", "raise public.qty_rec;", 'raise."Odd Field" := 5;'),
            ("subscript_target", "raise integer[];", "raise[1] := 2;"),
            (
                "nested_subscript_target",
                "raise integer[]; idx integer[] := ARRAY[1];",
                "raise[idx[1]] := 8;",
            ),
            (
                "deep_selector_target",
                "raise public.qty_rec[];",
                "raise[1].actual_qty := 6;",
            ),
        ):
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(
                        f"inert_{name}",
                        self.routine(
                            f"DECLARE\n  {decl}\n"
                            "BEGIN\n"
                            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                            f"    {stmt}\n"
                            "  END IF;\n" + self.PRIVILEGED_WRITE
                        ),
                    ),
                    f"`{stmt}` denies nothing on 17.11 but was read as a"
                    " boundary again",
                )

    def test_prior_round_declare_evidence_stays_inert(self) -> None:
        """Round 18: a raw `>>` or a raw `$` is still no DECLARE evidence."""
        for name, stmt in (
            ("shift", "SELECT 8 >> declare INTO v_x FROM public.t_decl LIMIT 1;"),
            ("shift_tight", "SELECT 8>>declare INTO v_x FROM public.t_decl LIMIT 1;"),
            (
                "shift_comment",
                "SELECT 8 >> /* c */ declare INTO v_x"
                " FROM public.t_decl LIMIT 1;",
            ),
            ("dollar_ident", "SELECT col$declare INTO v_x FROM public.t_decl LIMIT 1;"),
        ):
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(
                        f"prior_declare_{name}",
                        self.routine(
                            "DECLARE\n  v_x integer;\n"
                            "BEGIN\n"
                            f"  {stmt}\n"
                            "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
                            "  PERFORM public.wardah_assert_org_member(p_org);\n"
                            + self.PRIVILEGED_WRITE
                        ),
                    ),
                    f"`{name}` opened a declaration section again",
                )

    def test_standalone_perform_and_return_reachability_still_hold(self) -> None:
        for name, body, accepted in (
            (
                "standalone_perform",
                "BEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n",
                True,
            ),
            (
                "return_before_guard",
                "BEGIN\n  RETURN;\n"
                "  PERFORM public.wardah_assert_org_member(p_org);\n",
                False,
            ),
            (
                "labelled_exit_over_guard",
                "BEGIN\n  <<auth_block>>\n  BEGIN\n    EXIT auth_block;\n"
                "    PERFORM public.wardah_assert_org_member(p_org);\n  END;\n",
                False,
            ),
        ):
            with self.subTest(case=name):
                findings = self.verdict(
                    f"reach_{name}", self.routine(body + self.PRIVILEGED_WRITE)
                )
                self.assertEqual(
                    findings == [],
                    accepted,
                    f"`{name}` reachability changed",
                )

    def test_p0001_swallowing_still_rejects_a_guard(self) -> None:
        for handler in (
            "WHEN OTHERS",
            "WHEN raise_exception",
            "WHEN SQLSTATE 'P0001'",
            "WHEN SQLSTATE 'P0000'",
        ):
            with self.subTest(handler=handler):
                self.assertTrue(
                    self.verdict(
                        f"swallow_{abs(hash(handler)) % 10 ** 6}",
                        self.routine(
                            "BEGIN\n"
                            "  PERFORM public.wardah_assert_org_member(p_org);\n"
                            + self.PRIVILEGED_WRITE
                            + f"EXCEPTION {handler} THEN\n  NULL;\n"
                        ),
                    ),
                    f"`{handler}` stopped swallowing the assertion's P0001",
                )

    def test_numbered_migrations_122_to_191_stay_clean(self) -> None:
        """The whole reviewed corpus, through the Round 19 classifiers."""
        root = pathlib.Path(__file__).resolve().parents[2] / "sql" / "migrations"
        files = sorted(
            p for p in root.glob("*.sql")
            if p.name[:3].isdigit() and 122 <= int(p.name[:3]) <= 191
        )
        self.assertEqual(len(files), 61, "the reviewed sweep changed size")
        findings = {p.name: guards.check_file(p) for p in files}
        self.assertEqual(
            {name: out for name, out in findings.items() if out},
            {},
            "the 122-191 sweep stopped being clean",
        )


# ---------------------------------------------------------------------------
# Round 20
# ---------------------------------------------------------------------------
# Two root causes, both confirmed by independent review and both reproduced on
# PostgreSQL 17.11 before being closed.
#
# A - POSTGRESQL IDENTIFIER BOUNDARIES ARE NOT PYTHON `\b`. Round 19 corrected
#   the two hand-written identifier WALKS (_previous_word() and
#   _is_assignment_target()) to use the file's ident_cont class. It did not
#   correct the forward keyword RECOGNIZERS, which still used `\b` - and `\b`
#   is defined against `\w`, a Unicode CATEGORY test that excludes `$` and
#   every non-ASCII code point outside the letter/digit categories. PostgreSQL
#   accepts all of them as identifier CONTINUATION, so Python saw a word
#   boundary in the middle of one identifier.
#
#   All 98 containment forms exercised below - `col$end`, `end$x`, `x$end$y`
#   and `col<non-ASCII>end` for fourteen keywords - were created as columns on
#   PostgreSQL 17.11 and read back from `pg_attribute` unchanged, so each is
#   provably ONE unquoted identifier. Python's `\bEND\b` matches inside every
#   one of them.
#
#   `_BLOCK_TOKEN_RE` is the worst case because it consults no walk at all: it
#   builds the control-frame stack straight from its own matches. Codex's P1
#   chain ran end to end - a fake END popped the SQL CASE frame, which handed
#   ownership of the following SQL `ELSE` to the enclosing PL/pgSQL IF, which
#   made an ordinary `declare` identifier open a declaration section, which
#   swallowed the real outer-level `RAISE EXCEPTION 'NOT_IMPLEMENTED'`, which
#   left the DEAD `PERFORM public.wardah_assert_org_member(...)` after that
#   abort looking like the routine's authorization boundary.
#
# B - LABEL OWNERSHIP WAS NOT STRUCTURAL. `_block_labels()` recorded a label
#   whenever a complete `<<ident>>` reached a `>>`, and PostgreSQL spells right
#   shift `>>` too. `SELECT a << b >> loop declare INTO v_x FROM public.t2`
#   compiles on 17.11 (`loop` is an unreserved column name, `declare` its
#   alias) and labelled the fake LOOP frame the identifier pushes. Placed
#   inside a real loop that fake frame also STEALS the real `END LOOP` and so
#   comes back closed - the exact case Round 19's head test was added to stop -
#   and the manufactured label let `_opens_loop_statement()` skip that head
#   test through its `pos in _block_labels()` shortcut.
#
# Every routine below was compiled on PostgreSQL 17.11 as a SECURITY DEFINER
# routine and EXECUTED, against a `public.bins` row seeded at 55, with
# `public.wardah_is_org_member()` / `public.wardah_assert_org_member()`
# behaving as this repository's helpers do. Every one came back
# `prosecdef = true` and executable by PUBLIC and by the client role, so the
# verdicts asserted here are verdicts about live authorization behaviour.


class _Round20Base(unittest.TestCase):
    """Fixtures for Round 20."""

    # Four non-ASCII continuation code points, one per Unicode category that
    # Python's `\w` - and therefore `\b` - gets wrong: Mn, Po, Cf and So.
    NON_ASCII_CONT = ("́", "·", "​", "\U0001F600")

    # The keywords whose suffix can reach a security-bearing recognizer.
    STRUCTURAL_KEYWORDS = (
        "end", "if", "then", "else", "elsif", "begin", "loop", "case",
        "raise", "declare", "exception", "exit", "when", "return",
    )

    PRIVILEGED_WRITE = (
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
    )
    GUARD = "  PERFORM public.wardah_assert_org_member(p_org);\n"
    ABORT = "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"
    DENY = (
        "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
        "    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';\n"
        "  END IF;\n"
    )
    DECL = "DECLARE\n  v_x integer;\n"

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round20_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    @staticmethod
    def routine(body: str) -> str:
        return (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $body$\n"
            f"{body}"
            "END;\n"
            "$body$;\n"
        )

    @classmethod
    def containments(cls, keyword: str) -> tuple[str, ...]:
        """Every form in which `keyword` hides inside ONE PostgreSQL identifier.

        Each was created as a column on 17.11 and read back from `pg_attribute`
        unchanged, so the containment is the oracle's, not this file's.
        """
        return (
            f"col${keyword}", f"{keyword}$x", f"x${keyword}$y",
            *(f"col{ch}{keyword}" for ch in cls.NON_ASCII_CONT),
        )

    @staticmethod
    def slug(ident: str) -> str:
        return "".join(
            ch if ch.isalnum() or ch == "_" else f"u{ord(ch):x}" for ch in ident
        )


class Round20KeywordBoundaryTests(_Round20Base):
    """ONE PostgreSQL keyword boundary, in every security-bearing lexer."""

    def test_the_file_spells_the_boundary_once(self) -> None:
        """PARSER-INTERNAL. Both boundary constants are DERIVED from
        `_IDENT_CONT`, so a keyword lexer cannot drift from the identifier
        alphabet the way `\\b` had drifted from it."""
        self.assertEqual(guards._KW_LEFT, f"(?<![{guards._IDENT_CONT}])")
        self.assertEqual(guards._KW_RIGHT, f"(?![{guards._IDENT_CONT}])")
        self.assertEqual(
            guards._pg_kw("END"),
            f"{guards._KW_LEFT}(?:END){guards._KW_RIGHT}",
        )

    def test_python_word_boundary_is_not_the_postgresql_one(self) -> None:
        """PARSER-INTERNAL, and the whole reason this round exists: `\\b` fires
        inside a single PostgreSQL identifier for every keyword and every
        containment form, while the shared boundary does not."""
        shared = re.compile(guards._pg_kw("END"), re.IGNORECASE)
        for keyword in self.STRUCTURAL_KEYWORDS:
            legacy = re.compile(rf"\b{keyword}\b", re.IGNORECASE)
            for form in self.containments(keyword):
                with self.subTest(keyword=keyword, form=form):
                    self.assertIsNotNone(
                        guards._PLAIN_IDENT_RE.match(form),
                        f"{form!r} is ONE identifier on 17.11",
                    )
                    self.assertIsNotNone(
                        legacy.search(form),
                        f"Python \\b no longer splits {form!r}",
                    )
        for form in self.containments("end"):
            with self.subTest(form=form):
                self.assertIsNone(
                    shared.search(form),
                    f"the shared boundary still splits {form!r}",
                )

    def test_every_structural_lexer_uses_the_shared_boundary(self) -> None:
        """PARSER-INTERNAL. The audit, pinned: none of the security-bearing
        keyword matchers may go back to `\\b`, and each must refuse the keyword
        when it is glued to an identifier-continuation character."""
        for name, probe in (
            ("_BLOCK_TOKEN_RE", "v := col$end;"),
            ("_NON_ABORTING_RAISE_RE", "col$raise notice 'x'"),
            ("_RAISE_BEFORE_RE", "col$raise "),
            ("_DECLARE_TOKEN_RE", "col$declare"),
            ("_SECTION_BEGIN_RE", "col$begin"),
            ("_HANDLER_WHEN_RE", "col$when"),
            ("_HANDLER_THEN_RE", "col$then"),
            ("_SQLSTATE_KEYWORD_RE", "col$sqlstate"),
            ("_DECLARE_KW_RE", "col$declare"),
            ("_BEGIN_KW_RE", "col$begin"),
            ("_LOOP_KW_RE", "col$loop"),
            ("_LOOP_HEAD_RE", "col$loop"),
            ("_TERMINATING_RETURN_RE", "col$return"),
            ("_ABORTING_RAISE_RE", "col$raise"),
            ("_EXIT_KW_RE", "col$exit"),
            ("_WHEN_KW_RE", "col$when"),
            ("_PERFORM_HEAD_RE", "col$perform"),
            ("_TOP_LEVEL_OR_RE", "col$or"),
        ):
            with self.subTest(matcher=name):
                pattern = getattr(guards, name)
                self.assertNotIn(
                    "\\b", pattern.pattern,
                    f"{name} went back to a Python word boundary",
                )
                self.assertIsNone(
                    pattern.search(probe),
                    f"{name} still reads a keyword out of {probe!r}",
                )

    def test_a_contained_keyword_opens_no_frame(self) -> None:
        """PARSER-INTERNAL. `_BLOCK_TOKEN_RE` feeds the control-frame stack
        directly, so a suffix it mistakes for a keyword is a frame nothing else
        can veto."""
        for keyword in ("end", "if", "then", "else", "begin", "loop", "case",
                        "raise", "exception"):
            for form in self.containments(keyword):
                with self.subTest(form=form):
                    self.assertEqual(
                        [m.group(1) for m in
                         guards._BLOCK_TOKEN_RE.finditer(f"v_x := t.{form};")],
                        [],
                        f"{form!r} still produces a structural token",
                    )


class Round20CodexBlockTokenTests(_Round20Base):
    """Codex's Round-19 P1, pinned end to end through real check_file()."""

    def _codex_chain(self, ident: str) -> str:
        """PL/pgSQL IF > embedded SQL CASE > keyword-suffixed identifier >
        SQL ELSE > DECLARE-shaped identifier > real outer abort > dead guard."""
        return self.routine(
            self.DECL + "BEGIN\n"
            "  IF p_org IS NOT NULL THEN\n"
            f"    SELECT CASE WHEN true THEN t.{ident} ELSE declare END"
            " INTO v_x FROM public.t;\n"
            "  END IF;\n"
            + self.ABORT + self.GUARD + self.PRIVILEGED_WRITE
        )

    def test_a_fake_end_cannot_credit_a_dead_guard(self) -> None:
        """Oracle: every one of these compiles, is `prosecdef = true` and
        executable by PUBLIC and the client role, and ABORTS at
        `NOT_IMPLEMENTED` (P0001) for member and non-member alike -
        `bins.actual_qty` stays 55. The PERFORM after that abort is dead code
        that can never authorize anything. check_file() returned []."""
        for ident in self.containments("end"):
            with self.subTest(identifier=ident):
                self.assertTrue(
                    self.verdict(f"codex_{self.slug(ident)}",
                                 self._codex_chain(ident)),
                    f"{ident!r} still closes a frame, hides the real abort and"
                    " credits the dead guard",
                )

    def test_the_chain_breaks_at_every_link(self) -> None:
        """PARSER-INTERNAL, so a future regression names WHICH link failed."""
        sql = self._codex_chain("col$end")
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        definition = guards.parse_definitions(sql, masked)[0]
        body = masked[definition.start: definition.body_span[1]]

        self.assertNotIn(
            "END", [" ".join(m.group(1).upper().split())
                    for m in guards._BLOCK_TOKEN_RE.finditer(body)][:4],
            "the identifier suffix still reads as a bare structural END",
        )
        # The SQL ELSE belongs to the CASE, which is still on the stack.
        else_pos = body.index("ELSE declare")
        self.assertFalse(
            guards._owns_statement_list(body, "else", else_pos),
            "a SQL CASE arm still owns a PL/pgSQL statement list",
        )
        declare_pos = body.index("declare", else_pos)
        self.assertFalse(
            guards._opens_declaration_section(body, declare_pos),
            "an ordinary `declare` identifier still opens a section",
        )
        self.assertEqual(
            [span for span in guards._declaration_spans(body)
             if span[0] > else_pos],
            [],
            "a declaration span is still manufactured after the CASE",
        )
        raise_pos = body.index("RAISE EXCEPTION")
        self.assertTrue(
            guards._is_statement_start(body, raise_pos),
            "the real outer-level RAISE is still suppressed",
        )

    def test_a_fake_end_cannot_unpin_a_swallowing_handler(self) -> None:
        """A bare END pops the innermost BEGIN, and with that BEGIN gone the
        EXCEPTION section attached to nothing, so `is_swallowed()` saw no
        handler. Oracle: the non-member call RETURNS NORMALLY - the guard
        raised and `WHEN OTHERS THEN NULL` swallowed the denial, so the caller
        cannot tell it was denied. check_file() returned []."""
        for ident in self.containments("end"):
            with self.subTest(identifier=ident):
                self.assertTrue(
                    self.verdict(
                        f"swallow_{self.slug(ident)}",
                        self.routine(
                            self.DECL + "BEGIN\n"
                            f"  SELECT t.{ident} INTO v_x FROM public.t;\n"
                            + self.GUARD + self.PRIVILEGED_WRITE
                            + "EXCEPTION WHEN OTHERS THEN\n  NULL;\n"
                        ),
                    ),
                    f"{ident!r} still detaches the swallowing handler",
                )

    def test_a_fake_end_cannot_flatten_a_nested_block(self) -> None:
        """The same pop also removed the enclosing BEGIN from the guard's frame
        set, so a guard inside a NESTED block read as outer-level and passed the
        strict-cutoff reachability contract. Oracle: the routine does deny
        (TENANT_MEMBERSHIP_REQUIRED, bins stays 55), but the guard is not in the
        shape migrations at or after the cutoff are required to use."""
        for ident in self.containments("end"):
            with self.subTest(identifier=ident):
                self.assertTrue(
                    self.verdict(
                        f"nested_{self.slug(ident)}",
                        self.routine(
                            self.DECL + "BEGIN\n"
                            f"  SELECT t.{ident} INTO v_x FROM public.t;\n"
                            "  BEGIN\n  " + self.GUARD + "  END;\n"
                            + self.PRIVILEGED_WRITE
                        ),
                    ),
                    f"{ident!r} still flattens the nested block",
                )

    def test_a_contained_keyword_does_not_reject_a_real_guard(self) -> None:
        """The other direction, and the reason this is a boundary correction
        rather than a broader clamp: an ordinary column whose name merely ENDS
        in a keyword must not cost a correctly guarded routine its verdict.
        Oracle: each denies a non-member with TENANT_MEMBERSHIP_REQUIRED and
        leaves bins at 55."""
        for keyword in self.STRUCTURAL_KEYWORDS:
            for ident in self.containments(keyword):
                with self.subTest(identifier=ident):
                    self.assertEqual(
                        self.verdict(
                            f"ok_{self.slug(ident)}",
                            self.routine(
                                self.DECL + "BEGIN\n"
                                f"  SELECT t.{ident} INTO v_x FROM public.t;\n"
                                + self.GUARD + self.PRIVILEGED_WRITE
                            ),
                        ),
                        [],
                        f"{ident!r} still costs a real guard its verdict",
                    )


class Round20LabelOwnershipTests(_Round20Base):
    """A label owns a real BLOCK or LOOP; a shift operator owns nothing."""

    SHIFTS = (
        "SELECT a << b >> begin INTO v_x FROM public.t2;",
        "SELECT a << b >> loop INTO v_x FROM public.t2;",
        "SELECT a << b >> declare INTO v_x FROM public.t2;",
        "SELECT a << b >> begin$x INTO v_x FROM public.t2;",
        "SELECT a << b >> loop$x INTO v_x FROM public.t2;",
        "SELECT a << b >> while$x INTO v_x FROM public.t2; LOOP NULL; END LOOP;",
        "SELECT a << b >> for$x INTO v_x FROM public.t2; LOOP NULL; END LOOP;",
        "SELECT a << b >> foreach$x INTO v_x FROM public.t2; LOOP NULL; END LOOP;",
        "SELECT a << b >> c INTO v_x FROM public.t2;",
    )

    def test_shift_expressions_manufacture_no_label(self) -> None:
        """PARSER-INTERNAL. Every one of these is an ordinary expression on
        17.11, and a raw `>>` is never evidence of a label."""
        for text in self.SHIFTS:
            with self.subTest(expression=text):
                self.assertEqual(
                    guards._block_labels(text), {},
                    "a shift expression still owns a label",
                )

    def test_a_label_is_proved_forward_from_a_block_position(self) -> None:
        """PARSER-INTERNAL. `_label_opener_before()` is the one backward reader,
        and it validates the label FORWARD with the same grammar
        `_block_labels()` uses - so a `>>` that no complete label reaches, and a
        label that follows an operand, are both refused."""
        body = "SELECT a << b >> declare INTO v_x FROM public.t2;"
        opener = guards._label_opener_before(body, body.index("declare"))
        self.assertEqual(opener, body.index("<<"),
                         "the backward reader no longer finds the construct")
        self.assertFalse(
            guards._opens_block_position(body, body.index("declare")),
            "a label that follows an operand still opens a block position",
        )
        real = "; <<blk>> DECLARE v integer; BEGIN NULL; END blk;"
        self.assertTrue(
            guards._opens_block_position(real, real.index("DECLARE")),
            "a real labelled DECLARE stopped being a block position",
        )
        self.assertIsNone(
            guards._label_opener_before("v_x := 8 >> 2;", len("v_x := 8 >> ")),
            "a bare `>>` still reads as a label",
        )

    def test_a_manufactured_label_cannot_open_a_declaration_section(self) -> None:
        """The Root-Cause-B P1, end to end. Oracle: this compiles, is
        `prosecdef = true` and client-executable, and ABORTS at
        `NOT_IMPLEMENTED` - so the PERFORM after it is dead code. The fake LOOP
        frame the identifier `loop` pushes steals the real `END LOOP` and comes
        back closed, and the label manufactured by `a << b >>` used to let
        `_opens_loop_statement()` skip the head test entirely. check_file()
        returned []."""
        self.assertTrue(
            self.verdict(
                "shift_label_loop_declare",
                self.routine(
                    self.DECL + "BEGIN\n  LOOP\n"
                    "    SELECT a << b >> loop declare INTO v_x"
                    " FROM public.t2;\n"
                    "    EXIT;\n  END LOOP;\n"
                    + self.ABORT + self.GUARD + self.PRIVILEGED_WRITE
                ),
            ),
            "a manufactured label still opens a declaration section",
        )

    def test_real_labelled_constructs_still_own_their_blocks(self) -> None:
        """Every real labelled shape below compiles on 17.11. A label that
        stops being recognized is not a safe failure: `labelled_exit_before()`
        matches an EXIT target against it, and `_opens_declaration_section()`
        needs it for `<<blk>> DECLARE`."""
        for name, body, accepted in (
            ("label_declare",
             "<<blk>>\nDECLARE\n  v integer;\nBEGIN\n"
             + self.GUARD + self.PRIVILEGED_WRITE, True),
            ("label_declare_tight",
             "<<blk>>DECLARE\n  v integer;\nBEGIN\n"
             + self.GUARD + self.PRIVILEGED_WRITE, True),
            ("quoted_label_declare",
             '<<"Blk">>\nDECLARE\n  v integer;\nBEGIN\n'
             + self.GUARD + self.PRIVILEGED_WRITE, True),
            ("unicode_label_declare",
             "<<blä>>\nDECLARE\n  v integer;\nBEGIN\n"
             + self.GUARD + self.PRIVILEGED_WRITE, True),
            ("astral_label_declare",
             "<<bl\U0001F600k>>\nDECLARE\n  v integer;\nBEGIN\n"
             + self.GUARD + self.PRIVILEGED_WRITE, True),
            ("labelled_while",
             "BEGIN\n  <<lp>>\n  WHILE false LOOP\n    EXIT lp;\n"
             "  END LOOP lp;\n" + self.GUARD + self.PRIVILEGED_WRITE, True),
            ("labelled_for",
             "BEGIN\n  <<lp>>\n  FOR i IN 1..2 LOOP\n    EXIT lp;\n"
             "  END LOOP lp;\n" + self.GUARD + self.PRIVILEGED_WRITE, True),
            ("labelled_exit_over_guard",
             "BEGIN\n  <<auth_block>>\n  BEGIN\n    EXIT auth_block;\n  "
             + self.GUARD + "  END;\n" + self.PRIVILEGED_WRITE, False),
            ("quoted_labelled_exit_over_guard",
             'BEGIN\n  <<"Auth">>\n  BEGIN\n    EXIT "Auth";\n  '
             + self.GUARD + "  END;\n" + self.PRIVILEGED_WRITE, False),
            ("labelled_declare_suppresses_raise",
             "BEGIN\n  <<blk>>\n  DECLARE\n    raise integer;\n  BEGIN\n"
             "    IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "      raise := 2;\n    END IF;\n  END blk;\n"
             + self.PRIVILEGED_WRITE, False),
        ):
            with self.subTest(case=name):
                self.assertEqual(
                    self.verdict(f"real_{name}", self.routine(body)) == [],
                    accepted,
                    f"`{name}` changed verdict",
                )


class Round20ComposedMutantTests(_Round20Base):
    """Fresh composed mutants, each compiled AND executed on 17.11."""

    def test_composed_mutants_hold(self) -> None:
        deny, guard, write = self.DENY, self.GUARD, self.PRIVILEGED_WRITE
        abort, decl = self.ABORT, self.DECL
        for name, body, accepted in (
            # 1. `$` identifier + SQL CASE + dead recognized guard.
            ("m01_dollar_case_dead_guard",
             decl + "BEGIN\n"
             "  SELECT CASE WHEN true THEN t.col$end ELSE t.x END"
             " INTO v_x FROM public.t;\n" + abort + guard + write, False),
            # 2. non-ASCII continuation + a real deny branch.
            ("m02_nonascii_real_deny",
             decl + "BEGIN\n  SELECT t.coĺend INTO v_x FROM public.t;\n"
             + deny + write, True),
            # 3. col$end + NESTED SQL CASE inside a PL/pgSQL IF.
            ("m03_dollar_end_nested_case_if",
             decl + "BEGIN\n  IF p_org IS NOT NULL THEN\n"
             "    SELECT CASE WHEN true THEN"
             " CASE WHEN true THEN t.col$end ELSE t.x END\n"
             "                ELSE declare END INTO v_x FROM public.t;\n"
             "  END IF;\n" + abort + guard + write, False),
            # 4. col$then / col$else + a DECLARE-shaped ordinary identifier.
            ("m04_dollar_else_then_declare",
             decl + "BEGIN\n"
             "  SELECT CASE WHEN true THEN t.col$then ELSE t.col$else END"
             " INTO v_x FROM public.t;\n"
             "  SELECT t.col$begin declare INTO v_x FROM public.t;\n"
             + abort + guard + write, False),
            # 5. identifier `loop` + shift operators + DECLARE-shaped alias.
            ("m05_shift_label_loop_declare",
             decl + "BEGIN\n  LOOP\n"
             "    SELECT a << b >> loop declare INTO v_x FROM public.t2;\n"
             "    EXIT;\n  END LOOP;\n" + abort + guard + write, False),
            # 6. identifier `begin` + a real RAISE after it.
            ("m06_identifier_begin_real_raise",
             decl + "BEGIN\n"
             "  SELECT a << b >> begin INTO v_x FROM public.t2;\n"
             + deny + write, True),
            # 7. real labelled DECLARE + qualified `raise.field :=`.
            ("m07_labelled_declare_raise_field",
             "<<blk>>\nDECLARE\n  raise public.bins%ROWTYPE;\nBEGIN\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    raise.actual_qty := 2;\n  END IF;\n" + write, False),
            # 8. real labelled loop + END LOOP label named `raise`.
            ("m08_labelled_loop_end_label_raise",
             "BEGIN\n  <<raise>>\n  WHILE false LOOP\n    NULL;\n"
             "  END LOOP raise;\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    NULL;\n  END IF;\n" + write, False),
            # 9. right shift `8 >> raise` inside an embedded SQL CASE.
            ("m09_right_shift_raise_case",
             decl + "BEGIN\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    SELECT CASE WHEN true THEN 8 >> raise ELSE 0 END"
             " INTO v_x FROM public.t2;\n"
             "  END IF;\n" + write, False),
            # 10. `a << b >> c` beside a REAL labelled block whose EXIT bites.
            ("m10_shift_plus_real_labelled_block",
             decl + "BEGIN\n  SELECT a << b >> x INTO v_x FROM public.t2;\n"
             "  <<auth_block>>\n  BEGIN\n    EXIT auth_block;\n  "
             + guard + "  END;\n" + write, False),
            # 11. exception handler + keyword-containing identifiers.
            ("m11_handler_keyword_identifiers",
             decl + "BEGIN\n  SELECT t.col$when INTO v_x FROM public.t;\n"
             + guard + write
             + "EXCEPTION WHEN OTHERS THEN\n"
             "  SELECT t.col$then INTO v_x FROM public.t;\n", False),
            # 12. nested block + SQL CASE + a real standalone PERFORM.
            ("m12_nested_block_case_real_perform",
             decl + "BEGIN\n"
             "  SELECT CASE WHEN true THEN t.col$case ELSE t.col$loop END"
             " INTO v_x FROM public.t;\n"
             "  BEGIN\n    v_x := 1;\n  END;\n" + guard + write, True),
        ):
            with self.subTest(mutant=name):
                self.assertEqual(
                    self.verdict(name, self.routine(body)) == [],
                    accepted,
                    f"`{name}` changed verdict",
                )


class Round20RegressionBatteryTests(_Round20Base):
    """Rounds 13-19, re-proved through the Round-20 lexer."""

    def test_identifier_named_raise_families_still_hold(self) -> None:
        for name, body, accepted in (
            ("r13_alias_named_raise",
             "DECLARE\n  v_x integer;\nBEGIN\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    SELECT 1 AS raise INTO v_x;\n  END IF;\n", False),
            ("r14_right_shift_raise",
             "DECLARE\n  v_x integer;\nBEGIN\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    SELECT 8 >> raise INTO v_x FROM public.t2;\n"
             "  END IF;\n", False),
            ("r14_right_shift_raise_tight",
             "DECLARE\n  v_x integer;\nBEGIN\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    SELECT 8>>raise INTO v_x FROM public.t2;\n"
             "  END IF;\n", False),
            ("r15_end_loop_label_named_raise",
             "BEGIN\n  <<raise>>\n  LOOP\n    EXIT raise;\n  END LOOP raise;\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    NULL;\n  END IF;\n", False),
            ("r16_first_declaration_named_raise",
             "DECLARE\n  raise integer;\nBEGIN\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    raise := 2;\n  END IF;\n", False),
            ("r17_second_declaration_named_raise",
             "DECLARE\n  x integer := 1;\n  raise integer := 2;\nBEGIN\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    NULL;\n  END IF;\n", False),
            ("r17_assignment_after_begin",
             "DECLARE\n  raise integer := 1;\nBEGIN\n  raise := 2;\n"
             + self.GUARD, True),
            ("r17_bare_equals_assignment",
             "DECLARE\n  raise integer := 1;\nBEGIN\n  raise = 2;\n"
             + self.GUARD, True),
            ("r18_shift_declare",
             "DECLARE\n  v_x integer;\nBEGIN\n"
             "  SELECT 8 >> declare INTO v_x FROM public.t2;\n"
             + self.ABORT + self.GUARD, False),
            ("r18_col_dollar_declare",
             "DECLARE\n  v_x integer;\nBEGIN\n"
             "  SELECT t.col$declare INTO v_x FROM public.t;\n"
             + self.ABORT + self.GUARD, False),
            ("r18_composed_shift_declare",
             "DECLARE\n  v_x integer;\nBEGIN\n"
             "  SELECT a << b >> declare INTO v_x FROM public.t2;\n"
             + self.ABORT + self.GUARD, False),
            ("r18_raise_field_target",
             "DECLARE\n  raise public.bins%ROWTYPE;\nBEGIN\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    raise.actual_qty := 2;\n  END IF;\n", False),
            ("r18_raise_subscript_target",
             "DECLARE\n  raise integer[];\nBEGIN\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    raise[1] := 2;\n  END IF;\n", False),
            ("r19_dollar_suffix_target",
             "DECLARE\n  raise$x integer;\nBEGIN\n"
             "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
             "    raise$x := 2;\n  END IF;\n", False),
            ("r19_case_then_declare",
             "DECLARE\n  v_x integer;\nBEGIN\n"
             "  SELECT CASE WHEN true THEN declare ELSE 0 END"
             " INTO v_x FROM public.t;\n" + self.ABORT + self.GUARD, False),
            ("r19_case_else_declare",
             "DECLARE\n  v_x integer;\nBEGIN\n"
             "  SELECT CASE WHEN false THEN 0 ELSE declare END"
             " INTO v_x FROM public.t;\n" + self.ABORT + self.GUARD, False),
            ("r19_identifier_loop_declare",
             "DECLARE\n  v_x integer;\nBEGIN\n"
             "  SELECT loop declare INTO v_x FROM public.t2;\n"
             + self.ABORT + self.GUARD, False),
            ("r19_identifier_begin_declare",
             "DECLARE\n  v_x integer;\nBEGIN\n"
             "  SELECT begin declare INTO v_x FROM public.t2;\n"
             + self.ABORT + self.GUARD, False),
            ("r19_stolen_end_loop",
             "DECLARE\n  v_x integer;\nBEGIN\n  LOOP\n"
             "    SELECT loop declare INTO v_x FROM public.t2;\n"
             "    EXIT;\n  END LOOP;\n" + self.ABORT + self.GUARD, False),
        ):
            with self.subTest(case=name):
                sql = self.routine(body + self.PRIVILEGED_WRITE)
                self.assertEqual(
                    self.verdict(f"bat_{name}", sql) == [], accepted,
                    f"`{name}` changed verdict",
                )

    def test_non_ascii_identifier_continuation_still_holds(self) -> None:
        """Round 19's alphabet, re-proved: `raise` plus any non-ASCII code point
        is ONE identifier that 17.11 declares and assigns to."""
        for ch in self.NON_ASCII_CONT:
            with self.subTest(codepoint=f"U+{ord(ch):04X}"):
                self.assertTrue(
                    self.verdict(
                        f"na_{ord(ch):x}",
                        self.routine(
                            f"DECLARE\n  raise{ch} integer;\nBEGIN\n"
                            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                            f"    raise{ch} := 2;\n  END IF;\n"
                            + self.PRIVILEGED_WRITE
                        ),
                    ),
                    f"U+{ord(ch):04X} stopped continuing an identifier",
                )

    def test_reachability_and_handler_classes_still_hold(self) -> None:
        for name, body, accepted in (
            ("standalone_perform", "BEGIN\n" + self.GUARD, True),
            ("return_before_guard", "BEGIN\n  RETURN;\n" + self.GUARD, False),
            ("return_next_is_not_an_exit",
             "BEGIN\n" + self.GUARD, True),
            ("outer_abort_before_guard",
             "BEGIN\n" + self.ABORT + self.GUARD, False),
            ("labelled_exit_before_guard",
             "BEGIN\n  <<auth_block>>\n  BEGIN\n    EXIT auth_block;\n  "
             + self.GUARD + "  END;\n", False),
            ("exit_when_before_guard",
             "BEGIN\n  <<auth_block>>\n  BEGIN\n    EXIT auth_block WHEN true;\n  "
             + self.GUARD + "  END;\n", False),
            ("non_standalone_perform",
             "BEGIN\n  PERFORM public.wardah_assert_org_member(p_org)"
             " WHERE false;\n", False),
        ):
            with self.subTest(case=name):
                self.assertEqual(
                    self.verdict(f"reach_{name}",
                                 self.routine(body + self.PRIVILEGED_WRITE)) == [],
                    accepted,
                    f"`{name}` changed verdict",
                )
        for handler, swallows in (
            ("WHEN OTHERS", True),
            ("WHEN raise_exception", True),
            ("WHEN plpgsql_error", True),
            ("WHEN SQLSTATE 'P0001'", True),
            ("WHEN SQLSTATE 'P0000'", True),
            ('WHEN "others"', True),
            ("WHEN unique_violation", False),
        ):
            with self.subTest(handler=handler):
                self.assertEqual(
                    self.verdict(
                        f"hand_{abs(hash(handler)) % 10 ** 6}",
                        self.routine(
                            "BEGIN\n" + self.GUARD + self.PRIVILEGED_WRITE
                            + f"EXCEPTION {handler} THEN\n  NULL;\n"
                        ),
                    ) == [],
                    not swallows,
                    f"`{handler}` changed swallowing behaviour",
                )

    def test_non_aborting_raise_levels_are_still_not_denials(self) -> None:
        for level in ("NOTICE", "WARNING", "INFO", "LOG", "DEBUG"):
            with self.subTest(level=level):
                self.assertTrue(
                    self.verdict(
                        f"lvl_{level}",
                        self.routine(
                            "BEGIN\n"
                            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                            f"    RAISE {level} 'not a denial';\n  END IF;\n"
                            + self.PRIVILEGED_WRITE
                        ),
                    ),
                    f"RAISE {level} still reads as a denial",
                )
                self.assertEqual(
                    self.verdict(
                        f"lvlok_{level}",
                        self.routine(
                            f"BEGIN\n  RAISE {level} 'hello';\n"
                            + self.GUARD + self.PRIVILEGED_WRITE
                        ),
                    ),
                    [],
                    f"RAISE {level} still ends the invocation",
                )

    def test_real_control_shapes_are_still_recognized(self) -> None:
        """A guard nested in any real control construct is still not at the
        function's outer statement level, so the strict contract still rejects
        it - the boundary correction narrowed no real keyword."""
        for name, body in (
            ("if_then", "BEGIN\n  IF p_org IS NOT NULL THEN\n  "
             + self.GUARD + "  END IF;\n"),
            ("elsif", "BEGIN\n  IF false THEN NULL;\n  ELSIF true THEN\n  "
             + self.GUARD + "  END IF;\n"),
            ("else", "BEGIN\n  IF false THEN NULL;\n  ELSE\n  "
             + self.GUARD + "  END IF;\n"),
            ("loop", "BEGIN\n  LOOP\n  " + self.GUARD + "    EXIT;\n  END LOOP;\n"),
            ("while", "BEGIN\n  WHILE false LOOP\n  " + self.GUARD + "  END LOOP;\n"),
            ("for", "BEGIN\n  FOR i IN 1..2 LOOP\n  " + self.GUARD + "  END LOOP;\n"),
            ("foreach", "DECLARE\n  arr int[] := '{1}';\n  i integer;\nBEGIN\n"
             "  FOREACH i IN ARRAY arr LOOP\n  " + self.GUARD + "  END LOOP;\n"),
            ("case", "BEGIN\n  CASE WHEN true THEN\n  " + self.GUARD
             + "  ELSE NULL;\n  END CASE;\n"),
            ("nested_begin", "BEGIN\n  BEGIN\n  " + self.GUARD + "  END;\n"),
            ("handler", "BEGIN\n  NULL;\nEXCEPTION WHEN unique_violation THEN\n"
             + self.GUARD),
        ):
            with self.subTest(construct=name):
                self.assertTrue(
                    self.verdict(f"ctl_{name}",
                                 self.routine(body + self.PRIVILEGED_WRITE)),
                    f"a guard inside `{name}` stopped being rejected",
                )

    def test_every_real_raise_spelling_still_denies(self) -> None:
        for i, raise_stmt in enumerate((
            "RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED'",
            "RAISE EXCEPTION SQLSTATE 'P0001'",
            "RAISE EXCEPTION 'x' USING ERRCODE = 'P0001'",
            "RAISE insufficient_privilege",
            "RAISE EXCEPTION '%', 'denied'",
        )):
            with self.subTest(spelling=raise_stmt):
                self.assertEqual(
                    self.verdict(
                        f"deny_{i}",
                        self.routine(
                            "BEGIN\n"
                            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                            f"    {raise_stmt};\n  END IF;\n"
                            + self.PRIVILEGED_WRITE
                        ),
                    ),
                    [],
                    f"`{raise_stmt}` stopped denying",
                )


class Round20CorpusTests(_Round20Base):
    """The reviewed corpus, through the Round-20 lexer."""

    def test_numbered_migrations_122_to_191_stay_clean(self) -> None:
        root = pathlib.Path(__file__).resolve().parents[2] / "sql" / "migrations"
        files = sorted(
            p for p in root.glob("*.sql")
            if p.name[:3].isdigit() and 122 <= int(p.name[:3]) <= 191
        )
        self.assertEqual(len(files), 61, "the reviewed sweep changed size")
        findings = {p.name: guards.check_file(p) for p in files}
        self.assertEqual(
            {name: out for name, out in findings.items() if out}, {},
            "the 122-191 sweep stopped being clean",
        )


# ---------------------------------------------------------------------------
# Round 21: lexical ownership and structural ownership
# ---------------------------------------------------------------------------
# Three independent Round-20 reviewers reported four P1 parser defects on head
# 7f407386bf30bbac3fe2a09623a1f0fb79d98a5c. They are two root causes.
#
# ROOT CAUSE A - a structural keyword MATCH was treated as structural
# OWNERSHIP. `_control_frames()` mutated frame state from token TEXT alone.
#   A1 (Codex): `BEGIN`, `IF` and `LOOP` are UNRESERVED in PostgreSQL, so a
#     bare SQL column named `begin` pushed a BEGIN frame. The EXCEPTION section
#     then attached to that fake frame instead of the real block, the real
#     block was left handler-less and dropped as unclosed, and an assertion the
#     handler demonstrably swallows was reported as a live authorization
#     boundary.
#   A2 (Grok): a reserved-looking word after a dot is an ordinary SQL
#     identifier. `t.end`, `t . end` and `(t).end` all popped a live frame.
#
# ROOT CAUSE B - Python's lexical classes were used where PostgreSQL's were
# meant.
#   B1 (Claude): multi-word structural patterns were spelled `END\s+IF`.
#     Measured on 17.11, 23 of the 29 code points Python's `\s` matches are NOT
#     PostgreSQL whitespace and 19 of those are PostgreSQL identifier
#     CONTINUATION characters, so `END IF` - ONE identifier - read as the
#     structural token `END IF`.
#   B2 (Grok): `_is_escape_string()` decided whether `E` before a quote was a
#     literal prefix with `str.isalnum() or "_"`, which is narrower than
#     ident_cont. An identifier ending in `E` therefore masked an ordinary
#     literal as an E-string and swallowed the executable text behind it.
#
# Every fixture below was compiled on PostgreSQL 17.11 before any scanner
# assertion was trusted, and the acceptance cases were run to prove the runtime
# semantics the verdict is supposed to model.


#: BEGIN/EXCEPTION, IF, LOOP, CASE and DECLARE, real and nested. `True` = the guard is a live outer-level boundary.
_R21_REAL_STRUCTURE = (
    (
        'begin_exception_handler_swallows',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\nEXCEPTION WHEN OTHERS THEN\n  NULL;\n',
        False,
    ),
    (
        'nested_begin_guard_outer',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  BEGIN\n    v_x := 1;\n  END;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'nested_begin_guard_inner',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  BEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  END;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        False,
    ),
    (
        'nested_exception_inner_swallows',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  BEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  EXCEPTION WHEN OTHERS THEN\n    NULL;\n  END;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        False,
    ),
    (
        'nested_exception_outer_only',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  BEGIN\n    v_x := 1;\n  EXCEPTION WHEN unique_violation THEN\n    NULL;\n  END;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'if_then_elsif_else_end_if',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  IF v_x = 1 THEN\n    v_x := 1;\n  ELSIF v_x = 2 THEN\n    v_x := 2;\n  ELSE\n    v_x := 3;\n  END IF;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'guard_inside_if_is_conditional',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  IF v_x IS NULL THEN\n    PERFORM public.wardah_assert_org_member(p_org);\n  END IF;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        False,
    ),
    (
        'bare_loop',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  LOOP\n    EXIT;\n  END LOOP;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'while_loop',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  WHILE v_x IS NULL LOOP\n    EXIT;\n  END LOOP;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'for_loop',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  FOR v_x IN 1..3 LOOP\n    EXIT;\n  END LOOP;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'foreach_loop',
        'DECLARE\n  v_x integer;\n  v_a integer[] := ARRAY[1,2];\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  FOREACH v_x IN ARRAY v_a LOOP\n    EXIT;\n  END LOOP;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'guard_inside_loop_is_nested',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  LOOP\n    PERFORM public.wardah_assert_org_member(p_org);\n    EXIT;\n  END LOOP;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        False,
    ),
    (
        'plpgsql_case_end_case',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  CASE v_x\n    WHEN 1 THEN v_x := 1;\n    ELSE v_x := 2;\n  END CASE;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'guard_inside_case_is_nested',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  CASE v_x\n    WHEN 1 THEN\n      PERFORM public.wardah_assert_org_member(p_org);\n    ELSE v_x := 2;\n  END CASE;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        False,
    ),
    (
        'outer_declare',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'nested_declare_block',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  DECLARE v_y integer;\n  BEGIN\n    v_y := 1;\n  END;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'labelled_declare_block',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  <<blk>>\n  DECLARE v_y integer;\n  BEGIN\n    v_y := 1;\n  END blk;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'declare_in_nested_block_position',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  IF v_x IS NULL THEN\n    DECLARE v_y integer;\n    BEGIN\n      v_y := 1;\n    END;\n  END IF;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
)


#: Every RAISE form, in the negated-predicate deny idiom. `True` = the branch really denies; the five non-aborting levels do not.
_R21_REAL_RAISE = (
    (
        'raise_exception_text',
        "RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';",
        True,
    ),
    (
        'raise_sqlstate',
        "RAISE SQLSTATE 'P0001';",
        True,
    ),
    (
        'raise_using',
        "RAISE EXCEPTION 'DENIED' USING ERRCODE = 'P0001';",
        True,
    ),
    (
        'raise_condition_name',
        'RAISE insufficient_privilege;',
        True,
    ),
    (
        'raise_format_only',
        "RAISE 'TENANT_MEMBERSHIP_REQUIRED';",
        True,
    ),
    (
        'raise_notice_is_not_a_deny',
        "RAISE NOTICE 'x';",
        False,
    ),
    (
        'raise_warning_is_not_a_deny',
        "RAISE WARNING 'x';",
        False,
    ),
    (
        'raise_info_is_not_a_deny',
        "RAISE INFO 'x';",
        False,
    ),
    (
        'raise_log_is_not_a_deny',
        "RAISE LOG 'x';",
        False,
    ),
    (
        'raise_debug_is_not_a_deny',
        "RAISE DEBUG 'x';",
        False,
    ),
)


#: EXCEPTION handler conditions. `True` = this handler does NOT catch the assertion, so the guard survives it.
_R21_HANDLERS = (
    (
        'when_others',
        'WHEN OTHERS THEN\n  NULL;\n',
        False,
    ),
    (
        'when_raise_exception',
        'WHEN raise_exception THEN\n  NULL;\n',
        False,
    ),
    (
        'when_sqlstate_P0001',
        "WHEN SQLSTATE 'P0001' THEN\n  NULL;\n",
        False,
    ),
    (
        'when_category_P0000',
        "WHEN SQLSTATE 'P0000' THEN\n  NULL;\n",
        False,
    ),
    (
        'when_plpgsql_error',
        'WHEN plpgsql_error THEN\n  NULL;\n',
        False,
    ),
    (
        'when_unique_violation',
        'WHEN unique_violation THEN\n  NULL;\n',
        True,
    ),
    (
        'when_unrelated_or_list',
        'WHEN unique_violation OR division_by_zero THEN\n  NULL;\n',
        True,
    ),
    (
        'when_catching_or_list',
        'WHEN unique_violation OR raise_exception THEN\n  NULL;\n',
        False,
    ),
)


#: 16 fresh composed fixtures, each compiled on PostgreSQL 17.11.
_R21_MUTANTS = (
    (
        'm01_sql_column_begin_before_exception',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n  v_x := (SELECT begin FROM public.t LIMIT 1);\nEXCEPTION WHEN OTHERS THEN\n  NULL;\n',
        False,
    ),
    (
        'm02_dotted_end_with_sql_case',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  v_x := (SELECT CASE WHEN t.end = 1 THEN 1 ELSE 0 END FROM public.t t LIMIT 1);\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'm03_dotted_end_before_exception',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n  v_x := (SELECT t.end FROM public.t LIMIT 1);\nEXCEPTION WHEN OTHERS THEN\n  NULL;\n',
        False,
    ),
    (
        'm04_dotted_begin_with_nested_begin',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  v_x := (SELECT t.begin FROM public.t LIMIT 1);\n  BEGIN\n    v_x := 1;\n  EXCEPTION WHEN OTHERS THEN\n    NULL;\n  END;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'm05_dotted_loop_with_real_loop',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  LOOP\n    PERFORM public.wardah_assert_org_member(p_org);\n  v_x := (SELECT t.loop FROM public.t LIMIT 1);\n    EXIT;\n  END LOOP;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        False,
    ),
    (
        'm06_dotted_case_with_sql_case',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  v_x := (SELECT CASE WHEN t.case = 1 THEN 1 ELSE 0 END FROM public.t t LIMIT 1);\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'm07_end_nbsp_if_one_identifier',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  IF v_x IS NULL THEN\n  v_x := (SELECT end\xa0if FROM public.t LIMIT 1);\n    PERFORM public.wardah_assert_org_member(p_org);\n  END IF;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        False,
    ),
    (
        'm08_end_ideographic_loop_one_identifier',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  LOOP\n  v_x := (SELECT end\u3000loop FROM public.t LIMIT 1);\n    PERFORM public.wardah_assert_org_member(p_org);\n    EXIT;\n  END LOOP;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        False,
    ),
    (
        'm09_estring_prefix_dollar_identifier',
        "DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  v_s := v$e'a\\';\n  RETURN;\n  -- don't reach here\n  PERFORM public.wardah_assert_org_member(p_org);\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n",
        False,
    ),
    (
        'm10_estring_prefix_nonascii_identifier',
        "DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  v_s := v\u0301e'a\\';\n  RETURN;\n  -- don't reach here\n  PERFORM public.wardah_assert_org_member(p_org);\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n",
        False,
    ),
    (
        'm11_dotted_structural_word_with_real_outer_raise',
        "DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  v_x := (SELECT t.exception FROM public.t LIMIT 1);\n  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n  PERFORM public.wardah_assert_org_member(p_org);\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n",
        False,
    ),
    (
        'm12_dotted_structural_word_with_standalone_perform',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  v_x := (SELECT t.then FROM public.t LIMIT 1);\n  PERFORM 1;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'm13_shift_expression_with_dotted_structural_identifier',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  v_x := (SELECT t.a << t.b >> t.end FROM public.t t LIMIT 1);\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'm14_labelled_block_beside_dotted_identifier',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  <<blk>>\n  BEGIN\n  v_x := (SELECT t.end FROM public.t LIMIT 1);\n  END blk;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
    (
        'm15_handler_with_estring_lexical_edge',
        "DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  v_s := v$e'a\\';\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\nEXCEPTION WHEN OTHERS THEN\n  NULL;\n",
        False,
    ),
    (
        'm16_nested_block_sql_case_whitespace_edge',
        'DECLARE\n  v_x integer;\n  v_s text;\nBEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n  BEGIN\n    v_x := (SELECT CASE WHEN t.c = 1 THEN 1 ELSE 0 END FROM public.t t LIMIT 1);\n  v_x := (SELECT end\xa0if FROM public.t LIMIT 1);\n  END;\n  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n',
        True,
    ),
)


class _Round21Base(unittest.TestCase):
    """Fixtures shared by the Round-21 classes.

    ORACLE, PostgreSQL 17.11 (`SELECT version()` = 17.11 on x86_64-pc-linux-gnu):

      * `_PG_WS` is EXACTLY PostgreSQL's lexical whitespace. Every one of the 29
        code points Python's `\\s` matches was fed to `SELECT<cp>1` and to
        `CREATE TEMP TABLE t AS SELECT 1 AS a<cp>b`; the six ASCII members of
        `_PG_WS` separated tokens and nothing else did.
      * NBSP and IDEOGRAPHIC_SPACE are identifier CONTINUATION characters:
        `a\\u00a0b` and `a\\u3000b` each came back from `pg_attribute` as ONE
        column name, as did `end\\u00a0if` and `end\\u3000loop`.
      * U+0301 continues an identifier too, and `str.isalnum()` says it does
        not - it is a combining mark, Unicode category Mn.
      * `v$e` and `v\\u0301e` are legal unquoted identifiers, so with a DOMAIN of
        either name `v$e'a\\'` is a type-prefixed constant whose literal is
        `a\\` - NOT an escape string.
    """

    NBSP = " "
    IDEOGRAPHIC = "　"
    ACUTE = "́"
    #: In Python's `\s` but NOT PostgreSQL whitespace, and PostgreSQL
    #: identifier continuation characters - the whole B1 wedge.
    PY_SPACE_IS_PG_IDENT_CONT = (
        "\u0085", " ", " ", " ", " ", " ", " ",
        " ", " ", " ", " ", " ", " ", " ",
        " ", " ", " ", " ", "　",
    )
    #: In Python's `\s`, not PostgreSQL whitespace, and not ident_cont either:
    #: PostgreSQL rejects these outright.
    PY_SPACE_IS_NOTHING_TO_PG = ("\u001c", "\u001d", "\u001e", "\u001f")
    #: Every word this scanner treats as structure. PostgreSQL accepts all 12
    #: after a dot, in all three spellings.
    STRUCTURAL_WORDS = (
        "end", "begin", "loop", "case", "if", "raise",
        "exception", "when", "return", "then", "else", "elsif",
    )
    QUALIFICATIONS = ("t.{w}", "t . {w}", "(t).{w}")

    GUARD = "  PERFORM public.wardah_assert_org_member(p_org);\n"
    PRIV = "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
    DECL = "DECLARE\n  v_x integer;\n  v_s text;\n"
    SEL = "  v_x := (SELECT {expr} FROM public.t LIMIT 1);\n"

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round21_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    def accepts(self, name: str, sql: str) -> bool:
        return self.verdict(name, sql) == []

    @staticmethod
    def routine(body: str) -> str:
        return (
            "CREATE FUNCTION public.probe_fn(p_org uuid)\n"
            "RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $body$\n"
            f"{body}"
            "END;\n"
            "$body$;\n"
        )

    @staticmethod
    def slug(text: str) -> str:
        return "".join(
            ch if ch.isalnum() or ch == "_" else f"u{ord(ch):x}" for ch in text
        )


class Round21LexicalPrimitiveTests(_Round21Base):
    """PARSER-INTERNAL. ONE authoritative source per lexical concept."""

    def test_the_file_spells_postgresql_whitespace_once(self) -> None:
        self.assertEqual(guards._PG_WS_CHARS, " \t\n\r\f\v")
        self.assertEqual(guards._PLPGSQL_WS, guards._PG_WS_CHARS)
        self.assertEqual(guards._PG_WS, re.escape(guards._PG_WS_CHARS))
        self.assertEqual(guards._WS1, f"[{guards._PG_WS}]+")
        self.assertEqual(guards._WS0, f"[{guards._PG_WS}]*")

    def test_the_regex_class_and_the_membership_twin_agree(self) -> None:
        """The two spellings were transcribed separately before Round 21. They
        are derived from one string now, so they cannot drift."""
        klass = re.compile(f"[{guards._PG_WS}]")
        for cp in range(0x110000):
            ch = chr(cp)
            self.assertEqual(
                bool(klass.match(ch)), ch in guards._PLPGSQL_WS,
                f"U+{cp:04X} disagrees between the class and the membership set",
            )

    def test_python_whitespace_is_not_postgresql_whitespace(self) -> None:
        """The measured difference, straight from the 17.11 oracle matrix."""
        py = {chr(c) for c in range(0x110000) if re.match(r"\s", chr(c))}
        pg = set(guards._PLPGSQL_WS)
        self.assertEqual(len(py), 29)
        self.assertTrue(pg < py)
        self.assertEqual(len(py - pg), 23)
        self.assertEqual(
            set(self.PY_SPACE_IS_PG_IDENT_CONT) | set(self.PY_SPACE_IS_NOTHING_TO_PG),
            py - pg,
        )

    def test_the_python_space_wedge_is_postgresql_identifier_continuation(self) -> None:
        """19 of those 23 CONTINUE a PostgreSQL identifier, which is what made
        `END\\s+IF` match text PostgreSQL reads as one identifier."""
        for ch in self.PY_SPACE_IS_PG_IDENT_CONT:
            with self.subTest(codepoint=f"U+{ord(ch):04X}"):
                self.assertTrue(guards._continues_identifier(ch, 0))
                self.assertNotIn(ch, guards._PLPGSQL_WS)
        for ch in self.PY_SPACE_IS_NOTHING_TO_PG:
            with self.subTest(codepoint=f"U+{ord(ch):04X}"):
                self.assertFalse(guards._continues_identifier(ch, 0))
                self.assertNotIn(ch, guards._PLPGSQL_WS)

    def test_ident_continuation_has_one_definition(self) -> None:
        """`_continues_identifier()` is the membership twin of `_IDENT_CONT`,
        and answers for a string and for the masker's list of characters
        alike."""
        for ch in ("a", "9", "_", "$", self.ACUTE, self.NBSP, "\U0001F600"):
            with self.subTest(char=repr(ch)):
                self.assertTrue(guards._continues_identifier(ch, 0))
                self.assertTrue(guards._continues_identifier([ch], 0))
        for ch in (" ", "\t", ".", "'", "(", "-"):
            with self.subTest(char=repr(ch)):
                self.assertFalse(guards._continues_identifier(ch, 0))
                self.assertFalse(guards._continues_identifier([ch], 0))
        self.assertFalse(guards._continues_identifier("abc", -1))
        self.assertFalse(guards._continues_identifier("abc", 3))

    def test_no_compiled_pattern_uses_a_python_lexical_class(self) -> None:
        """The Round-22 guard: no second alphabet may reappear.

        Every compiled pattern in the scanner is checked, not a chosen few, so a
        NEW security-bearing regex written with `\\s`, `\\b` or `\\w` fails here the
        moment it is added rather than in the next review round.
        """
        patterns = {
            name: value.pattern for name in dir(guards)
            if isinstance(value := getattr(guards, name), re.Pattern)
        }
        self.assertGreater(len(patterns), 60, "the scanner lost its patterns")
        for name, pattern in sorted(patterns.items()):
            for klass in (r"\s", r"\b", r"\w", r"\S", r"\W"):
                with self.subTest(pattern=name, klass=klass):
                    self.assertNotIn(
                        klass, pattern,
                        f"{name} defines a PostgreSQL lexical concept with "
                        f"Python's `{klass}`",
                    )

    def test_the_two_surviving_python_classes_are_class_a(self) -> None:
        """Both remaining occurrences are Class A - their input grammar cannot
        contain a PostgreSQL identifier or whitespace ambiguity:

          * `migration_cutoff:\\s*(\\d+)` reads the baseline manifest, which is
            project YAML, not PostgreSQL source.
          * `_CONDITION_NAME_RE` matches a PostgreSQL CONDITION name, and every
            name in that catalog is ASCII; a term containing anything else is
            not a condition name and PostgreSQL rejects the routine outright.

        Everything else - `\\b`, `str.isalnum()`, `str.isspace()` and every
        hand-written identifier walk - is gone from executable code.
        """
        source = pathlib.Path(guards.__file__).read_text(encoding="utf-8")
        code = "\n".join(
            line for line in source.splitlines()
            if not line.lstrip().startswith("#")
        )
        code = re.sub(r'"""(?:.|\n)*?"""', "", code)
        self.assertNotIn(".isalnum()", code)
        self.assertNotIn(".isspace()", code)
        self.assertEqual(
            code.count(r"\s"), 1,
            "a Python whitespace class came back into executable code",
        )
        self.assertIn(r"migration_cutoff:\s*", code)
        self.assertEqual(
            guards._CONDITION_NAME_RE.pattern, r"^[A-Za-z_][A-Za-z0-9_]*$"
        )

    def test_every_structural_pattern_uses_postgresql_whitespace(self) -> None:
        """The multiword patterns must mean keyword + PostgreSQL whitespace +
        keyword. The single-word ones carry no separator at all and are listed
        separately so the assertion stays exact for both."""
        ws = f"[{guards._PG_WS}]"
        multiword = (
            "_BLOCK_TOKEN_RE", "_NON_ABORTING_RAISE_RE", "_SECURITY_DEFINER_RE",
            "_SECURITY_INVOKER_RE", "_CREATE_ROUTINE_RE", "_ALTER_ROUTINE_RE",
            "_DEFAULT_PRIVILEGES_RE", "_ON_ROUTINE_RE",
            "_ON_ALL_ROUTINES_RE",
        )
        separator_only = (
            "_RAISE_BEFORE_RE", "_PERFORM_HEAD_RE", "_TRAILING_IDENT_RE",
            "GUARD_RE", "NEGATED_PREDICATE_RE",
        )
        for name in multiword + separator_only:
            with self.subTest(pattern=name):
                self.assertIn(
                    ws, getattr(guards, name).pattern,
                    f"{name} lost its PostgreSQL whitespace class",
                )
        self.assertEqual(
            guards._EXECUTE_PRIV_RE.pattern, guards._pg_kw("EXECUTE|ALL"),
            "the last Python word boundary must stay retired",
        )


class Round21WhitespacePatternTests(_Round21Base):
    """B1, end to end: a multiword structural token is keyword + PG whitespace."""

    def test_block_lexer_refuses_a_one_identifier_multiword_token(self) -> None:
        """PARSER-INTERNAL. `end<cp>if` is ONE identifier on 17.11 for all 19
        wedge code points; the block lexer must see no token in any of them."""
        for ch in self.PY_SPACE_IS_PG_IDENT_CONT:
            for keyword in ("IF", "LOOP", "CASE"):
                text = f"END{ch}{keyword}"
                with self.subTest(codepoint=f"U+{ord(ch):04X}", keyword=keyword):
                    self.assertTrue(
                        re.search(rf"END\s+{keyword}", text, re.IGNORECASE),
                        "the retired Python spelling should match - that is the bug",
                    )
                    self.assertIsNone(guards._BLOCK_TOKEN_RE.search(text))

    def test_block_lexer_still_reads_real_postgresql_separators(self) -> None:
        for sep in guards._PLPGSQL_WS:
            for keyword in ("IF", "LOOP", "CASE"):
                with self.subTest(codepoint=f"U+{ord(sep):04X}", keyword=keyword):
                    m = guards._BLOCK_TOKEN_RE.search(f"END{sep}{keyword}")
                    self.assertIsNotNone(m)
                    self.assertEqual(
                        " ".join(m.group(1).upper().split()), f"END {keyword}",
                    )
        for gap in ("  ", " \t ", "\n", " \n\t", "\r\n"):
            with self.subTest(gap=repr(gap)):
                m = guards._BLOCK_TOKEN_RE.search(f"END{gap}IF")
                self.assertIsNotNone(m)
                self.assertEqual(" ".join(m.group(1).upper().split()), "END IF")

    def test_a_fake_end_if_no_longer_frees_a_conditional_guard(self) -> None:
        """RED at 7f407386: ACCEPT. Oracle: `end\\u00a0if` is one column name,
        and calling the routine with the flag false reached the privileged
        UPDATE with the guard never executed."""
        for ch in self.PY_SPACE_IS_PG_IDENT_CONT:
            with self.subTest(codepoint=f"U+{ord(ch):04X}"):
                self.assertFalse(
                    self.accepts(
                        f"fake_end_if_{self.slug(ch)}",
                        self.routine(
                            self.DECL + "BEGIN\n"
                            "  IF v_x IS NULL THEN\n"
                            + self.SEL.format(expr=f"end{ch}if")
                            + "  " + self.GUARD
                            + "  END IF;\n" + self.PRIV
                        ),
                    ),
                    "a one-identifier END IF popped a live IF frame and the "
                    "conditional guard was credited at outer statement level",
                )


class Round21EscapeStringPrefixTests(_Round21Base):
    """B2: the E-string prefix boundary is PostgreSQL's ident_cont."""

    def test_a_real_escape_string_is_still_one(self) -> None:
        for prefix in ("E", "e"):
            for lead in ("", " ", "(", ",", "=", "||", "\t", "\n"):
                sql = f"{lead}{prefix}'x'"
                with self.subTest(prefix=prefix, lead=repr(lead)):
                    self.assertTrue(
                        guards._is_escape_string(sql, sql.index("'")),
                        "a genuine E'' literal stopped being an escape string",
                    )

    def test_an_identifier_ending_in_e_is_not_a_prefix(self) -> None:
        """Every one of these is ONE identifier on 17.11, so the quote after it
        opens an ordinary literal."""
        for ident in (
            "v$e", "ve", "v_e", "v9e", "abce", "x$$e", "raise",
            f"v{self.ACUTE}e", f"v{self.NBSP}e", "v​e", "v\U0001F600e",
        ):
            sql = f"{ident}'a'"
            with self.subTest(identifier=ident):
                self.assertFalse(
                    guards._is_escape_string(sql, sql.index("'")),
                    f"`{ident}` ends in E but is one identifier, not a prefix",
                )

    def test_the_retired_boundary_disagreed_exactly_where_it_mattered(self) -> None:
        """PARSER-INTERNAL. `str.isalnum() or "_"` and ident_cont differ on `$`
        and on every non-ASCII code point outside L*/N* - which is the whole
        attack surface."""
        for ch in ("$", self.ACUTE, "​", "·", self.NBSP):
            with self.subTest(char=f"U+{ord(ch):04X}"):
                self.assertFalse(ch.isalnum() or ch == "_")
                self.assertTrue(guards._continues_identifier(ch, 0))

    def test_a_masked_literal_no_longer_swallows_a_terminating_return(self) -> None:
        """RED at 7f407386: ACCEPT. Both routines compile on 17.11; the RETURN
        ends the invocation, so the guard behind it is dead code."""
        for label, ident in (("dollar", "v$e"), ("nonascii", f"v{self.ACUTE}e")):
            with self.subTest(identifier=ident):
                self.assertFalse(
                    self.accepts(
                        f"estring_prefix_{label}",
                        self.routine(
                            self.DECL + "BEGIN\n"
                            f"  v_s := {ident}'a\\';\n"
                            "  RETURN;\n"
                            "  -- don't reach here\n"
                            + self.GUARD + self.PRIV
                        ),
                    ),
                    "an ordinary literal was masked as an E-string and hid the "
                    "RETURN that makes the guard dead",
                )

    def test_chained_literal_behaviour_is_preserved(self) -> None:
        """Round 13's quote-continuation rule still holds through the new
        boundary."""
        self.assertTrue(
            self.accepts(
                "chained_literal_still_reads",
                self.routine(
                    self.DECL + "BEGIN\n" + self.GUARD
                    + "  v_s := 'a'\n         'b';\n" + self.PRIV
                ),
            )
        )


class Round21QualifiedIdentifierTests(_Round21Base):
    """A2: one rule - SQL `.` qualification never owns PL/pgSQL structure."""

    def test_the_rule_is_shared_by_every_structural_word(self) -> None:
        """PARSER-INTERNAL. Not END alone: all 12 words this scanner treats as
        structure are accepted after a dot by PostgreSQL 17.11, in all three
        spellings."""
        for word in self.STRUCTURAL_WORDS:
            for shape in self.QUALIFICATIONS:
                expr = shape.format(w=word)
                body = f"  v_x := (SELECT {expr} FROM public.t LIMIT 1);\n"
                pos = body.lower().rindex(word)
                with self.subTest(expression=expr):
                    self.assertTrue(
                        guards._is_sql_qualified(body, pos),
                        f"`{expr}` is a qualified SQL name, not PL/pgSQL structure",
                    )

    def test_real_structural_keywords_are_not_qualified(self) -> None:
        body = (
            "BEGIN\n  IF v_x IS NULL THEN\n    LOOP\n      EXIT;\n"
            "    END LOOP;\n  END IF;\nEXCEPTION WHEN OTHERS THEN\n  RAISE;\nEND;\n"
        )
        for m in guards._BLOCK_TOKEN_RE.finditer(body):
            with self.subTest(token=m.group(1)):
                self.assertFalse(guards._is_sql_qualified(body, m.start()))

    def test_a_dotted_end_no_longer_detaches_a_handler(self) -> None:
        """RED at 7f407386: ACCEPT for all three spellings. Oracle: the guard
        raises when called directly, while the SECURITY DEFINER routine returns
        normally - the handler really does swallow it."""
        for shape in self.QUALIFICATIONS:
            expr = shape.format(w="end")
            with self.subTest(expression=expr):
                self.assertFalse(
                    self.accepts(
                        f"dotted_end_{self.slug(expr)}",
                        self.routine(
                            self.DECL + "BEGIN\n" + self.GUARD + self.PRIV
                            + self.SEL.format(expr=expr)
                            + "EXCEPTION WHEN OTHERS THEN\n  NULL;\n"
                        ),
                    ),
                    f"`{expr}` popped the enclosing BEGIN and hid its handler",
                )

    def test_a_dotted_end_no_longer_steals_a_case_frame(self) -> None:
        self.assertFalse(
            self.accepts(
                "dotted_end_steals_case",
                self.routine(
                    self.DECL + "BEGIN\n"
                    "  CASE v_x\n    WHEN 1 THEN\n    " + self.GUARD
                    + self.SEL.format(expr="t.end")
                    + "    ELSE v_x := 2;\n  END CASE;\n" + self.PRIV
                ),
            ),
            "a qualified `t.end` closed the CASE and lifted a nested guard to "
            "the outer statement level",
        )


class Round21FrameOwnershipTests(_Round21Base):
    """A1: a frame is pushed only when the token is PROVEN to open one."""

    def test_a_bare_sql_column_named_begin_pushes_no_frame(self) -> None:
        """RED at 7f407386: ACCEPT. `SELECT begin FROM t` runs on 17.11 -
        `begin` is UNRESERVED - and the handler swallows the assertion, but the
        fake frame took the handler away from the real block."""
        self.assertFalse(
            self.accepts(
                "sql_column_begin_before_exception",
                self.routine(
                    self.DECL + "BEGIN\n" + self.GUARD + self.PRIV
                    + self.SEL.format(expr="begin")
                    + "EXCEPTION WHEN OTHERS THEN\n  NULL;\n"
                ),
            ),
            "a SQL column named `begin` manufactured a BEGIN frame and a "
            "swallowed assertion read as live",
        )

    def test_no_unreserved_opener_is_taken_on_its_word_alone(self) -> None:
        """PARSER-INTERNAL, and the reason this is not three special cases:
        BEGIN, IF and LOOP are each unreserved, and each is refused where an
        expression - not a statement - is what stands before it."""
        for token in ("BEGIN", "IF", "LOOP"):
            body = f"  v_x := (SELECT {token.lower()} FROM public.t LIMIT 1);\n"
            pos = body.lower().index(token.lower())
            with self.subTest(token=token):
                self.assertFalse(guards._owns_control_frame(body, token, pos))

    def test_case_needs_no_position_proof(self) -> None:
        """PARSER-INTERNAL. `case` is RESERVED, so it is never a bare column
        name; an embedded SQL CASE is a real CASE frame, which is exactly why a
        bare END closes one."""
        body = "  v_x := (SELECT CASE WHEN true THEN 1 ELSE 0 END FROM t);\n"
        self.assertTrue(
            guards._owns_control_frame(body, "CASE", body.index("CASE"))
        )

    def test_every_real_opener_is_still_owned(self) -> None:
        """The fail-OPEN direction for the frame model is DROPPING a frame
        PostgreSQL really opens: the construct's own closer then pops somebody
        else's. Each real opener below is proved, so none is dropped."""
        openers = {
            "body start": ("$body$\nBEGIN\n  PERFORM 1;\nEND;\n", "BEGIN", 1),
            "after DECLARE": ("$body$\nDECLARE v int;\nBEGIN\n  PERFORM 1;\nEND;\n", "BEGIN", 1),
            "after ;": ("$body$\nBEGIN\n  PERFORM 1;\n  BEGIN\n  END;\nEND;\n", "BEGIN", 2),
            "after THEN": ("$body$\nBEGIN\n  IF x THEN\n    BEGIN\n    END;\n  END IF;\nEND;\n", "BEGIN", 2),
            "after ELSE": ("$body$\nBEGIN\n  IF x THEN\n    NULL;\n  ELSE\n    BEGIN\n    END;\n  END IF;\nEND;\n", "BEGIN", 2),
            "after LOOP": ("$body$\nBEGIN\n  LOOP\n    BEGIN\n    END;\n    EXIT;\n  END LOOP;\nEND;\n", "BEGIN", 2),
            "in a handler": ("$body$\nBEGIN\n  PERFORM 1;\nEXCEPTION WHEN OTHERS THEN\n  BEGIN\n  END;\nEND;\n", "BEGIN", 2),
            "after a label": ("$body$\nBEGIN\n  <<blk>>\n  BEGIN\n  END blk;\nEND;\n", "BEGIN", 2),
            "IF after BEGIN": ("$body$\nBEGIN\n  IF x THEN\n    NULL;\n  END IF;\nEND;\n", "IF", 1),
            "bare LOOP": ("$body$\nBEGIN\n  LOOP\n    EXIT;\n  END LOOP;\nEND;\n", "LOOP", 1),
            "WHILE LOOP": ("$body$\nBEGIN\n  WHILE x LOOP\n    EXIT;\n  END LOOP;\nEND;\n", "LOOP", 1),
            "FOR LOOP": ("$body$\nBEGIN\n  FOR i IN 1..3 LOOP\n    EXIT;\n  END LOOP;\nEND;\n", "LOOP", 1),
            "FOREACH LOOP": ("$body$\nBEGIN\n  FOREACH v IN ARRAY a LOOP\n    EXIT;\n  END LOOP;\nEND;\n", "LOOP", 1),
            "labelled WHILE LOOP": ("$body$\nBEGIN\n  <<lp>>\n  WHILE x LOOP\n    EXIT;\n  END LOOP;\nEND;\n", "LOOP", 1),
        }
        for label, (body, token, nth) in openers.items():
            pos, found = -1, 0
            for m in re.finditer(guards._pg_kw(token), body, re.IGNORECASE):
                before = body[:m.start()].rstrip().upper()
                if token in ("IF", "LOOP") and before.endswith("END"):
                    continue
                found += 1
                if found == nth:
                    pos = m.start()
                    break
            with self.subTest(opener=label):
                self.assertGreaterEqual(pos, 0, "fixture did not contain the opener")
                self.assertTrue(
                    guards._owns_control_frame(body, token, pos),
                    f"a real {token} at `{label}` was dropped",
                )

    def test_frame_ownership_terminates(self) -> None:
        """`_owns_control_frame()` reaches `_opens_block_position()` with the
        LEXICAL ownership test, which reads no frames - so the walk that BUILDS
        the frames cannot re-enter itself. Every step also moves strictly left,
        so a chain of BEGINs terminates."""
        body = "$body$\n" + "BEGIN\n" * 200 + "  PERFORM 1;\n" + "END;\n" * 200
        pos = body.rindex("BEGIN")
        self.assertTrue(guards._owns_control_frame(body, "BEGIN", pos))
        self.assertTrue(guards.parse_blocks(body) is not None)

    def test_an_exception_identifier_does_not_open_a_handler(self) -> None:
        """`exception` is not a SQL keyword at all, so `SELECT exception FROM t`
        runs on 17.11."""
        body = "  v_x := (SELECT exception FROM public.t LIMIT 1);\n"
        self.assertFalse(
            guards._opens_frame_position(body, body.index("exception"))
        )
        for real in (
            "$body$\nBEGIN\n  PERFORM 1;\nEXCEPTION WHEN OTHERS THEN\n  NULL;\nEND;\n",
            "$body$\nBEGIN\nEXCEPTION WHEN OTHERS THEN\n  NULL;\nEND;\n",
        ):
            with self.subTest(body=real.splitlines()[2]):
                self.assertTrue(
                    guards._opens_frame_position(real, real.index("EXCEPTION"))
                )


class Round21RealStructureTests(_Round21Base):
    """No real construct lost its meaning. Every fixture compiles on 17.11."""

    def test_real_structural_controls(self) -> None:
        for name, body, must_accept in _R21_REAL_STRUCTURE:
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(f"struct_{name}", self.routine(body)),
                    must_accept,
                    f"`{name}` changed verdict",
                )

    def test_real_raise_controls(self) -> None:
        for name, stmt, is_deny in _R21_REAL_RAISE:
            body = (
                self.DECL + "BEGIN\n"
                "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                f"    {stmt}\n"
                "  END IF;\n" + self.PRIV
            )
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(f"raise_{name}", self.routine(body)), is_deny,
                    f"`{name}` changed which side of the deny boundary it is on",
                )

    def test_a_bare_raise_in_a_handler_still_reraises(self) -> None:
        """A bare RAISE re-raises, but the handler still ran, so the guard it
        catches is not an outer-level boundary."""
        self.assertFalse(
            self.accepts(
                "bare_raise_in_handler",
                self.routine(
                    self.DECL + "BEGIN\n" + self.GUARD + self.PRIV
                    + "EXCEPTION WHEN OTHERS THEN\n  RAISE;\n"
                ),
            )
        )


class Round21SwallowingMatrixTests(_Round21Base):
    """A catcher PostgreSQL really applies stays enclosing in the model."""

    def test_handler_condition_matrix(self) -> None:
        """Round 26: every handler here is `NULL;` on a block that DECLARES
        variables, and a handler that completes normally there is refused
        whatever it catches - declarations are initialized outside the
        subtransaction the handler rolls back (see `handler_can_run_unauthorized`).
        So the swallowing question is asked of the same handler re-raising with
        a bare `RAISE;`, which Round 26 proves inert, and the `NULL;` form is
        pinned as refused for every condition."""
        for name, handler, must_accept in _R21_HANDLERS:
            body = self.DECL + "BEGIN\n" + self.GUARD + self.PRIV + "EXCEPTION " + handler
            reraise = body.replace("THEN\n  NULL;\n", "THEN\n  RAISE;\n")
            with self.subTest(case=name):
                self.assertNotEqual(reraise, body)
                self.assertEqual(
                    self.accepts(f"handler_{name}", self.routine(reraise)),
                    must_accept,
                    f"`{name}` changed whether it swallows the assertion",
                )
                self.assertFalse(
                    self.accepts(f"handler_{name}_null", self.routine(body)),
                    f"`{name}`: a normally-completing handler on a declaring "
                    "block was accepted",
                )

    def test_a_nested_handler_still_swallows(self) -> None:
        self.assertFalse(
            self.accepts(
                "nested_handler_swallows",
                self.routine(
                    self.DECL + "BEGIN\n  BEGIN\n" + self.GUARD
                    + "  EXCEPTION WHEN OTHERS THEN\n    NULL;\n  END;\n" + self.PRIV
                ),
            )
        )

    def test_a_fake_token_cannot_detach_a_real_catcher(self) -> None:
        """The two Round-21 shapes, on the handler analysis rather than on the
        frame stack alone."""
        for name, expr in (
            ("sql_identifier_begin", "begin"),
            ("dotted_identifier_end", "t.end"),
        ):
            with self.subTest(case=name):
                self.assertFalse(
                    self.accepts(
                        f"detach_{name}",
                        self.routine(
                            self.DECL + "BEGIN\n" + self.GUARD + self.PRIV
                            + self.SEL.format(expr=expr)
                            + "EXCEPTION WHEN OTHERS THEN\n  NULL;\n"
                        ),
                    ),
                    f"`{expr}` detached a catcher PostgreSQL really applies",
                )


class Round21ComposedMutantTests(_Round21Base):
    """Fresh PostgreSQL-17.11-valid compositions, not spacing variants."""

    def test_composed_mutants(self) -> None:
        self.assertEqual(len(_R21_MUTANTS), 16)
        for name, body, must_accept in _R21_MUTANTS:
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(name, self.routine(body)), must_accept,
                    f"`{name}` changed verdict",
                )


class Round21CorpusTests(_Round21Base):
    """The reviewed corpus, through the Round-21 lexer and frame model."""

    def test_numbered_migrations_122_to_191_stay_clean(self) -> None:
        root = pathlib.Path(__file__).resolve().parents[2] / "sql" / "migrations"
        files = sorted(
            p for p in root.glob("*.sql")
            if p.name[:3].isdigit() and 122 <= int(p.name[:3]) <= 191
        )
        self.assertEqual(len(files), 61, "the reviewed sweep changed size")
        self.assertEqual(
            {p.name: out for p in files if (out := guards.check_file(p))}, {},
            "the 122-191 sweep stopped being clean",
        )

# ---------------------------------------------------------------------------
# Round 22: the BEGIN that OWNS a declaration section
# ---------------------------------------------------------------------------
# Three independent Round-21 reviews converged on one remaining root cause: the
# scanner equated
#
#     the first textual BEGIN after DECLARE
#
# with
#
#     the BEGIN that actually opens THAT PL/pgSQL block.
#
# Those are not the same offset. A declaration's initializer is an ordinary SQL
# expression, `begin` is UNRESERVED in PostgreSQL, and the masker keeps
# executable identifiers by design - it blanks comments and literal CONTENT and
# nothing else. So a declaration can legally SPELL the keyword, and every form
# below compiles on the 17.11 oracle:
#
#     x integer := (SELECT begin FROM t LIMIT 1);
#     x integer := (SELECT 1 AS begin);
#     x integer := (SELECT t.begin FROM t t LIMIT 1);
#     x integer := (SELECT (t).begin FROM t t LIMIT 1);
#     c CURSOR FOR SELECT begin FROM t;        -- at paren depth 0
#
# The same wrong premise lived in TWO security-bearing consumers, which is why
# this is one root cause and not two patches:
#
#   _declaration_spans()  truncated the section at the fake `begin`, so a later
#   declaration fell OUT of it. `raise integer := 2;` - a variable declaration
#   PostgreSQL never executes - was then read as an abort, and an IF denial
#   branch that raises nothing looked like it aborts.
#
#   _labelled_opener()    attached the block label to the fake `begin`, so the
#   REAL BEGIN frame carried no label. `EXIT auth_block;` then stopped making a
#   later PERFORM guard unreachable, and a dead assertion counted as live.
#
# Both now ask ONE resolver, `_owned_section_begin()`. The classes below pin the
# grammar it rests on, both wrong-ACCEPT directions, the wrong-REJECT mirror,
# the label offsets themselves, and the opposite direction - that the real block
# opener is never skipped.
class _Round22Base(unittest.TestCase):
    """Fixtures shared by the Round-22 classes.

    ORACLE, PostgreSQL 17.11 (`SELECT version()` = 17.11 on x86_64-pc-linux-gnu,
    disposable local cluster). Every fixture in these classes was COMPILED, and
    every one with a stated runtime claim was also RUN, against a schema holding

        CREATE TABLE public.t ("begin" integer, "end" integer, a integer);
        CREATE TABLE public.bins (actual_qty integer, org_id uuid);

    plus `wardah_assert_org_member(uuid)` raising P0001 and
    `wardah_is_org_member(uuid)` returning false, so "non-member" is the
    executed path.

    Measured grammar facts the resolver rests on:

      * `DECLARE BEGIN ... END` compiles - an EMPTY declaration list is legal,
        so the opening BEGIN may stand at the section start itself.
      * `DECLARE begin integer := 1;` does NOT compile ("integer" is not a known
        variable): BEGIN is reserved to PL/pgSQL, so no declaration can be NAMED
        begin. A depth-0 `begin` at a declaration boundary is therefore always
        the block opener.
      * Every declaration ends with `;`, so the opening BEGIN is always preceded
        - modulo whitespace and already-masked comments - by either the DECLARE
        keyword or that `;`.
      * `SELECT 1 AS <word>` accepts every structural word including the
        RESERVED ones (end, case, when, then, else), because ColLabel takes any
        keyword; a BARE column of a reserved word does not parse.
    """

    GUARD = f"  PERFORM {OUTER}(p_org);\n"
    PRIV = f"{WORK_LINE}\n"
    #: The smallest fake: `begin` as a column LABEL inside a scalar subquery.
    FAKE = "(SELECT 1 AS begin)"

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round22_{self.slug(name)}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    def accepts(self, name: str, sql: str) -> bool:
        return self.verdict(name, sql) == []

    @staticmethod
    def slug(text: str) -> str:
        return "".join(
            ch if ch.isalnum() or ch == "_" else f"u{ord(ch):x}" for ch in text
        )

    @staticmethod
    def routine(body: str, close: str = "END;\n") -> str:
        """A SECURITY DEFINER routine whose body text is exactly `body`.

        `close` is separate because the labelled fixtures close with
        `END auth_block;`, which is the whole point of those cases.
        """
        return (
            "CREATE OR REPLACE FUNCTION public.f_probe(p_org uuid)\n"
            "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER\n"
            "SET search_path TO 'public', 'pg_temp'\n"
            f"AS $function$\n{body}{close}$function$;\n"
        )

    def deny_branch(self, declarations: str, inner: str = "      v_x := v_x;\n") -> str:
        """RED A's shape: the denial branch holds a nested DECLARE block.

        On 17.11 this routine raises NOTHING for a non-member - the `raise`
        declaration is an ordinary integer variable - so the UPDATE that follows
        runs unauthorized. The scanner must REJECT it.
        """
        return (
            "BEGIN\n"
            f"  IF NOT {QPRED}(p_org) THEN\n"
            "    DECLARE\n" + declarations +
            "    BEGIN\n" + inner +
            "    END;\n"
            "  END IF;\n" + self.PRIV
        )

    def mirror(self, initializer: str) -> str:
        """RED B's shape: the SAME initializer, with a real standalone guard.

        On 17.11 this DENIES a non-member - the guard raises
        TENANT_MEMBERSHIP_REQUIRED and the UPDATE does not run - so the scanner
        must ACCEPT it.
        """
        return (
            "DECLARE\n"
            f"  v_x integer := {initializer};\n"
            "  raise integer := 2;\n"
            "BEGIN\n" + self.GUARD + self.PRIV
        )

    def labelled(self, initializer: str | None, exit_line: str) -> str:
        """RED C's shape: `<<auth_block>> DECLARE ... BEGIN ... END auth_block`.

        On 17.11 the write happens and the EXIT skips the PERFORM entirely, so
        no assertion executes and the scanner must REJECT.
        """
        declare = (
            f"DECLARE\n  v_x integer := {initializer};\n"
            if initializer is not None else ""
        )
        return (
            "<<auth_block>>\n" + declare + "BEGIN\n" + self.PRIV
            + exit_line + self.GUARD
        )

    @staticmethod
    def masked(text: str) -> str:
        return guards.mask_sql_checked(text)[0]


#: The initializer matrix. Every entry COMPILES on 17.11 inside
#: `DECLARE v_x integer := <form>;` and spells a `begin` the masker preserves,
#: yet none of them opens a block.
R22_FAKE_INITIALIZERS = {
    "scalar_subquery_bare_column": "(SELECT begin FROM public.t LIMIT 1)",
    "column_label_alias": "(SELECT 1 AS begin)",
    "qualified_column": "(SELECT t.begin FROM public.t t LIMIT 1)",
    "composite_field": "(SELECT (t).begin FROM public.t t LIMIT 1)",
    "spaced_qualified_column": "(SELECT t . begin FROM public.t t LIMIT 1)",
    "repeated_parentheses": "((( SELECT begin FROM public.t LIMIT 1 )))",
    "block_comment_before_identifier": "(SELECT /* c */ begin FROM public.t LIMIT 1)",
    "line_comment_then_newline": "(SELECT -- c\n     begin FROM public.t LIMIT 1)",
    "function_call_around_subquery": "abs((SELECT begin FROM public.t LIMIT 1))",
    "two_scalar_subqueries": (
        "((SELECT begin FROM public.t LIMIT 1) + (SELECT 1 AS begin))"
    ),
    "cast_around_subquery": "((SELECT begin FROM public.t LIMIT 1))::integer",
}

#: Declarations that put the fake `begin` at paren depth ZERO, so nesting alone
#: cannot refuse them. Both compile on 17.11.
R22_DEPTH0_FAKE_DECLARATIONS = {
    "cursor_bare_column": "c CURSOR FOR SELECT begin FROM public.t;",
    "cursor_column_label": "c CURSOR FOR SELECT 1 AS begin;",
}


class Round22DeclarationGrammarTests(_Round22Base):
    """PARSER-INTERNAL. The grammar facts `_owned_section_begin()` rests on.

    These assert the RESOLVER directly, on offsets, because a verdict cannot say
    WHICH BEGIN was chosen - and choosing the wrong one is the whole defect.
    """

    def resolve(self, section: str) -> int | None:
        """Resolve the opener for the FIRST DECLARE in `section`."""
        body = self.masked(section)
        match = guards._DECLARE_TOKEN_RE.search(body)
        self.assertIsNotNone(match, "fixture has no DECLARE")
        return guards._owned_section_begin(body, match.end())

    def assert_opener_is(self, section: str, occurrence: int = -1) -> int:
        """The resolver must land on the LAST `begin` spelling, which in every
        fixture here is the real block opener; `occurrence` picks another."""
        body = self.masked(section)
        hits = [m.start() for m in guards._SECTION_BEGIN_RE.finditer(body)]
        self.assertTrue(hits, "fixture spells no BEGIN at all")
        got = self.resolve(section)
        self.assertEqual(got, hits[occurrence], f"wrong BEGIN chosen in:\n{section}")
        return got

    def test_empty_declaration_list_opens_at_the_section_start(self) -> None:
        """`DECLARE BEGIN ... END` compiles on 17.11, so the opener may stand
        directly after the keyword with no `;` before it."""
        self.assert_opener_is("DECLARE\nBEGIN\n  PERFORM 1;\nEND;\n")

    def test_a_comment_between_declare_and_begin_is_still_the_empty_list(self) -> None:
        self.assert_opener_is("DECLARE /* nothing here */\nBEGIN\n  PERFORM 1;\nEND;\n")

    def test_every_ordinary_declaration_shape_reaches_its_own_begin(self) -> None:
        """One declaration, several, and each type-spelling form. All compile."""
        for name, declarations in {
            "one": "  x integer;\n",
            "several": "  x integer;\n  y text;\n  z numeric(10,2);\n",
            "initialized": "  x integer := 1;\n",
            "constant": "  x CONSTANT integer := 1;\n",
            "alias_for": "  a ALIAS FOR p_org;\n",
            "pct_type": "  x public.t.a%TYPE;\n",
            "pct_rowtype": "  r public.t%ROWTYPE;\n",
            "custom_type": "  u uuid := p_org;\n",
            "array_bound": "  arr integer[3];\n",
            "default_keyword": "  x integer DEFAULT 1;\n",
        }.items():
            with self.subTest(declaration=name):
                self.assert_opener_is(f"DECLARE\n{declarations}BEGIN\n  PERFORM 1;\nEND;\n")

    def test_an_initializer_that_spells_begin_never_ends_the_section(self) -> None:
        """The matrix, at the resolver. The LAST `begin` is the real opener in
        each; every earlier one is expression text."""
        for name, initializer in R22_FAKE_INITIALIZERS.items():
            with self.subTest(form=name):
                self.assert_opener_is(
                    f"DECLARE\n  v_x integer := {initializer};\nBEGIN\n  PERFORM 1;\nEND;\n"
                )

    def test_a_depth_zero_fake_begin_never_ends_the_section(self) -> None:
        """Paren depth alone cannot refuse these: the fake `begin` in a cursor
        declaration stands at depth 0. The `;` boundary rule is what refuses it."""
        for name, declaration in R22_DEPTH0_FAKE_DECLARATIONS.items():
            with self.subTest(form=name):
                self.assert_opener_is(
                    f"DECLARE\n  {declaration}\nBEGIN\n  PERFORM 1;\nEND;\n"
                )

    def test_the_fake_begin_position_among_declarations_does_not_matter(self) -> None:
        for name, declarations in {
            "first": f"  v_x integer := {self.FAKE};\n  v_b integer := 1;\n",
            "middle": f"  v_a integer := 1;\n  v_x integer := {self.FAKE};\n  v_b integer := 2;\n",
            "last": f"  v_a integer := 1;\n  v_x integer := {self.FAKE};\n",
        }.items():
            with self.subTest(position=name):
                self.assert_opener_is(f"DECLARE\n{declarations}BEGIN\n  PERFORM 1;\nEND;\n")

    def test_a_section_that_never_reaches_a_real_begin_resolves_to_nothing(self) -> None:
        """Fail CLOSED: an unterminated section is not ended at a fake `begin`.
        `_declaration_spans()` then runs the span to the end of the body."""
        self.assertIsNone(
            self.resolve("DECLARE\n  v_x integer := (SELECT 1 AS begin);\n")
        )

    def test_the_resolver_is_the_only_declaration_begin_search(self) -> None:
        """ARCHITECTURAL. No second implementation of `find the BEGIN after
        DECLARE` may exist, or the two consumers drift apart again."""
        source = pathlib.Path(guards.__file__).read_text(encoding="utf-8")
        self.assertEqual(
            source.count("_BEGIN_KW_RE.search("), 0,
            "_BEGIN_KW_RE is a first-textual-BEGIN consumer again",
        )
        self.assertEqual(
            source.count("_SECTION_BEGIN_RE.finditer("), 1,
            "_SECTION_BEGIN_RE is read outside the shared resolver",
        )
        self.assertEqual(
            source.count("_SECTION_BEGIN_RE.search("), 0,
            "_SECTION_BEGIN_RE is searched outside the shared resolver",
        )
        resolver = inspect.getsource(guards._owned_section_begin)
        self.assertIn("_SECTION_BEGIN_RE.finditer(", resolver)
        for consumer in (guards._declaration_spans, guards._labelled_opener):
            with self.subTest(consumer=consumer.__name__):
                self.assertIn(
                    "_owned_section_begin(", inspect.getsource(consumer),
                    f"{consumer.__name__} no longer uses the shared resolver",
                )


class Round22SharedConsumerTests(_Round22Base):
    """PARSER-INTERNAL. The two consumers must resolve the SAME real BEGIN.

    `_declaration_spans()` ends its span there and `_labelled_opener()` attaches
    the label there. Before Round 22 both searched independently, which is how
    one root cause produced two separate wrong verdicts. This pins them to one
    offset so they cannot drift apart again.
    """

    def both_consumers(self, initializer: str) -> tuple[int, int, int]:
        body = self.masked(
            f"<<auth_block>>\nDECLARE\n  v_x integer := {initializer};\n"
            "BEGIN\n  PERFORM 1;\nEND auth_block;\n"
        )
        declare = guards._DECLARE_TOKEN_RE.search(body)
        span_end = guards._declaration_spans(body)[0][1]
        label_target = guards._labelled_opener(body, body.index(">>") + 2)
        resolved = guards._owned_section_begin(body, declare.end())
        return span_end, label_target, resolved

    def test_both_consumers_resolve_one_offset(self) -> None:
        for name, initializer in R22_FAKE_INITIALIZERS.items():
            with self.subTest(form=name):
                span_end, label_target, resolved = self.both_consumers(initializer)
                self.assertEqual(span_end, resolved)
                self.assertEqual(label_target, resolved)

    def test_the_one_offset_is_the_real_block_begin(self) -> None:
        """Not merely equal - equal to the LAST `begin`, which is the opener."""
        for name, initializer in R22_FAKE_INITIALIZERS.items():
            with self.subTest(form=name):
                body = self.masked(
                    f"<<auth_block>>\nDECLARE\n  v_x integer := {initializer};\n"
                    "BEGIN\n  PERFORM 1;\nEND auth_block;\n"
                )
                real = [m.start() for m in guards._SECTION_BEGIN_RE.finditer(body)][-1]
                span_end, label_target, _ = self.both_consumers(initializer)
                self.assertEqual(span_end, real)
                self.assertEqual(label_target, real)


class Round22DeclareSpanTruncationTests(_Round22Base):
    """RED A. The declaration span must not end at a fake `begin`.

    Every fixture compiles on 17.11 and, called as a NON-MEMBER, raises nothing
    and lets the UPDATE run - `raise integer := 2;` is an integer variable, not
    a RAISE statement. At the starting head each of these returned [], because
    the truncated span pushed that declaration OUT of the section and it was
    read as the denial branch's abort.
    """

    def test_every_fake_initializer_is_rejected(self) -> None:
        for name, initializer in R22_FAKE_INITIALIZERS.items():
            with self.subTest(form=name):
                body = self.deny_branch(
                    f"      v_x integer := {initializer};\n"
                    "      raise integer := 2;\n",
                    "      v_x := v_x + raise;\n",
                )
                self.assertFalse(
                    self.accepts(name, self.routine(body)),
                    f"`{name}` authorizes an unguarded write",
                )

    def test_a_depth_zero_fake_begin_is_rejected(self) -> None:
        """Nesting is not the discriminator - these sit at paren depth 0."""
        for name, declaration in R22_DEPTH0_FAKE_DECLARATIONS.items():
            with self.subTest(form=name):
                body = self.deny_branch(
                    f"      {declaration}\n"
                    "      v_x integer := 1;\n      raise integer := 2;\n",
                    "      v_x := v_x + raise;\n",
                )
                self.assertFalse(self.accepts(name, self.routine(body)))

    def test_the_fake_begin_position_does_not_rescue_it(self) -> None:
        for name, declarations in {
            "first": (
                f"      v_x integer := {self.FAKE};\n      v_b integer := 1;\n"
                "      raise integer := 2;\n"
            ),
            "middle": (
                f"      v_a integer := 1;\n      v_x integer := {self.FAKE};\n"
                "      raise integer := 2;\n"
            ),
            "last": (
                f"      v_a integer := 1;\n      raise integer := 2;\n"
                f"      v_x integer := {self.FAKE};\n"
            ),
        }.items():
            with self.subTest(position=name):
                self.assertFalse(
                    self.accepts(name, self.routine(
                        self.deny_branch(declarations, "      v_x := v_x + raise;\n")))
                )

    def test_the_same_shape_without_a_fake_begin_is_the_control(self) -> None:
        """Nothing about the DECLARE section itself is being rejected: the
        identical routine with an ordinary initializer was already rejected at
        the starting head, for the same reason."""
        body = self.deny_branch(
            "      v_a integer := 1;\n      v_x integer := 2;\n"
            "      raise integer := 2;\n",
            "      v_x := v_x + v_a + raise;\n",
        )
        self.assertFalse(self.accepts("no_fake_control", self.routine(body)))


class Round22FalseRedMirrorTests(_Round22Base):
    """RED B. The mirror: the same truncation also destroyed a REAL guard.

    On 17.11 each routine here DENIES a non-member - the guard raises
    TENANT_MEMBERSHIP_REQUIRED (P0001) and `actual_qty` is unchanged - yet the
    starting head reported it unguarded, because the declaration named `raise`
    fell outside the truncated span and read as an abort BEFORE the guard.
    """

    def test_every_fake_initializer_keeps_the_real_guard(self) -> None:
        for name, initializer in R22_FAKE_INITIALIZERS.items():
            with self.subTest(form=name):
                self.assertTrue(
                    self.accepts(name, self.routine(self.mirror(initializer))),
                    f"`{name}` lost a guard the oracle proves denies",
                )

    def test_a_depth_zero_fake_begin_keeps_the_real_guard(self) -> None:
        for name, declaration in R22_DEPTH0_FAKE_DECLARATIONS.items():
            with self.subTest(form=name):
                body = (
                    f"DECLARE\n  {declaration}\n  raise integer := 2;\n"
                    "BEGIN\n" + self.GUARD + self.PRIV
                )
                self.assertTrue(self.accepts(name, self.routine(body)))


class Round22LabelledExitTests(_Round22Base):
    """RED C. The label belongs to the real BEGIN, never to a fake one.

    On 17.11 the write happens and `EXIT auth_block` jumps past the PERFORM, so
    NO assertion executes and the routine authorizes nothing. At the starting
    head the label attached to the initializer's `begin`, the real frame carried
    no label, the EXIT matched no block, and the dead guard counted as live.
    """

    def test_the_labelled_exit_bypass_is_rejected(self) -> None:
        for name, initializer in R22_FAKE_INITIALIZERS.items():
            with self.subTest(form=name):
                sql = self.routine(
                    self.labelled(initializer, "  EXIT auth_block;\n"),
                    close="END auth_block;\n",
                )
                self.assertFalse(
                    self.accepts(name, sql), f"`{name}` counted a dead guard"
                )

    def test_a_conditional_labelled_exit_is_rejected(self) -> None:
        sql = self.routine(
            self.labelled(self.FAKE, "  EXIT auth_block WHEN p_org IS NULL;\n"),
            close="END auth_block;\n",
        )
        self.assertFalse(self.accepts("exit_when", sql))

    def test_the_unlabelled_control_still_behaves(self) -> None:
        """Without the DECLARE the starting head already rejected this; the
        fixture proves Round 22 did not reach the ordinary path."""
        sql = self.routine(
            self.labelled(None, "  EXIT auth_block;\n"), close="END auth_block;\n"
        )
        self.assertFalse(self.accepts("no_declare", sql))

    # -- label attribution, asserted on offsets rather than on a verdict -----

    def labelled_body(self, initializer: str) -> str:
        return self.masked(
            self.labelled(initializer, "  EXIT auth_block;\n") + "END auth_block;\n"
        )

    def test_the_label_lands_on_the_real_begin_and_not_the_fake_one(self) -> None:
        for name, initializer in R22_FAKE_INITIALIZERS.items():
            with self.subTest(form=name):
                body = self.labelled_body(initializer)
                spellings = [
                    m.start() for m in guards._SECTION_BEGIN_RE.finditer(body)
                ]
                real, fakes = spellings[-1], spellings[:-1]
                labels = guards._block_labels(body)
                self.assertEqual(
                    labels, {real: "auth_block"},
                    "the label is not on the real block opener",
                )
                for fake in fakes:
                    self.assertNotIn(
                        fake, labels, "a fake `begin` received label attribution"
                    )

    def test_the_real_begin_frame_carries_the_exit_target(self) -> None:
        body = self.labelled_body(self.FAKE)
        real = [m.start() for m in guards._SECTION_BEGIN_RE.finditer(body)][-1]
        frames = guards.parse_blocks(body, body)
        owning = [f for f in frames if f.kind == "BEGIN" and f.start == real]
        self.assertEqual(len(owning), 1, "no BEGIN frame opens at the real opener")
        self.assertEqual(owning[0].label, "auth_block")

    def test_labelled_exit_before_sees_the_dead_guard(self) -> None:
        body = self.labelled_body(self.FAKE)
        frames = guards.parse_blocks(body, body)
        guard_pos = body.index(f"PERFORM {OUTER}")
        self.assertTrue(
            guards.labelled_exit_before(body, frames, guard_pos, body),
            "the EXIT no longer makes the later assertion unreachable",
        )


class Round22SpanEndExactnessTests(_Round22Base):
    """The span must suppress DECLARATION text and nothing else.

    Both directions are pinned, because either one alone is satisfiable by a
    broken resolver: ending too early un-suppresses a declaration (RED A/B), and
    ending too late suppresses a real statement.
    """

    def test_a_declared_raise_before_the_real_begin_is_inert(self) -> None:
        """`raise integer := 1;` declares a variable. On 17.11 it aborts
        nothing, so it cannot satisfy a denial branch."""
        body = self.deny_branch(
            f"      v_x integer := {self.FAKE};\n      raise integer := 1;\n",
            "      v_x := v_x + raise;\n",
        )
        self.assertFalse(self.accepts("declared_raise_inert", self.routine(body)))

    def test_a_real_raise_after_the_real_begin_is_visible(self) -> None:
        """The opposite edge. This RAISE runs on 17.11 - the call aborts with
        UNCONDITIONAL_ABORT and `actual_qty` is unchanged - so the guard after it
        is dead and the routine must be REJECTED. If the span ran PAST the real
        BEGIN the RAISE would be suppressed and the dead guard would count."""
        body = (
            "DECLARE\n"
            f"  v_x integer := {self.FAKE};\n"
            "  raise integer := 2;\n"
            "BEGIN\n"
            "  RAISE EXCEPTION 'UNCONDITIONAL_ABORT';\n"
            + self.GUARD + self.PRIV
        )
        self.assertFalse(self.accepts("real_raise_visible", self.routine(body)))

    def test_the_span_ends_exactly_at_the_real_begin(self) -> None:
        """PARSER-INTERNAL, on offsets: the suppressed region stops at the
        opener, so the first executable statement is never inside it."""
        for name, initializer in R22_FAKE_INITIALIZERS.items():
            with self.subTest(form=name):
                body = self.masked(
                    f"DECLARE\n  v_x integer := {initializer};\n"
                    "  raise integer := 2;\n"
                    "BEGIN\n  RAISE EXCEPTION 'x';\nEND;\n"
                )
                real = [m.start() for m in guards._SECTION_BEGIN_RE.finditer(body)][-1]
                (start, end), = guards._declaration_spans(body)
                self.assertEqual(end, real)
                self.assertTrue(guards._in_declaration_section(body, body.index("raise")))
                self.assertFalse(
                    guards._in_declaration_section(body, body.index("RAISE EXCEPTION"))
                )

    def test_the_classic_control_still_holds(self) -> None:
        """The shape the region model was built for, unchanged by Round 22."""
        body = self.masked("DECLARE x integer; BEGIN RAISE EXCEPTION 'x'; END")
        self.assertTrue(guards._in_declaration_section(body, body.index("x integer")))
        self.assertFalse(guards._in_declaration_section(body, body.index("RAISE")))


class Round22EmptyDeclarationSectionTests(_Round22Base):
    """`DECLARE BEGIN` - the second wrong-ACCEPT this round's grammar exposed.

    Found by running the brief's own "DECLARE BEGIN if valid" control. On 17.11
    an EMPTY declaration list is valid, so a block DOES open directly after the
    keyword - but no `;` stands between them, and `_opens_block_position()` had
    only the `;`, dollar-body-opener, label and statement-list-keyword rules. It
    therefore refused the position, `_control_frames()` pushed no BEGIN frame,
    `<<auth_block>>` attached to no frame, and `EXIT auth_block` matched
    nothing - so a guard the EXIT demonstrably skips counted as live.

    Measured on the oracle for the fixture below, as a non-member: the routine
    compiles, raises NOTHING, and `actual_qty` goes 5 -> 0. The assertion never
    executes. The starting head returned [] for it.

    The correction is the same one fact, from the same resolver: the BEGIN that
    OWNS the section opens a block wherever that section does. It is deliberately
    narrow - `SELECT declare BEGIN` still opens nothing, because the walk then
    asks where the DECLARE itself stands and reaches `SELECT`.
    """

    EMPTY_LABELLED = (
        "<<auth_block>>\nDECLARE\nBEGIN\n"
        f"{WORK_LINE}\n  EXIT auth_block;\n  PERFORM {OUTER}(p_org);\n"
    )

    def test_the_empty_section_exit_bypass_is_rejected(self) -> None:
        self.assertFalse(
            self.accepts("empty_labelled_exit",
                         self.routine(self.EMPTY_LABELLED, close="END auth_block;\n")),
            "an EXIT past the guard is invisible again",
        )

    def test_the_empty_section_opens_a_labelled_begin_frame(self) -> None:
        """PARSER-INTERNAL: the frame exists, at the real opener, labelled."""
        body = self.masked(self.EMPTY_LABELLED + "END auth_block;\n")
        real, = [m.start() for m in guards._SECTION_BEGIN_RE.finditer(body)]
        self.assertTrue(guards._opens_block_position(body, real))
        self.assertEqual(guards._block_labels(body), {real: "auth_block"})
        owning = [
            f for f in guards.parse_blocks(body, body)
            if f.kind == "BEGIN" and f.start == real
        ]
        self.assertEqual(len(owning), 1, "no BEGIN frame opens at DECLARE BEGIN")
        self.assertEqual(owning[0].label, "auth_block")
        self.assertTrue(
            guards.labelled_exit_before(
                body, guards.parse_blocks(body, body),
                body.index(f"PERFORM {OUTER}"), body,
            )
        )

    def test_an_empty_section_with_a_reachable_guard_is_accepted(self) -> None:
        """The control in the other direction: no jump, so nothing is skipped
        and the guard denies on 17.11. A frame was ADDED, not a rejection."""
        for name, body in {
            "labelled": (
                "<<auth_block>>\nDECLARE\nBEGIN\n" + self.GUARD + self.PRIV),
            "unlabelled": "DECLARE\nBEGIN\n" + self.GUARD + self.PRIV,
        }.items():
            with self.subTest(shape=name):
                close = "END auth_block;\n" if name == "labelled" else "END;\n"
                self.assertTrue(self.accepts(name, self.routine(body, close=close)))

    def test_a_declare_identifier_still_opens_no_block(self) -> None:
        """Round 19's class must not reopen: `declare` is UNRESERVED, and
        `SELECT declare ...` is an ordinary column read on 17.11. The new step
        asks where the DECLARE stands, so this reaches `SELECT` and is refused."""
        for name, text in {
            "select_declare_begin": "SELECT declare begin INTO v_x FROM public.t2",
            "case_then_declare_begin": (
                "SELECT CASE WHEN true THEN declare ELSE 0 END INTO v_x FROM public.t2"),
        }.items():
            with self.subTest(case=name):
                body = self.masked(
                    f"DECLARE\n  v_x integer;\nBEGIN\n  {text};\nEND;\n")
                fake = guards._DECLARE_TOKEN_RE.search(body, body.index("BEGIN"))
                self.assertIsNotNone(fake, "fixture lost its bare `declare`")
                self.assertFalse(
                    guards._opens_declaration_section(body, fake.start()),
                    "a bare `declare` identifier opened a section",
                )
                self.assertEqual(len(guards._declaration_spans(body)), 1)


class Round22NoOverSkippingTests(_Round22Base):
    """The opposite failure: the resolver must not MISS the real opener.

    Losing it would run the span to the end of the body, swallow every statement
    as declaration text, and - for a labelled block - drop the label entirely,
    which is fail-OPEN for the EXIT rule. Each fixture below compiles on 17.11
    and keeps a guard the oracle proves denies, so a lost opener shows up as a
    rejection.
    """

    def assert_guard_survives(self, name: str, body: str, close: str = "END;\n") -> None:
        self.assertTrue(
            self.accepts(name, self.routine(body, close=close)),
            f"`{name}` lost the real block opener",
        )

    def test_ordinary_declaration_sections_keep_their_guard(self) -> None:
        for name, declarations in {
            "empty_section": "",
            "one_declaration": "  v_x integer;\n",
            "multiple_declarations": "  v_x integer;\n  v_y text;\n  v_z numeric(10,2);\n",
            "initializer_then_begin": "  v_x integer := 1;\n",
            "constant": "  v_x CONSTANT integer := 1;\n",
            "alias_for": "  v_a ALIAS FOR p_org;\n",
            "pct_type": "  v_x public.t.a%TYPE;\n",
            "pct_rowtype": "  v_r public.t%ROWTYPE;\n",
            "semicolon_then_comment": "  v_x integer := 1; -- trailing\n",
            "blank_lines_before_begin": "  v_x integer := 1;\n\n\n",
            "block_comment_before_begin": "  v_x integer := 1;\n  /* note */\n",
            "initializer_with_case_text": (
                "  v_x integer := (SELECT CASE WHEN true THEN 1 ELSE 0 END);\n"
            ),
            "initializer_with_nested_parens": "  v_x integer := (((1)));\n",
            "initializer_with_end_label": "  v_x integer := (SELECT 1 AS end);\n",
        }.items():
            with self.subTest(section=name):
                self.assert_guard_survives(
                    name, "DECLARE\n" + declarations + "BEGIN\n" + self.GUARD + self.PRIV
                )

    def test_labelled_declaration_sections_keep_their_label(self) -> None:
        """A dropped label is fail-open, so each of these is checked through the
        EXIT rule: the guard after the jump is dead and must be REJECTED."""
        for name, (label, declarations) in {
            "plain": ("auth_block", "  v_x integer := 1;\n"),
            "quoted": ('"Auth Block"', "  v_x integer := 1;\n"),
            "non_ascii": ("auth_blöck", "  v_x integer := 1;\n"),
            "comment_before_begin": ("auth_block", "  v_x integer := 1;\n  /* c */\n"),
            "blank_lines_before_begin": ("auth_block", "  v_x integer := 1;\n\n"),
            "empty_section": ("auth_block", ""),
            "fake_begin_initializer": ("auth_block", f"  v_x integer := {self.FAKE};\n"),
        }.items():
            with self.subTest(label=name):
                body = (
                    f"<<{label}>>\nDECLARE\n" + declarations + "BEGIN\n" + self.PRIV
                    + f"  EXIT {label};\n" + self.GUARD
                )
                self.assertFalse(
                    self.accepts(name, self.routine(body, close=f"END {label};\n")),
                    f"`{name}` lost its label, so the EXIT bypass went unseen",
                )

    def test_nested_declaration_blocks_each_reach_their_own_begin(self) -> None:
        body = (
            "DECLARE\n  v_o integer := 1;\n"
            "BEGIN\n"
            "  DECLARE\n    v_i integer := 2;\n"
            "  BEGIN\n    v_i := v_i + v_o;\n  END;\n"
            + self.GUARD + self.PRIV
        )
        self.assert_guard_survives("nested_declare", body)

    def test_declaration_blocks_inside_control_branches(self) -> None:
        for name, body in {
            "if_branch": (
                "BEGIN\n  IF true THEN\n    DECLARE w integer;\n"
                "    BEGIN w := 1; END;\n  END IF;\n" + self.GUARD + self.PRIV
            ),
            "else_branch": (
                "BEGIN\n  IF false THEN\n    NULL;\n  ELSE\n    DECLARE w integer;\n"
                "    BEGIN w := 1; END;\n  END IF;\n" + self.GUARD + self.PRIV
            ),
            "loop_body": (
                "BEGIN\n  FOR i IN 1..1 LOOP\n    DECLARE w integer;\n"
                "    BEGIN w := 1; END;\n  END LOOP;\n" + self.GUARD + self.PRIV
            ),
            "after_previous_statements": (
                "BEGIN\n  PERFORM 1;\n  DECLARE w integer;\n  BEGIN w := 1; END;\n"
                + self.GUARD + self.PRIV
            ),
        }.items():
            with self.subTest(placement=name):
                self.assert_guard_survives(name, body)


class Round22StructuralWordInitializerTests(_Round22Base):
    """`begin` is not the only structural word an initializer may spell.

    Measured on 17.11: `loop`, `if`, `raise`, `declare`, `exception` and `return`
    all parse as BARE columns, and as column LABELS so do the reserved `end`,
    `case`, `when`, `then` and `else` - ColLabel accepts any keyword. A bare
    column of a reserved word does NOT parse, so those are controls rather than
    fixtures. None of these may terminate a declaration section.
    """

    #: Unreserved in PostgreSQL 17.11: legal as a bare column name.
    BARE_LEGAL = ("begin", "loop", "if", "raise", "declare", "exception", "return")
    #: Reserved: legal only as a column LABEL after AS.
    LABEL_ONLY = ("end", "case", "when", "then", "else")
    #: `return` reaches the RETURN-REACHABILITY model, which is a different
    #: consumer from declaration termination and reads the identifier as a
    #: RETURN statement before the guard. That is a pre-existing fail-CLOSED
    #: conservatism - the routine really does deny on 17.11, and the scanner
    #: rejects it - measured identical at the starting head and here. Round 22
    #: neither introduces nor changes it; it is pinned below rather than fixed,
    #: because the DECLARE section already resolves correctly for the word.
    RETURN_REACHABILITY_FAIL_CLOSED = ("return",)

    def initializer_body(self, expression: str) -> str:
        return (
            f"DECLARE\n  v_x integer := {expression};\n"
            "  raise integer := 2;\n"
            "BEGIN\n" + self.GUARD + self.PRIV
        )

    def test_no_structural_word_ever_terminates_the_section(self) -> None:
        """The Round-22 claim itself, at the resolver, for EVERY spelling: the
        section still ends at the real block opener, `begin` included."""
        forms = [(w, f"(SELECT {w} FROM public.t LIMIT 1)") for w in self.BARE_LEGAL]
        forms += [
            (f"as_{w}", f"(SELECT 1 AS {w})")
            for w in self.BARE_LEGAL + self.LABEL_ONLY
        ]
        for name, expression in forms:
            with self.subTest(word=name):
                body = self.masked(self.initializer_body(expression) + "END;\n")
                declare = guards._DECLARE_TOKEN_RE.search(body)
                real = [m.start() for m in guards._SECTION_BEGIN_RE.finditer(body)][-1]
                self.assertEqual(
                    guards._owned_section_begin(body, declare.end()), real,
                    f"`{name}` moved the section end",
                )

    def test_a_bare_structural_column_keeps_the_guard(self) -> None:
        for word in self.BARE_LEGAL:
            if word in self.RETURN_REACHABILITY_FAIL_CLOSED:
                continue
            with self.subTest(word=word):
                body = self.initializer_body(
                    f"(SELECT {word} FROM public.t LIMIT 1)")
                self.assertTrue(self.accepts(f"bare_{word}", self.routine(body)))

    def test_a_structural_column_label_keeps_the_guard(self) -> None:
        for word in self.BARE_LEGAL + self.LABEL_ONLY:
            if word in self.RETURN_REACHABILITY_FAIL_CLOSED:
                continue
            with self.subTest(word=word):
                body = self.initializer_body(f"(SELECT 1 AS {word})")
                self.assertTrue(self.accepts(f"label_{word}", self.routine(body)))

    def test_the_return_word_stays_fail_closed(self) -> None:
        """Round 22 pinned this as a false RED the oracle contradicts - the
        guard raises P0001 and the write does not run - and left it to
        "whichever round takes that consumer" (RETURN reachability).

        ROUND 25 TAKES THAT CONSUMER, and this is the one historical
        expectation it changes, on oracle evidence re-measured at this round:
        on PostgreSQL 17.11 both forms compile, a non-member call fails with
        TENANT_MEMBERSHIP_REQUIRED from the guard, and bins is untouched. The
        `return` here is a column / column label inside a declaration
        initializer, never a statement, and `terminating_return_before()` now
        counts only RETURN statements, so the routine is ACCEPTED. The method
        name is kept so the history of the pin stays traceable; the Round-25
        classes pin the mirror (a real RETURN before the guard still rejects)."""
        for word in self.RETURN_REACHABILITY_FAIL_CLOSED:
            for form in (f"(SELECT {word} FROM public.t LIMIT 1)", f"(SELECT 1 AS {word})"):
                with self.subTest(word=word, form=form):
                    self.assertTrue(
                        self.accepts(f"failclosed_{word}", self.routine(
                            self.initializer_body(form)))
                    )

    def test_a_structural_column_does_not_manufacture_a_guard(self) -> None:
        """The same words in an UNGUARDED routine change nothing: the section
        still ends at the real BEGIN and nothing after it is authorized."""
        for word in self.BARE_LEGAL:
            with self.subTest(word=word):
                body = (
                    f"DECLARE\n  v_x integer := (SELECT {word} FROM public.t LIMIT 1);\n"
                    "  raise integer := 2;\n"
                    "BEGIN\n  v_x := v_x + raise;\n" + self.PRIV
                )
                self.assertFalse(self.accepts(f"unguarded_{word}", self.routine(body)))


#: The 16 fresh compositions. Each COMPILES on PostgreSQL 17.11, each has a
#: measured runtime outcome, and each runs through the real `check_file()`.
#: `must_accept` states the verdict the runtime semantics require.
def _r22_mutants(base: _Round22Base) -> dict[str, tuple[str, str, bool]]:
    fake, guard, priv = base.FAKE, base.GUARD, base.PRIV
    deny = base.deny_branch
    return {
        # 1-7 are wrong-ACCEPTs at the starting head: the non-member write runs.
        "01_scalar_select_begin_plus_declared_raise": (deny(
            "      v_x integer := (SELECT begin FROM public.t LIMIT 1);\n"
            "      raise integer := 2;\n", "      v_x := v_x + raise;\n"),
            "END;\n", False),
        "02_alias_begin_plus_declared_raise": (deny(
            f"      v_x integer := {fake};\n      raise integer := 2;\n",
            "      v_x := v_x + raise;\n"), "END;\n", False),
        "03_qualified_begin_plus_declared_raise": (deny(
            "      v_x integer := (SELECT t.begin FROM public.t t LIMIT 1);\n"
            "      raise integer := 2;\n", "      v_x := v_x + raise;\n"),
            "END;\n", False),
        "04_composite_begin_plus_declared_raise": (deny(
            "      v_x integer := (SELECT (t).begin FROM public.t t LIMIT 1);\n"
            "      raise integer := 2;\n", "      v_x := v_x + raise;\n"),
            "END;\n", False),
        "05_fake_begin_in_first_of_several": (deny(
            f"      v_x integer := {fake};\n      v_b integer := 1;\n"
            "      raise integer := 2;\n", "      v_x := v_x + v_b + raise;\n"),
            "END;\n", False),
        "06_fake_begin_in_middle_declaration": (deny(
            f"      v_a integer := 1;\n      v_x integer := {fake};\n"
            "      raise integer := 2;\n", "      v_x := v_x + v_a + raise;\n"),
            "END;\n", False),
        # 7 was already rejected at the starting head - the truncation fell
        # AFTER the declared raise. It is here so neither direction flips.
        "07_fake_begin_in_last_declaration": (deny(
            f"      v_a integer := 1;\n      raise integer := 2;\n"
            f"      v_x integer := {fake};\n", "      v_x := v_x + v_a + raise;\n"),
            "END;\n", False),
        # 8: the span must not run PAST the real BEGIN either. This RAISE runs
        # (call aborts, actual_qty unchanged), so the guard after it is dead.
        "08_fake_begin_then_real_raise_after_real_begin": (
            "DECLARE\n" f"  v_x integer := {fake};\n  raise integer := 2;\n"
            "BEGIN\n  RAISE EXCEPTION 'UNCONDITIONAL_ABORT';\n" + guard + priv,
            "END;\n", False),
        # 9: the mirror. The guard DOES deny on 17.11 (P0001, no write).
        "09_fake_begin_plus_standalone_perform": (
            "DECLARE\n" f"  v_x integer := {fake};\n  raise integer := 2;\n"
            "BEGIN\n" + guard + priv, "END;\n", True),
        # 10: the handler swallows the assertion, so it authorizes nothing.
        "10_fake_begin_plus_exception_handler": (
            "DECLARE\n" f"  v_x integer := {fake};\n"
            "BEGIN\n" + guard + priv + "EXCEPTION WHEN OTHERS THEN\n  NULL;\n",
            "END;\n", False),
        # 11-12: the label must reach the real BEGIN or the EXIT is invisible.
        "11_fake_begin_plus_labelled_exit": (
            base.labelled(fake, "  EXIT auth_block;\n"), "END auth_block;\n", False),
        "12_fake_begin_plus_exit_when": (
            base.labelled(fake, "  EXIT auth_block WHEN true;\n"),
            "END auth_block;\n", False),
        # 13: a nested LABELLED declare block, with the guard outside it.
        "13_nested_labelled_declare_with_fake_begin": (
            "BEGIN\n  <<inner_block>>\n  DECLARE\n"
            f"    v_x integer := {fake};\n"
            "  BEGIN\n    v_x := v_x;\n  END inner_block;\n" + guard + priv,
            "END;\n", True),
        # 14: the Round-14/18 shift operator beside the fake begin.
        "14_fake_begin_plus_shift_expression": (
            "DECLARE\n" f"  v_x integer := {fake};\n"
            "  v_s integer := (SELECT 8 >> 1);\n  raise integer := 2;\n"
            "BEGIN\n" + guard + priv, "END;\n", True),
        # 15: the Round-19/21 non-ASCII identifier CONTINUATION control.
        "15_fake_begin_plus_non_ascii_continuation": (
            "DECLARE\n" f"  v_x integer := {fake};\n"
            "  v́e integer := 1;\n  raise integer := 2;\n"
            "BEGIN\n" + guard + priv, "END;\n", True),
        # 16: two nested sections, only the INNER initializer spells begin.
        "16_nested_declares_only_inner_has_fake_begin": (
            "DECLARE\n  v_o integer := 1;\n"
            "BEGIN\n  DECLARE\n"
            f"    v_x integer := {fake};\n    raise integer := 2;\n"
            "  BEGIN\n    v_x := v_x + raise + v_o;\n  END;\n" + guard + priv,
            "END;\n", True),
    }


class Round22ComposedMutantTests(_Round22Base):
    """Fresh PostgreSQL-17.11-valid compositions, not spacing variants.

    Runtime outcomes, measured on the oracle as a non-member:

      * 01-07, 11-12 run the UPDATE and raise nothing -> REJECT.
      * 08 aborts with UNCONDITIONAL_ABORT before the guard -> REJECT.
      * 09, 13-16 abort with TENANT_MEMBERSHIP_REQUIRED and leave the row
        untouched -> ACCEPT.
      * 10 raises inside the block and the handler swallows it, so the routine
        returns having authorized nothing -> REJECT.
    """

    def test_composed_mutants(self) -> None:
        mutants = _r22_mutants(self)
        self.assertEqual(len(mutants), 16)
        for name, (body, close, must_accept) in mutants.items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(name, self.routine(body, close=close)), must_accept,
                    f"`{name}` changed verdict",
                )


class Round22RegressionBatteryTests(_Round22Base):
    """Rounds 13-21, re-proved THROUGH the Round-22 resolver.

    Each entry is checked twice: as written, and with a declaration section
    whose initializer spells `begin` prepended to the routine. The verdict must
    be identical, which is what proves Round 22 reopened none of these classes -
    a resolver that ended the section early or late would move one of them.
    """

    def battery(self) -> dict[str, tuple[str, bool]]:
        guard, priv = self.GUARD, self.PRIV
        return {
            # Round 13 - non-executable text never authorizes.
            "r13_guard_only_in_nested_dollar_literal": (
                f"BEGIN\n  RAISE NOTICE $${OUTER}(p_org)$$;\n{priv}", False),
            "r13_guard_only_in_string_literal": (
                f"BEGIN\n  PERFORM '{OUTER}(p_org)';\n{priv}", False),
            "r13_guard_only_in_block_comment": (
                f"BEGIN\n  /* {OUTER}(p_org) */\n{priv}", False),
            "r13_quoted_alias_is_not_a_call": (
                f'BEGIN\n  PERFORM "{GUARD}";\n{priv}', False),
            "r13_alias_named_raise_is_not_an_abort": (
                f"DECLARE\n  raise integer := 1;\nBEGIN\n  raise := 2;\n{priv}", False),
            # Round 14/18 - the shift operators invent neither label nor keyword.
            "r14_shift_before_raise": (
                f"DECLARE\n  v_x integer := (SELECT 8 >> 1);\nBEGIN\n{guard}{priv}", True),
            "r18_shift_before_declare": (
                f"BEGIN\n  PERFORM (SELECT 8 >> 1);\n{guard}{priv}", True),
            # Round 15 - END LOOP does not carry a raise out of the loop.
            "r15_raise_inside_never_entered_loop": (
                f"BEGIN\n  WHILE false LOOP\n{guard}  END LOOP;\n{priv}", False),
            # Round 16/17 - a DECLARED raise is inert, wherever it stands.
            "r16_first_declared_raise": (
                f"DECLARE\n  raise integer := 1;\n  v_x integer := 2;\n"
                f"BEGIN\n{guard}{priv}", True),
            "r17_second_declared_raise": (
                f"DECLARE\n  v_x integer := 1;\n  raise integer := 2;\n"
                f"BEGIN\n{guard}{priv}", True),
            "r17_third_declared_raise": (
                f"DECLARE\n  v_x integer := 1;\n  v_y integer := 2;\n"
                f"  raise integer := 3;\nBEGIN\n{guard}{priv}", True),
            "r17_raise_bare_equals_assignment": (
                f"DECLARE\n  raise integer := 1;\nBEGIN\n  raise = 2;\n{guard}{priv}", True),
            # Round 18 - a selector chain after the variable is still a target.
            "r18_qualified_raise_assignment_target": (
                f"DECLARE\n  raise public.t%ROWTYPE;\nBEGIN\n  raise.a := 2;\n"
                f"{guard}{priv}", True),
            # Round 19/20/21 - dotted structural tokens own nothing.
            "r19_sql_case_arm_does_not_open_a_section": (
                f"BEGIN\n  PERFORM (SELECT CASE WHEN true THEN 1 ELSE 0 END);\n"
                f"{guard}{priv}", True),
            "r20_dotted_end_is_a_column": (
                f"BEGIN\n  PERFORM (SELECT t.end FROM public.t t LIMIT 1);\n"
                f"{guard}{priv}", True),
            "r21_sql_identifier_begin_in_a_control_frame": (
                f"BEGIN\n  IF true THEN\n    PERFORM (SELECT begin FROM public.t LIMIT 1);\n"
                f"  END IF;\n{guard}{priv}", True),
            # Reachability, jumps and handlers.
            "return_before_guard": (
                f"BEGIN\n  RETURN;\n{guard}{priv}", False),
            "standalone_perform_guard": (f"BEGIN\n{guard}{priv}", True),
            "exception_handler_swallows_p0001": (
                f"BEGIN\n{guard}{priv}EXCEPTION WHEN SQLSTATE 'P0001' THEN\n  NULL;\n",
                False),
            "unrelated_unique_violation_handler_is_harmless": (
                f"BEGIN\n{guard}{priv}EXCEPTION WHEN unique_violation THEN\n  NULL;\n",
                True),
            "guard_inside_if_false_is_dead": (
                f"BEGIN\n  IF false THEN\n{guard}  END IF;\n{priv}", False),
        }

    def test_each_closed_class_keeps_its_verdict(self) -> None:
        for name, (body, must_accept) in self.battery().items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(name, self.routine(body)), must_accept,
                    f"`{name}` changed verdict",
                )

    #: Battery cases the payload turns into a declaring block with a handler that
    #: completes normally. The undecorated case keeps its verdict above.
    ROUND26_DECLARING_NULL_HANDLER = frozenset({
        "unrelated_unique_violation_handler_is_harmless",
    })

    def test_a_fake_begin_declaration_changes_no_verdict(self) -> None:
        """The Round-22 payload, composed onto every class above. A resolver
        that mis-locates the opener moves at least one of these."""
        for name, (body, must_accept) in self.battery().items():
            with self.subTest(case=name):
                if body.startswith("DECLARE\n"):
                    decorated = body.replace(
                        "DECLARE\n", f"DECLARE\n  v_fake integer := {self.FAKE};\n", 1)
                else:
                    decorated = (
                        f"DECLARE\n  v_fake integer := {self.FAKE};\n" + body)
                if name in self.ROUND26_DECLARING_NULL_HANDLER:
                    # Round 26: the payload DECLARES, onto a block whose `NULL;`
                    # handler completes normally - refused whatever it catches,
                    # because the initializer runs outside the handler's rollback.
                    must_accept = False
                self.assertEqual(
                    self.accepts(f"{name}_fake", self.routine(decorated)), must_accept,
                    f"`{name}` changed verdict once an initializer spelled begin",
                )


class Round22CorpusTests(_Round22Base):
    """The shipped corpus, through the Round-22 resolver."""

    def test_numbered_migrations_122_to_191_stay_clean(self) -> None:
        root = pathlib.Path(__file__).resolve().parents[2] / "sql" / "migrations"
        files = sorted(
            p for p in root.glob("*.sql")
            if p.name[:3].isdigit() and 122 <= int(p.name[:3]) <= 191
        )
        self.assertEqual(len(files), 61, "the reviewed sweep changed size")
        self.assertEqual(
            {p.name: out for p in files if (out := guards.check_file(p))}, {},
            "the 122-191 sweep stopped being clean",
        )

    def test_no_shipped_routine_declares_a_fake_block_opener(self) -> None:
        """The corpus reason the change is inert here: no declaration section in
        `sql/` spells BEGIN inside an initializer, so every span and every label
        resolves exactly where it did before Round 22."""
        root = pathlib.Path(__file__).resolve().parents[2] / "sql"
        checked = 0
        for path in sorted(root.rglob("*.sql")):
            try:
                raw = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue  # sql/archive/check-triggers.sql is not UTF-8
            checked += 1
            body = guards.mask_sql_checked(raw)[0]
            for start, end in guards._declaration_spans(body):
                self.assertIsNone(
                    guards._SECTION_BEGIN_RE.search(body, start, end),
                    f"{path.name} spells BEGIN inside a declaration section",
                )
        self.assertGreater(checked, 400, "the corpus sweep found almost nothing")


class Round22SuiteCollectionTests(unittest.TestCase):
    """CI must actually RUN the classes this file defines.

    `ci-cd.yml` invokes the suite as `python3 scripts/ci/test_check_definer_guards.py`.
    `unittest.main()` exits the process, so anything defined after it never runs -
    and at the starting head ad2e748e the entry point sat mid-file, so CI
    collected 267 of the 301 tests this file declares and every Round-21 class
    was absent: not skipped, not reported, simply never defined. A gate that
    reports green on tests it did not execute is the same failure mode the
    scanner itself exists to prevent, so both halves are pinned here.
    """

    def source(self) -> str:
        return pathlib.Path(__file__).read_text(encoding="utf-8")

    def entry_line(self, lines: list[str]) -> int:
        hits = [i for i, line in enumerate(lines) if line.startswith("if __name__")]
        self.assertEqual(len(hits), 1, f"expected exactly one entry point, got {hits}")
        return hits[0]

    def test_nothing_is_defined_after_the_entry_point(self) -> None:
        lines = self.source().splitlines()
        after = lines[self.entry_line(lines) + 1:]
        stray = [
            line for line in after
            if line.startswith("class ") or line.startswith("def ")
        ]
        self.assertEqual(
            stray, [], "defined after unittest.main(); CI would never run it",
        )

    def test_every_declared_test_class_is_collected(self) -> None:
        """The count CI sees must be the count the file declares."""
        module = sys.modules[__name__]
        declared = {
            name for name, obj in vars(module).items()
            if isinstance(obj, type)
            and issubclass(obj, unittest.TestCase)
            and not name.startswith("_")
        }
        suite = unittest.defaultTestLoader.loadTestsFromModule(module)
        collected = set()
        stack = [suite]
        while stack:
            item = stack.pop()
            if isinstance(item, unittest.TestSuite):
                stack.extend(item)
            else:
                collected.add(type(item).__name__)
        self.assertEqual(
            declared - collected, set(),
            "declared test classes that unittest never collected",
        )
        self.assertGreaterEqual(len(collected), 30, "the suite lost whole classes")


# ---------------------------------------------------------------------------
# Round 23: a chain of extra DECLAREs is ONE declaration section
# ---------------------------------------------------------------------------
# Two independent Round-22 reviews reported P1s that share one root cause.
# PostgreSQL 17.11's pl_gram.y (REL_17_11) reads:
#
#     decl_sect : opt_block_label [ decl_start [ decl_stmts ] ]
#     decl_stmt : decl_statement          -- always ends with its own `;`
#               | K_DECLARE               -- "We allow useless extra DECLAREs"
#
# so the block's real BEGIN may follow the section start, a `;`, OR any chain
# of extra DECLARE keywords after either. Round 22 modelled only the first two,
# in two places:
#
#   _owned_section_begin() skipped a BEGIN preceded by an extra DECLARE, the
#   section ran to the end of the body, and every real RAISE after it read as
#   declaration text. A routine that aborts before its guard was ACCEPTED - a
#   regression, because Round 21's first-textual-BEGIN rule found that BEGIN.
#
#   _opens_block_position() stepped over ONE DECLARE and then compared the next
#   DECLARE's owned BEGIN with the offset it had just stepped from. No BEGIN
#   frame was pushed for `DECLARE DECLARE BEGIN`, so a labelled EXIT past the
#   guard and an EXCEPTION handler swallowing it were both invisible
#   (pre-existing on Round 21 too).
#
# One boundary helper now states the grammar, `_at_declaration_boundary()`, and
# the frame walk carries the BEGIN it is justifying across the whole chain.
# Every DECLARE in a chain owns the same BEGIN, and all three consumers agree
# on it.
class _Round23Base(_Round22Base):
    """ORACLE, PostgreSQL 17.11, same disposable cluster and schema as Round 22,
    plus `public.t2("declare" integer, "begin" integer)` so a column named
    `declare` under the bare label `begin` can be written at paren depth 0.
    The guard helper also bumps a sequence, so "the guard was entered" is read
    back from `guard_hits.is_called` rather than inferred.

    Measured: every chain form below compiles. `DECLARE <<l>> BEGIN`,
    `DECLARE v integer; <<l>> BEGIN` ("block label must be placed before
    DECLARE, not after") and `DECLARE declare integer;` do not.
    """

    RAISE = "  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n"

    #: Declaration sections ending in a chain of extra DECLAREs, keyed by name.
    #: Each is followed directly by the real BEGIN in every fixture.
    CHAINS = {
        "declare_declare": "DECLARE\nDECLARE\n",
        "declare_comment_declare": "DECLARE /* c */ DECLARE -- c\n",
        "declaration_then_extra": "DECLARE\n  v_x integer := 1;\nDECLARE\n",
        "declaration_then_three_extras": "DECLARE\n  v_x integer := 1;\nDECLARE DECLARE DECLARE\n",
        "extra_between_declarations": "DECLARE\n  v_x integer := 1;\nDECLARE\n  v_y integer := 2;\nDECLARE\n",
        "extra_before_declaration": "DECLARE\nDECLARE\n  v_x integer := 1;\n",
        "every_form_then_extra": (
            "DECLARE\n  n CONSTANT integer := 1;\n  a ALIAS FOR p_org;\n"
            "  r pg_catalog.pg_class%ROWTYPE;\n"
            "  c CURSOR (k integer) FOR SELECT k AS begin;\nDECLARE\n"
        ),
        "fake_begin_then_extra": "DECLARE\n  v_x integer := (SELECT 1 AS begin);\nDECLARE\n",
    }

    def real_begin(self, body: str) -> int:
        """The LAST `begin` spelling, which is the real opener in every fixture."""
        return [m.start() for m in guards._SECTION_BEGIN_RE.finditer(body)][-1]


class Round23DeclarationBoundaryTests(_Round23Base):
    """PARSER-INTERNAL. The boundary rule, asserted on offsets."""

    def test_every_chain_resolves_to_the_real_begin(self) -> None:
        for name, chain in self.CHAINS.items():
            with self.subTest(chain=name):
                body = self.masked(chain + "BEGIN\n  PERFORM 1;\nEND;\n")
                opener = guards._DECLARE_TOKEN_RE.search(body)
                self.assertEqual(
                    guards._owned_section_begin(body, opener.end()),
                    self.real_begin(body),
                )

    def test_every_declare_in_a_chain_owns_the_same_begin(self) -> None:
        """The invariant the frame walk relies on."""
        for name, chain in self.CHAINS.items():
            with self.subTest(chain=name):
                body = self.masked(chain + "BEGIN\n  PERFORM 1;\nEND;\n")
                real = self.real_begin(body)
                owners = {
                    guards._owned_section_begin(body, m.end())
                    for m in guards._DECLARE_TOKEN_RE.finditer(body, 0, real)
                }
                self.assertEqual(owners, {real})

    def test_declare_begin_as_expression_text_is_not_a_boundary(self) -> None:
        """A column named `declare` under the bare label `begin` compiles at
        paren depth 0 in a cursor. The walk reaches SELECT, not a boundary."""
        for name, text in {
            "cursor_bare_label": "  c CURSOR FOR SELECT declare begin FROM public.t2;\n",
            "cursor_after_comma": "  c CURSOR FOR SELECT 1 declare, declare begin FROM public.t2;\n",
            "initializer": "  v_x integer := (SELECT declare begin FROM public.t2 LIMIT 1);\n",
            "qualified_declare": "  v_x integer := (SELECT t2.declare begin FROM public.t2 LIMIT 1);\n",
        }.items():
            with self.subTest(form=name):
                body = self.masked("DECLARE\n" + text + "BEGIN\n  PERFORM 1;\nEND;\n")
                fake = [m.start() for m in guards._SECTION_BEGIN_RE.finditer(body)][0]
                start = guards._DECLARE_TOKEN_RE.search(body).end()
                self.assertFalse(guards._at_declaration_boundary(body, start, fake))
                self.assertEqual(
                    guards._owned_section_begin(body, start), self.real_begin(body)
                )

    def test_the_boundary_rule_is_the_resolvers_only_test(self) -> None:
        """ARCHITECTURAL. One definition of the boundary, used by the resolver;
        the frame walk reaches the resolver rather than restating it."""
        resolver = inspect.getsource(guards._owned_section_begin)
        self.assertIn("_at_declaration_boundary(", resolver)
        self.assertNotIn('== ";"', resolver)
        self.assertIn(
            "_owned_section_begin(", inspect.getsource(guards._opens_block_position)
        )


class Round23SharedOwnerTests(_Round23Base):
    """The three consumers must agree on the SAME PostgreSQL-owned BEGIN.

    `_declaration_spans()` ends the span there, `_labelled_opener()` attaches
    the label there, and `_opens_block_position()` - through the frame walk -
    pushes the BEGIN frame there. Round 22 had the first two agreeing and the
    third disagreeing for a DECLARE chain.
    """

    def test_span_label_and_frame_agree_on_every_chain(self) -> None:
        for name, chain in self.CHAINS.items():
            with self.subTest(chain=name):
                body = self.masked(
                    "<<auth_block>>\n" + chain + "BEGIN\n  PERFORM 1;\nEND auth_block;\n"
                )
                real = self.real_begin(body)
                self.assertEqual(guards._declaration_spans(body)[0][1], real)
                self.assertEqual(
                    guards._labelled_opener(body, body.index(">>") + 2), real
                )
                self.assertTrue(guards._opens_block_position(body, real))
                self.assertEqual(guards._block_labels(body), {real: "auth_block"})
                frames = [
                    f for f in guards.parse_blocks(body, body)
                    if f.kind == "BEGIN" and f.start == real
                ]
                self.assertEqual(len(frames), 1, "no BEGIN frame at the real opener")
                self.assertEqual(frames[0].label, "auth_block")

    def test_an_extra_declare_is_not_a_block_opener_of_its_own(self) -> None:
        """Inside `DECLARE DECLARE BEGIN` the second keyword opens nothing."""
        body = self.masked("DECLARE\nDECLARE\nBEGIN\n  PERFORM 1;\nEND;\n")
        second = [m.start() for m in guards._DECLARE_TOKEN_RE.finditer(body)][1]
        self.assertFalse(guards._opens_block_position(body, second))
        self.assertEqual(len(guards._declaration_spans(body)), 1)

    def test_a_chain_after_a_non_block_word_still_opens_nothing(self) -> None:
        """Round 19's class must stay closed: `SELECT declare declare begin`
        reaches SELECT, so the walk refuses every step of the chain."""
        body = self.masked(
            "DECLARE\n  v_x integer;\nBEGIN\n"
            "  SELECT declare declare INTO v_x FROM public.t2;\nEND;\n"
        )
        inner = [m.start() for m in guards._DECLARE_TOKEN_RE.finditer(body)][1:]
        for pos in inner:
            self.assertFalse(guards._opens_declaration_section(body, pos))
        self.assertEqual(len(guards._declaration_spans(body)), 1)


class Round23OuterRaiseTests(_Round23Base):
    """Finding 1, end to end. Each routine aborts with NOT_IMPLEMENTED on 17.11
    before the guard runs (`guard_hits` untouched), so the guard is dead and the
    routine must be REJECTED. At 5e28ffe2 every one of these returned []."""

    def test_an_outer_raise_after_every_chain_is_visible(self) -> None:
        for name, chain in self.CHAINS.items():
            with self.subTest(chain=name):
                body = chain + "BEGIN\n" + self.RAISE + self.GUARD + self.PRIV
                self.assertFalse(self.accepts(f"r23_raise_{name}", self.routine(body)))

    def test_an_inner_chain_block_does_not_swallow_the_outer_raise(self) -> None:
        body = (
            "BEGIN\n  DECLARE DECLARE BEGIN NULL; END;\n"
            + self.RAISE + self.GUARD + self.PRIV
        )
        self.assertFalse(self.accepts("r23_inner_chain", self.routine(body)))


class Round23ChainFrameTests(_Round23Base):
    """Finding 2, end to end. With no BEGIN frame, a labelled EXIT past the guard
    and a handler swallowing it were invisible. Measured on 17.11: the EXIT
    variants commit the UPDATE and never enter the guard; the handler variants
    enter the guard, swallow P0001 and return normally."""

    def test_a_labelled_exit_over_the_guard_is_rejected(self) -> None:
        for name, chain in self.CHAINS.items():
            for exit_line in ("  EXIT auth_block;\n", "  EXIT auth_block WHEN true;\n"):
                with self.subTest(chain=name, exit=exit_line.strip()):
                    body = (
                        "<<auth_block>>\n" + chain + "BEGIN\n" + self.PRIV
                        + exit_line + self.GUARD
                    )
                    self.assertFalse(self.accepts(
                        f"r23_exit_{name}", self.routine(body, close="END auth_block;\n")
                    ))

    def test_a_swallowing_handler_is_rejected(self) -> None:
        for name, chain in self.CHAINS.items():
            for handler in ("others", "SQLSTATE 'P0001'", "raise_exception"):
                with self.subTest(chain=name, handler=handler):
                    body = (
                        chain + "BEGIN\n" + self.GUARD + self.PRIV
                        + f"EXCEPTION WHEN {handler} THEN\n  NULL;\n"
                    )
                    self.assertFalse(self.accepts(f"r23_exc_{name}", self.routine(body)))

    def test_the_handler_is_recorded_on_the_chain_frame(self) -> None:
        body = self.masked(
            "DECLARE\nDECLARE\nBEGIN\n  PERFORM 1;\nEXCEPTION WHEN others THEN\n  NULL;\nEND;\n"
        )
        real = self.real_begin(body)
        frame, = [
            f for f in guards.parse_blocks(body, body)
            if f.kind == "BEGIN" and f.start == real
        ]
        self.assertIsNotNone(frame.exc_pos, "the EXCEPTION section was not recorded")


class Round23ControlTests(_Round23Base):
    """The opposite direction: nothing here may turn into a rejection. Each
    routine denies a non-member on 17.11 (P0001, no write)."""

    def test_a_live_guard_after_every_chain_is_accepted(self) -> None:
        for name, chain in self.CHAINS.items():
            with self.subTest(chain=name):
                body = chain + "BEGIN\n" + self.GUARD + self.PRIV
                self.assertTrue(self.accepts(f"r23_live_{name}", self.routine(body)))

    def test_a_declared_raise_in_a_chain_section_stays_inert(self) -> None:
        body = "DECLARE\nDECLARE\n  raise integer := 2;\nBEGIN\n" + self.GUARD + self.PRIV
        self.assertTrue(self.accepts("r23_declared_raise", self.routine(body)))

    def test_an_unrelated_handler_on_a_chain_block_is_harmless(self) -> None:
        body = (
            "DECLARE\nDECLARE\nBEGIN\n" + self.GUARD + self.PRIV
            + "EXCEPTION WHEN unique_violation THEN\n  NULL;\n"
        )
        self.assertTrue(self.accepts("r23_unique_violation", self.routine(body)))

    def test_declare_begin_expression_text_keeps_the_guard(self) -> None:
        body = (
            "DECLARE\n  c CURSOR FOR SELECT declare begin FROM public.t2;\n"
            "  raise integer := 2;\nBEGIN\n" + self.GUARD + self.PRIV
        )
        self.assertTrue(self.accepts("r23_cursor_text", self.routine(body)))


#: 20 fresh compositions. Every one COMPILES on PostgreSQL 17.11 and was RUN as
#: a non-member: "abort" = NOT_IMPLEMENTED before the guard, "write" = the
#: UPDATE committed with the guard never entered, "swallowed" = guard entered
#: and P0001 swallowed, "deny" = P0001 propagated and no write, "returned" =
#: RETURN before the guard. `must_accept` is what that runtime requires.
def _r23_mutants(base: _Round23Base) -> dict[str, tuple[str, str, bool]]:
    g, u, r = base.GUARD, base.PRIV, base.RAISE
    e, el = "END;\n", "END auth_block;\n"
    return {
        "01_declare_declare_then_raise": ("DECLARE\nDECLARE\nBEGIN\n" + r + g + u, e, False),
        "02_declaration_then_extra_then_raise": (
            "DECLARE\n  v integer := 1;\nDECLARE\nBEGIN\n" + r + g + u, e, False),
        "03_three_trailing_declares_then_raise": (
            "DECLARE\n  v integer := 1;\nDECLARE DECLARE DECLARE\nBEGIN\n" + r + g + u, e, False),
        "04_commented_chain_then_raise": (
            "DECLARE /* c */ DECLARE -- c\nBEGIN\n" + r + g + u, e, False),
        "05_every_decl_form_then_extra_then_raise": (
            "DECLARE\n  n CONSTANT integer := 1;\n  a ALIAS FOR p_org;\n"
            "  r pg_catalog.pg_class%ROWTYPE;\n"
            "  c CURSOR (k integer) FOR SELECT k AS begin;\nDECLARE\nBEGIN\n" + r + g + u,
            e, False),
        "06_inner_chain_block_then_outer_raise": (
            "BEGIN\n  DECLARE DECLARE BEGIN NULL; END;\n" + r + g + u, e, False),
        "07_labelled_chain_exit": (
            "<<auth_block>>\nDECLARE\nDECLARE\nBEGIN\n" + u + "  EXIT auth_block;\n" + g, el, False),
        "08_labelled_chain_exit_when": (
            "<<auth_block>>\nDECLARE\nDECLARE\nBEGIN\n" + u + "  EXIT auth_block WHEN true;\n" + g,
            el, False),
        "09_chain_handler_swallows_others": (
            "DECLARE\nDECLARE\nBEGIN\n" + g + u + "EXCEPTION WHEN others THEN\n  NULL;\n", e, False),
        "10_chain_handler_swallows_p0001": (
            "DECLARE\nDECLARE\nBEGIN\n" + g + u + "EXCEPTION WHEN SQLSTATE 'P0001' THEN\n  NULL;\n",
            e, False),
        "11_chain_unrelated_unique_violation": (
            "DECLARE\nDECLARE\nBEGIN\n" + g + u + "EXCEPTION WHEN unique_violation THEN\n  NULL;\n",
            e, True),
        "12_chain_then_declared_raise_inert": (
            "DECLARE\nDECLARE\n  raise integer := 2;\nBEGIN\n" + g + u, e, True),
        "13_chain_live_guard": ("DECLARE\nDECLARE\nBEGIN\n" + g + u, e, True),
        "14_cursor_declare_begin_is_expression_text": (
            "DECLARE\n  c CURSOR FOR SELECT declare begin FROM public.t2;\n"
            "  raise integer := 2;\nBEGIN\n" + g + u, e, True),
        "15_cursor_declare_begin_in_deny_branch": (
            "BEGIN\n  IF NOT public.wardah_is_org_member(p_org) THEN\n    DECLARE\n"
            "      c CURSOR FOR SELECT declare begin FROM public.t2;\n"
            "      raise integer := 2;\n    DECLARE\n    BEGIN\n      NULL;\n    END;\n"
            "  END IF;\n" + u, e, False),
        "16_fake_begin_plus_chain_labelled_exit": (
            "<<auth_block>>\nDECLARE\n  v integer := (SELECT 1 AS begin);\nDECLARE\nBEGIN\n"
            + u + "  EXIT auth_block;\n" + g, el, False),
        "17_nested_labelled_chain_exits_only_inner": (
            "BEGIN\n  <<inner_block>>\n  DECLARE DECLARE\n  BEGIN\n    EXIT inner_block;\n"
            "  END inner_block;\n" + g + u, e, True),
        "18_chain_then_return_before_guard": ("DECLARE\nDECLARE\nBEGIN\n  RETURN;\n" + g + u, e, False),
        "19_chain_negated_raise_idiom": (
            "DECLARE\nDECLARE\nBEGIN\n  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    RAISE EXCEPTION 'DENIED';\n  END IF;\n" + u, e, True),
        "20_qualified_declare_is_not_a_chain": (
            "DECLARE\n  v integer := (SELECT t2.declare begin FROM public.t2 LIMIT 1);\n"
            "  raise integer := 2;\nBEGIN\n" + g + u, e, True),
    }


class Round23ComposedMutantTests(_Round23Base):
    """Runtime, measured on 17.11 as a non-member:

      * 01-06 abort with NOT_IMPLEMENTED before the guard -> REJECT.
      * 07, 08, 15, 16 commit the UPDATE and never enter the guard -> REJECT.
      * 09, 10 enter the guard and swallow P0001 -> REJECT.
      * 18 returns before the guard -> REJECT.
      * 11, 12, 13, 14, 17, 19, 20 deny with P0001 and write nothing -> ACCEPT.

    At 5e28ffe2, 01-10 and 16 were accepted and 19 was rejected: the chain hid
    the real BEGIN, which both swallowed real aborts and hid the real RAISE in
    19's denial branch.
    """

    def test_composed_mutants(self) -> None:
        mutants = _r23_mutants(self)
        self.assertEqual(len(mutants), 20)
        for name, (body, close, must_accept) in mutants.items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(name, self.routine(body, close=close)), must_accept,
                    f"`{name}` changed verdict",
                )


class Round23RegressionBatteryTests(_Round23Base):
    """Rounds 13-22, re-proved with a DECLARE chain composed onto each class.

    Reuses the Round-22 battery verbatim, so the historical expectations are
    the same objects, and adds an extra DECLARE after the routine's opening
    one - or a `DECLARE DECLARE` section where there was none. A resolver or
    frame walk that mis-located the chain's BEGIN moves at least one verdict.
    """

    def test_a_declare_chain_changes_no_verdict(self) -> None:
        battery = Round22RegressionBatteryTests.battery(self)
        self.assertGreaterEqual(len(battery), 20)
        for name, (body, must_accept) in battery.items():
            with self.subTest(case=name):
                if body.startswith("DECLARE\n"):
                    decorated = body.replace("\nBEGIN\n", "\nDECLARE\nBEGIN\n", 1)
                    self.assertNotEqual(decorated, body)
                else:
                    decorated = "DECLARE\nDECLARE\n" + body
                self.assertEqual(
                    self.accepts(f"{name}_chain", self.routine(decorated)), must_accept,
                    f"`{name}` changed verdict once a DECLARE chain was added",
                )

    def test_round22_initializer_matrix_still_holds_with_a_chain(self) -> None:
        """Round 22's fake-`begin` initializers, now followed by an extra
        DECLARE: RED A must still reject and the mirror must still accept."""
        for name, initializer in R22_FAKE_INITIALIZERS.items():
            with self.subTest(form=name):
                deny = self.deny_branch(
                    f"      v_x integer := {initializer};\n      raise integer := 2;\n"
                    "    DECLARE\n",
                    "      v_x := v_x + raise;\n",
                )
                self.assertFalse(self.accepts(f"r23_redA_{name}", self.routine(deny)))
                mirror = (
                    f"DECLARE\n  v_x integer := {initializer};\n  raise integer := 2;\n"
                    "DECLARE\nBEGIN\n" + self.GUARD + self.PRIV
                )
                self.assertTrue(self.accepts(f"r23_mirror_{name}", self.routine(mirror)))


# ---------------------------------------------------------------------------
# Round 24: a SQL CASE arm owns no PL/pgSQL statement list
# ---------------------------------------------------------------------------
# Codex thread r4072777435 ("Reject SQL CASE arms as statement-list owners"),
# still live at 388fc827. `THEN` and `ELSE` are SQL CASE keywords as well as
# PL/pgSQL ones, and `loop`, `begin`, `if` and `exception` are legal column
# names on 17.11. `_control_frames()` decided whether such a word OPENS a
# construct through `_owns_statement_list_lexically()`, which accepted ANY
# preceding THEN or ELSE - so a column named `loop` in a SQL CASE arm pushed a
# LOOP frame, that frame took the real END LOOP, and a guard inside a loop that
# never iterates was credited at the routine's outer level.
#
# The walk already knew better: its in-progress stack says which construct is
# open at the THEN. `_walk_ownership()` now asks it, and a CASE frame records at
# push time whether it is a SQL expression, so a THEN or ELSE owned by a SQL
# CASE proves nothing - for a PUSH, for a nested CASE statement, or for an
# EXCEPTION section. Nothing else in the walk changed.
class _Round24Base(_Round23Base):
    """ORACLE, PostgreSQL 17.11, same disposable cluster, plus

        CREATE TABLE public.r21_t ("loop" int, "if" int, "begin" int, "end" int,
                                   "declare" int, "raise" int, a int);
        CREATE TABLE public.r24_t ("exception" int);

    so every spelling below compiles. The guard helper bumps a sequence, so
    "the guard was entered" is read back, not inferred.
    """

    HEAD = "DECLARE\n  v_x integer;\n  v_arr integer[] := ARRAY[1];\nBEGIN\n"
    INNER_GUARD = "    PERFORM public.wardah_assert_org_member(p_org);\n"
    T = "public.r21_t"

    def dead_loop(self, stmt: str, head: str = "FOR v_x IN SELECT 1 WHERE false LOOP") -> str:
        """The guard sits in a real loop that never iterates, followed by `stmt`.

        On 17.11 the loop body never runs, the guard is never entered, and the
        UPDATE after the loop lands - so the routine must be REJECTED.
        """
        return (
            self.HEAD + f"  {head}\n" + self.INNER_GUARD + f"    {stmt}\n"
            "  END LOOP;\n" + self.PRIV
        )

    def arm(self, word: str, where: str = "THEN") -> str:
        branch = (
            f"CASE WHEN true THEN {word} ELSE 0 END" if where == "THEN"
            else f"CASE WHEN false THEN 0 ELSE {word} END"
        )
        return f"PERFORM (SELECT {branch} FROM {self.T} LIMIT 1);"

    def frames(self, text: str):
        body = self.masked(text)
        return body, guards.parse_blocks(body, body)


class Round24WalkOwnershipTests(_Round24Base):
    """PARSER-INTERNAL. What the walk now builds, asserted on frames."""

    def test_a_loop_column_in_a_sql_case_arm_opens_no_frame(self) -> None:
        for where in ("THEN", "ELSE"):
            with self.subTest(arm=where):
                body, frames = self.frames(self.dead_loop(self.arm("loop", where)) + "END;\n")
                column = body.index(" loop ", body.index("CASE")) + 1
                loops = [f for f in frames if f.kind == "LOOP"]
                self.assertEqual(len(loops), 1, "a SQL identifier opened a LOOP")
                self.assertNotEqual(loops[0].start, column)
                self.assertGreater(loops[0].end, body.index("END LOOP") - 1)
                self.assertTrue(
                    loops[0].start < body.index("PERFORM public.wardah") < loops[0].end,
                    "the guard is no longer inside the real loop",
                )

    def test_case_frames_know_whether_they_are_sql_expressions(self) -> None:
        text = (
            self.HEAD
            + "  CASE WHEN (SELECT CASE WHEN true THEN 0 ELSE 1 END) = 1 THEN\n"
            "    CASE WHEN false THEN\n      NULL;\n    ELSE\n"
            "      v_x := (SELECT CASE WHEN true THEN CASE WHEN true THEN 1 END END);\n"
            "    END CASE;\n  END CASE;\nEND;\n"
        )
        body, frames = self.frames(text)
        by_start = {f.start: f for f in frames if f.kind == "CASE"}
        starts = sorted(by_start)
        self.assertEqual(len(starts), 5)
        # statement, expression in its WHEN, statement, expression, nested expression
        self.assertEqual(
            [by_start[s].sql_expr for s in starts], [False, True, False, True, True]
        )

    def test_only_a_sql_case_withdraws_then_and_else(self) -> None:
        """IF, a PL/pgSQL CASE statement and a handler keep their lists."""
        for name, text in {
            "if_then": self.HEAD + "  IF true THEN\n    LOOP EXIT; END LOOP;\n  END IF;\nEND;\n",
            "if_else": self.HEAD + "  IF true THEN NULL; ELSE\n    LOOP EXIT; END LOOP;\n  END IF;\nEND;\n",
            "case_then": self.HEAD + "  CASE WHEN true THEN\n    LOOP EXIT; END LOOP;\n  END CASE;\nEND;\n",
            "case_else": self.HEAD + "  CASE WHEN true THEN NULL; ELSE\n    LOOP EXIT; END LOOP;\n  END CASE;\nEND;\n",
            "handler": self.HEAD + "  BEGIN NULL;\n  EXCEPTION WHEN others THEN\n    LOOP EXIT; END LOOP;\n  END;\nEND;\n",
        }.items():
            with self.subTest(owner=name):
                body, frames = self.frames(text)
                real = body.index("LOOP EXIT")
                self.assertIn(
                    real, [f.start for f in frames if f.kind == "LOOP"],
                    "a real LOOP frame was dropped",
                )

    def test_the_walk_asks_one_stack_aware_question(self) -> None:
        """ARCHITECTURAL. Every position question in the walk goes through
        `_walk_ownership()`; outside the walk the defaults are unchanged."""
        walk = inspect.getsource(guards._control_frames)
        self.assertIn("_walk_ownership(stack)", walk)
        self.assertIn("_owns_control_frame(body, token, m.start(), owns)", walk)
        self.assertEqual(walk.count("_opens_frame_position(body, m.start(), owns)"), 2)
        self.assertNotIn("_opens_frame_position(body, m.start())", walk)
        for fn in (guards._owns_control_frame, guards._opens_frame_position,
                   guards._closes_loop_header):
            with self.subTest(fn=fn.__name__):
                self.assertIs(
                    inspect.signature(fn).parameters["owns"].default,
                    guards._owns_statement_list_lexically,
                )


class Round24SqlCaseArmTests(_Round24Base):
    """The false-green family, end to end. Every fixture compiles on 17.11,
    never enters the guard and commits the UPDATE; each returned [] at
    388fc827 and must be REJECTED."""

    def test_a_loop_column_in_either_arm_every_statement_form(self) -> None:
        for name, stmt in {
            "then_in_perform": self.arm("loop", "THEN"),
            "else_in_perform": self.arm("loop", "ELSE"),
            "nested_sql_case": (
                "PERFORM (SELECT CASE WHEN true THEN CASE WHEN true THEN loop ELSE 0 END"
                f" ELSE 0 END FROM {self.T} LIMIT 1);"
            ),
            "select_into": f"SELECT CASE WHEN true THEN loop ELSE 0 END INTO v_x FROM {self.T} LIMIT 1;",
            "assignment": f"v_x := (SELECT CASE WHEN true THEN loop ELSE 0 END FROM {self.T} LIMIT 1);",
        }.items():
            with self.subTest(form=name):
                self.assertFalse(self.accepts(
                    f"r24_{name}", self.routine(self.dead_loop(stmt))))

    def test_every_loop_kind(self) -> None:
        for name, head in {
            "for_query": "FOR v_x IN SELECT 1 WHERE false LOOP",
            "while_false": "WHILE false LOOP",
            "foreach_empty": "FOREACH v_x IN ARRAY ARRAY[]::integer[] LOOP",
        }.items():
            with self.subTest(loop=name):
                self.assertFalse(self.accepts(
                    f"r24_kind_{name}", self.routine(self.dead_loop(self.arm("loop"), head))))

    def test_a_labelled_loop(self) -> None:
        body = (
            self.HEAD + "  <<lp>>\n  FOR v_x IN SELECT 1 WHERE false LOOP\n"
            + self.INNER_GUARD + f"    {self.arm('loop')}\n  END LOOP lp;\n" + self.PRIV
        )
        self.assertFalse(self.accepts("r24_labelled", self.routine(body)))

    def test_other_opener_spellings_stay_rejected(self) -> None:
        """`begin` and `if` were already rejected; the rule must not move them."""
        for word in ("begin", "if"):
            with self.subTest(word=word):
                self.assertFalse(self.accepts(
                    f"r24_word_{word}", self.routine(self.dead_loop(self.arm(word)))))


class Round24FalseRedTests(_Round24Base):
    """The same flaw in the other direction. Each routine DENIES a non-member
    on 17.11 (P0001 or DENIED, no write), and 388fc827 rejected it."""

    def test_an_exception_column_opens_no_handler_section(self) -> None:
        body = (
            self.HEAD
            + "  PERFORM (SELECT CASE WHEN true THEN exception ELSE 0 END"
            " FROM public.r24_t LIMIT 1);\n" + self.GUARD + self.PRIV
        )
        self.assertTrue(self.accepts("r24_exception_column", self.routine(body)))

    def test_a_loop_column_does_not_hide_the_deny_branch_raise(self) -> None:
        for where in ("THEN", "ELSE"):
            with self.subTest(arm=where):
                body = (
                    self.HEAD + "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
                    f"    {self.arm('loop', where)}\n"
                    "    RAISE EXCEPTION 'DENIED';\n  END IF;\n" + self.PRIV
                )
                self.assertTrue(self.accepts(f"r24_deny_{where}", self.routine(body)))


class Round24RealStructureControlTests(_Round24Base):
    """Real PL/pgSQL structure must keep its frames. The dead-guard fixtures
    commit the UPDATE without entering the guard on 17.11 (REJECT); the rest
    deny (ACCEPT)."""

    def test_real_structure_keeps_the_guard_dead(self) -> None:
        inner = "    LOOP\n" + self.INNER_GUARD + "      EXIT;\n    END LOOP;\n"
        for name, text in {
            "plpgsql_case_then": "  CASE WHEN false THEN\n" + inner + "  ELSE\n    NULL;\n  END CASE;\n",
            "plpgsql_case_else": "  CASE WHEN true THEN\n    NULL;\n  ELSE\n" + inner + "  END CASE;\n",
            "sql_case_in_plpgsql_case_when": (
                "  CASE WHEN (SELECT CASE WHEN true THEN 0 ELSE 1 END) = 1 THEN\n" + inner
                + "  ELSE\n    NULL;\n  END CASE;\n"),
            "nested_plpgsql_case": (
                "  CASE WHEN true THEN\n    CASE WHEN false THEN\n" + inner
                + "    ELSE\n      NULL;\n    END CASE;\n  END CASE;\n"),
            "if_condition_sql_case": (
                "  IF (SELECT CASE WHEN true THEN false ELSE true END) THEN\n" + inner
                + "  END IF;\n"),
            "if_false": "  IF false THEN\n" + inner + "  END IF;\n",
            "while_header_holds_loop_column": (
                f"  WHILE (SELECT CASE WHEN true THEN loop ELSE 0 END FROM {self.T} LIMIT 1) = 0 LOOP\n"
                + self.INNER_GUARD + "  END LOOP;\n"),
        }.items():
            with self.subTest(shape=name):
                self.assertFalse(self.accepts(
                    f"r24_dead_{name}", self.routine(self.HEAD + text + self.PRIV)))

    def test_real_structure_with_a_live_guard(self) -> None:
        for name, text in {
            "plpgsql_case_then_loop": "  CASE WHEN true THEN\n    LOOP\n      EXIT;\n    END LOOP;\n  ELSE\n    NULL;\n  END CASE;\n",
            "handler_then_loop": (
                "  BEGIN\n    RAISE EXCEPTION 'x';\n  EXCEPTION WHEN others THEN\n"
                "    LOOP\n      EXIT;\n    END LOOP;\n  END;\n"),
            "entered_for_loop": "  FOR v_x IN SELECT 1 LOOP\n    NULL;\n  END LOOP;\n",
            "labelled_while_exit": "  <<lp>>\n  WHILE true LOOP\n    EXIT lp;\n  END LOOP lp;\n",
            "entered_foreach": "  FOREACH v_x IN ARRAY v_arr LOOP\n    NULL;\n  END LOOP;\n",
            "sql_case_loop_before_guard": f"  {self.arm('loop')}\n",
            "sql_case_loop_select_into": (
                f"  SELECT CASE WHEN true THEN loop ELSE 0 END INTO v_x FROM {self.T} LIMIT 1;\n"),
        }.items():
            with self.subTest(shape=name):
                self.assertTrue(self.accepts(
                    f"r24_live_{name}", self.routine(self.HEAD + text + self.GUARD + self.PRIV)))

    def test_sql_case_after_a_live_guard(self) -> None:
        body = self.HEAD + self.GUARD + f"  {self.arm('loop')}\n" + self.PRIV
        self.assertTrue(self.accepts("r24_after_guard", self.routine(body)))


#: 29 fresh compositions. Every one COMPILES on PostgreSQL 17.11 and was RUN as
#: a non-member; `must_accept` is what the measured runtime requires.
def _r24_mutants(base: _Round24Base) -> dict[str, tuple[str, bool]]:
    g, gi, u, h, t = base.GUARD, base.INNER_GUARD, base.PRIV, base.HEAD, base.T
    dl, arm = base.dead_loop, base.arm
    inner = "    LOOP\n" + gi + "      EXIT;\n    END LOOP;\n"
    return {
        "01_codex_then_loop_in_perform": (dl(arm("loop")), False),
        "02_else_arm_loop": (dl(arm("loop", "ELSE")), False),
        "03_nested_sql_case_loop": (dl(
            "PERFORM (SELECT CASE WHEN true THEN CASE WHEN true THEN loop ELSE 0 END"
            f" ELSE 0 END FROM {t} LIMIT 1);"), False),
        "04_select_into_case_loop": (dl(
            f"SELECT CASE WHEN true THEN loop ELSE 0 END INTO v_x FROM {t} LIMIT 1;"), False),
        "05_assignment_case_loop": (dl(
            f"v_x := (SELECT CASE WHEN true THEN loop ELSE 0 END FROM {t} LIMIT 1);"), False),
        "06_while_false_then_loop": (dl(arm("loop"), "WHILE false LOOP"), False),
        "07_foreach_empty_then_loop": (dl(
            arm("loop"), "FOREACH v_x IN ARRAY ARRAY[]::integer[] LOOP"), False),
        "08_then_begin_column": (dl(arm("begin")), False),
        "09_then_if_column": (dl(arm("if")), False),
        "10_labelled_dead_loop_then_loop": (
            h + "  <<lp>>\n  FOR v_x IN SELECT 1 WHERE false LOOP\n" + gi
            + f"    {arm('loop')}\n  END LOOP lp;\n" + u, False),
        "11_sql_case_loop_before_live_guard": (h + f"  {arm('loop')}\n" + g + u, True),
        "12_sql_case_loop_after_live_guard": (h + g + f"  {arm('loop')}\n" + u, True),
        "13_plpgsql_case_then_loop_dead": (
            h + "  CASE WHEN false THEN\n" + inner + "  ELSE\n    NULL;\n  END CASE;\n" + u, False),
        "14_plpgsql_case_then_loop_live_guard_after": (
            h + "  CASE WHEN true THEN\n    LOOP\n      EXIT;\n    END LOOP;\n"
            "  ELSE\n    NULL;\n  END CASE;\n" + g + u, True),
        "15_if_false_then_loop_dead": (h + "  IF false THEN\n" + inner + "  END IF;\n" + u, False),
        "16_entered_for_loop_live_guard_after": (
            h + "  FOR v_x IN SELECT 1 LOOP\n    NULL;\n  END LOOP;\n" + g + u, True),
        "17_exception_column_live_guard": (
            h + "  PERFORM (SELECT CASE WHEN true THEN exception ELSE 0 END"
            " FROM public.r24_t LIMIT 1);\n" + g + u, True),
        "18_plpgsql_case_sqlcase_in_when_then_loop_dead": (
            h + "  CASE WHEN (SELECT CASE WHEN true THEN 0 ELSE 1 END) = 1 THEN\n" + inner
            + "  ELSE\n    NULL;\n  END CASE;\n" + u, False),
        "19_plpgsql_case_else_loop_dead": (
            h + "  CASE WHEN true THEN\n    NULL;\n  ELSE\n" + inner + "  END CASE;\n" + u, False),
        "20_nested_plpgsql_case_then_loop_dead": (
            h + "  CASE WHEN true THEN\n    CASE WHEN false THEN\n" + inner
            + "    ELSE\n      NULL;\n    END CASE;\n  END CASE;\n" + u, False),
        "21_if_cond_sqlcase_then_loop_dead": (
            h + "  IF (SELECT CASE WHEN true THEN false ELSE true END) THEN\n" + inner
            + "  END IF;\n" + u, False),
        "22_handler_then_loop_then_live_guard": (
            h + "  BEGIN\n    RAISE EXCEPTION 'x';\n  EXCEPTION WHEN others THEN\n"
            "    LOOP\n      EXIT;\n    END LOOP;\n  END;\n" + g + u, True),
        "23_deny_branch_sqlcase_loop_then_raise": (
            h + "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            f"    {arm('loop')}\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n" + u, True),
        "24_deny_branch_sqlcase_else_loop_then_raise": (
            h + "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            f"    {arm('loop', 'ELSE')}\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n" + u, True),
        "25_while_header_contains_loop_column": (
            h + f"  WHILE (SELECT CASE WHEN true THEN loop ELSE 0 END FROM {t} LIMIT 1) = 0 LOOP\n"
            + gi + "  END LOOP;\n" + u, False),
        "26_exception_column_then_real_swallowing_handler": (
            h + "  BEGIN\n    PERFORM (SELECT CASE WHEN true THEN exception ELSE 0 END"
            " FROM public.r24_t LIMIT 1);\n" + gi
            + "    UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
            "  EXCEPTION WHEN others THEN\n    NULL;\n  END;\n" + u, False),
        "27_labelled_real_while_exit_live_guard_after": (
            h + "  <<lp>>\n  WHILE true LOOP\n    EXIT lp;\n  END LOOP lp;\n" + g + u, True),
        "28_real_foreach_entered_live_guard_after": (
            h + "  FOREACH v_x IN ARRAY v_arr LOOP\n    NULL;\n  END LOOP;\n" + g + u, True),
        "29_sqlcase_loop_in_select_into_live_guard": (
            h + f"  SELECT CASE WHEN true THEN loop ELSE 0 END INTO v_x FROM {t} LIMIT 1;\n"
            + g + u, True),
    }


class Round24ComposedMutantTests(_Round24Base):
    """Runtime, measured on 17.11 as a non-member:

      * 01-10, 13, 15, 18-21, 25 never enter the guard and commit the UPDATE
        -> REJECT. 26 enters it inside a block whose handler swallows P0001
        and then commits the outer UPDATE -> REJECT.
      * 11, 12, 14, 16, 17, 22-24, 27-29 deny (P0001 or DENIED), no write
        -> ACCEPT.

    At 388fc827, 01-07 and 10 were accepted (false greens) and 17, 23 and 24
    were rejected (false reds). Every other verdict is unchanged.
    """

    def test_composed_mutants(self) -> None:
        mutants = _r24_mutants(self)
        self.assertEqual(len(mutants), 29)
        for name, (body, must_accept) in mutants.items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(name, self.routine(body)), must_accept,
                    f"`{name}` changed verdict",
                )


class Round24RegressionBatteryTests(_Round24Base):
    """Rounds 13-23, re-proved with a SQL CASE arm naming `loop` composed on.

    The Round-22 battery is reused verbatim, and a harmless
    `PERFORM (SELECT CASE WHEN true THEN loop ELSE 0 END FROM t)` is added as the
    first statement of every routine. It changes nothing at runtime, so every
    historical verdict must survive it. The Round-23 DECLARE-chain mutants get
    the same treatment.
    """

    def compose(self, body: str) -> str:
        first = body.index("\nBEGIN\n") + len("\nBEGIN\n") if "\nBEGIN\n" in body else (
            len("BEGIN\n") if body.startswith("BEGIN\n") else None)
        self.assertIsNotNone(first, "fixture has no outer BEGIN")
        return body[:first] + f"  {self.arm('loop')}\n" + body[first:]

    def test_the_round22_battery_survives_a_sql_case_loop(self) -> None:
        battery = Round22RegressionBatteryTests.battery(self)
        self.assertGreaterEqual(len(battery), 20)
        for name, (body, must_accept) in battery.items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(f"{name}_sqlcase", self.routine(self.compose(body))),
                    must_accept, f"`{name}` changed verdict under a SQL CASE `loop`",
                )

    def test_the_round23_chain_mutants_survive_a_sql_case_loop(self) -> None:
        for name, (body, close, must_accept) in _r23_mutants(self).items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(f"{name}_sqlcase", self.routine(self.compose(body), close=close)),
                    must_accept, f"`{name}` changed verdict under a SQL CASE `loop`",
                )


# ---------------------------------------------------------------------------
# Round 25: statement ownership - one forward walk
# ---------------------------------------------------------------------------
# At a9fca633 every structural question the scanner asked was answered by
# looking BACKWARD from a token at the word or two before it. PostgreSQL 14+
# accepts nearly every keyword - reserved ones included - as a bare column label
# (`SELECT 1 end`, `SELECT 1 case`, `SELECT loop begin FROM t`), and PL/pgSQL
# hands a whole statement to the SQL parser up to its `;`, so no finite list of
# previous words separates a label from structure. Round 25 found, live on
# 17.11 with prosecdef = true and a client-executable routine:
#
#   * `SELECT a, begin raise ...` / `SELECT loop raise ...` in a deny branch
#     credited as a RAISE (the label `raise` follows the COLUMN `begin`);
#   * `SELECT 1 end INTO v_x;` popping real frames, so a swallowing handler
#     attached to nothing;
#   * `SELECT a, loop begin ...` pushing a BEGIN frame that stole a handler;
#   * `SELECT a, loop loop ...` pushing a LOOP frame that stole a real loop's
#     END LOOP, so a guard in a loop that never runs read as outer-level;
#   * `ELSEIF` - PL/pgSQL's accepted spelling of ELSIF - invisible, so a RAISE
#     in that branch was credited to the IF's deny branch;
#
# and, across the committed matrix below, 110 false REDs in the same family
# (`return`, `exit`, `else`, `then`, `case` labels; a SQL CASE's END followed
# by a label `if` / `loop`).
#
# The correction is one forward statement walk, `_statement_map()`, which every
# consumer now asks instead of a previous-word test. These classes pin it end to
# end through the real `check_file()`, parser-internally, and architecturally.
class _Round25Base(unittest.TestCase):
    """ORACLE, PostgreSQL 17.11 (`SELECT version()` = 17.11 on
    x86_64-pc-linux-gnu, disposable local cluster). Every fixture in the
    Round-25 classes was COMPILED, and every one with a stated runtime claim was
    RUN as a non-member, against

        CREATE TABLE public.bins (actual_qty integer, org_id uuid);  -- one row, 55
        CREATE TABLE public.r21_t ("loop" int, "if" int, "begin" int, "end" int,
            "declare" int, "raise" int, a int, "exception" int, "then" int,
            "else" int, "return" int, "exit" int);                   -- one row
        CREATE TABLE public.t ("begin" int, "end" int, a int, "loop" int,
            "raise" int, "return" int);                              -- one row

    with `wardah_assert_org_member(uuid)` raising P0001 and
    `wardah_is_org_member(uuid)` returning false. "Writes" means the call
    returned normally and bins.actual_qty became 0; "denies" means it failed
    with the guard's P0001 (or the fixture's own DENIED) and bins stayed 55.
    """

    HEAD = "DECLARE\n  v_x integer;\n  v_y integer;\n  r record;\nBEGIN\n"
    GUARD = "  PERFORM public.wardah_assert_org_member(p_org);\n"
    PRIV = "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
    DENY_IF = "  IF NOT public.wardah_is_org_member(p_org) THEN\n"

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_round25_{_Round22Base.slug(name)}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    def accepts(self, name: str, sql: str) -> bool:
        return self.verdict(name, sql) == []

    @staticmethod
    def routine(body: str, close: str = "END;\n") -> str:
        return _Round22Base.routine(body, close)

    def masked(self, text: str) -> str:
        masked, problems = guards.mask_sql_checked(text)
        self.assertEqual(problems, [])
        return masked

    def deny_branch(self, stmt: str, then_raise: bool = False) -> str:
        """`stmt` alone in a membership deny branch - optionally followed by a
        real RAISE - then the privileged write."""
        tail = "    RAISE EXCEPTION 'DENIED';\n" if then_raise else ""
        return self.HEAD + self.DENY_IF + f"    {stmt}\n" + tail + "  END IF;\n" + self.PRIV


class Round25BareLabelRaiseTests(_Round25Base):
    """RED 1. A bare column label `raise` after a column named `begin` or `loop`.

    Each deny branch below raises NOTHING on 17.11: the non-member call returns
    normally and writes. At a9fca633 `_opens_statement_position()` saw `begin`
    or `loop` before the label, `_is_statement_start()` said yes, and every one
    returned [] - a false green. The same statements followed by a real RAISE
    deny, and must still be accepted.
    """

    FORMS = {
        "comma_begin": "SELECT a, begin raise INTO v_x, v_y FROM public.r21_t;",
        "begin": "SELECT begin raise INTO v_x FROM public.r21_t;",
        "comma_loop": "SELECT a, loop raise INTO v_x, v_y FROM public.r21_t;",
        "loop": "SELECT loop raise INTO v_x FROM public.r21_t;",
        "after_call": "SELECT coalesce(begin, 0), begin raise INTO v_x, v_y FROM public.r21_t;",
        "subquery": "v_x := (SELECT begin raise FROM public.r21_t LIMIT 1);",
        "if_label": "SELECT if raise INTO v_x FROM public.r21_t;",
        "exception_label": "SELECT exception raise INTO v_x FROM public.r21_t;",
    }

    def test_a_bare_label_raise_is_not_a_denial(self) -> None:
        for name, stmt in self.FORMS.items():
            with self.subTest(form=name):
                self.assertFalse(
                    self.accepts(f"label_raise_{name}", self.routine(self.deny_branch(stmt))),
                    f"`{stmt}` was credited as a RAISE statement",
                )

    def test_the_same_statement_before_a_real_raise_still_denies(self) -> None:
        for name, stmt in self.FORMS.items():
            with self.subTest(form=name):
                self.assertTrue(self.accepts(
                    f"label_raise_ctl_{name}",
                    self.routine(self.deny_branch(stmt, then_raise=True)),
                ))

    def test_an_outer_bare_label_raise_does_not_kill_a_live_guard(self) -> None:
        """The other consumer, the other direction: at the outer level the same
        label read as an aborting RAISE, and the live guard after it (which
        denies on 17.11) was written off as dead - a false RED."""
        for name, stmt in self.FORMS.items():
            with self.subTest(form=name):
                self.assertTrue(self.accepts(
                    f"label_raise_outer_{name}",
                    self.routine(self.HEAD + f"  {stmt}\n" + self.GUARD + self.PRIV),
                ))

    def test_the_shared_classifier(self) -> None:
        for name, stmt in self.FORMS.items():
            with self.subTest(form=name):
                body = self.masked("BEGIN\n  " + stmt + "\n  RAISE EXCEPTION 'x';\nEND;\n")
                self.assertFalse(guards._is_statement_start(body, body.index("raise")))
                self.assertTrue(guards._is_statement_start(body, body.index("RAISE")))


class Round25BareLabelFrameTests(_Round25Base):
    """REDs 2-4. A bare column label that spells a structural keyword mutated
    the frame stack. Every fixture compiles on 17.11 and WRITES for a non-member
    (the guard's P0001 is swallowed, or the guard is never entered); at
    a9fca633 each returned [].
    """

    def test_a_bare_end_label_cannot_pop_a_real_block(self) -> None:
        """Two `SELECT 1 end` labels popped the nested BEGIN and the routine's
        own BEGIN, so the handler that swallows the guard attached to nothing
        and the guard read as a live outer-level statement."""
        body = (
            self.HEAD + "  BEGIN\n    SELECT 1 end INTO v_x;\n    SELECT 1 end INTO v_x;\n"
            "  " + self.GUARD.strip() + "\n  EXCEPTION WHEN others THEN NULL;\n  END;\n" + self.PRIV
        )
        self.assertFalse(self.accepts("fake_end_pop", self.routine(body)))

    def test_a_label_after_a_loop_column_opens_no_block(self) -> None:
        """`loop` is a column and `begin` its label; the lexical ownership test
        took `loop` as a statement-list opener and pushed a BEGIN frame that
        stole the real block's handler."""
        for handler in ("others", "raise_exception", "SQLSTATE 'P0001'"):
            with self.subTest(handler=handler):
                body = (
                    self.HEAD + "  BEGIN\n" + "  " + self.GUARD
                    + "    SELECT a, loop begin INTO v_x, v_y FROM public.r21_t;\n"  # nosec B608 - fixture text, never executed as SQL
                    f"  EXCEPTION WHEN {handler} THEN NULL;\n  END;\n" + self.PRIV
                )
                self.assertFalse(self.accepts(f"loop_begin_{handler}", self.routine(body)))

    def test_a_label_after_a_loop_column_opens_no_loop(self) -> None:
        """`loop loop` - column and label - pushed a LOOP frame that stole the
        real loop's END LOOP; the real loop never iterates."""
        body = (
            self.HEAD + "  FOR v_x IN SELECT 1 WHERE false LOOP\n" + "  " + self.GUARD  # nosec B608 - fixture text, never executed as SQL
            + "    SELECT a, loop loop INTO v_x, v_y FROM public.r21_t;\n  END LOOP;\n" + self.PRIV  # nosec B608 - fixture text, never executed as SQL
        )
        self.assertFalse(self.accepts("loop_loop", self.routine(body)))

    def test_label_tokens_mutate_no_frame(self) -> None:
        """PARSER-INTERNAL. Each label below, inside a statement that sits in a
        real block, leaves exactly the real frames."""
        for label_stmt in (
            "SELECT 1 end INTO v_x;", "SELECT 1 case INTO v_x;",
            "SELECT a, loop begin INTO v_x, v_y FROM public.r21_t;",
            "SELECT a, loop if INTO v_x, v_y FROM public.r21_t;",
            "SELECT a, loop loop INTO v_x, v_y FROM public.r21_t;",
            "SELECT a, loop exception INTO v_x, v_y FROM public.r21_t;",
            "SELECT 1 then INTO v_x;", "SELECT 1 else INTO v_x;",
            "SELECT 1 when INTO v_x;", "SELECT 1 elseif INTO v_x;",
            "v_x := (SELECT CASE WHEN true THEN 1 ELSE 0 END if);",
            "v_x := (SELECT CASE WHEN true THEN 1 ELSE 0 END loop);",
            "MERGE INTO public.t USING public.r21_t s ON false WHEN MATCHED THEN DO NOTHING;",
        ):
            with self.subTest(stmt=label_stmt):
                body = self.masked(
                    self.HEAD + "  BEGIN\n    " + label_stmt + "\n"
                    "  EXCEPTION WHEN others THEN NULL;\n  END;\nEND;\n"
                )
                frames = guards.parse_blocks(body, body)
                real = [f for f in frames if not f.sql_expr]
                self.assertEqual(sorted(f.kind for f in real), ["BEGIN", "BEGIN"])
                inner = max(real, key=lambda f: f.start)
                self.assertEqual(inner.exc_pos, body.index("EXCEPTION"))
                self.assertTrue(guards._statement_map(body).proves(frames))


class Round25ElseifTests(_Round25Base):
    """RED 5. `ELSEIF` is K_ELSIF in PostgreSQL 17.11's pl_unreserved_kwlist.h.

    `IF NOT member THEN NULL; ELSEIF false THEN RAISE ...; END IF;` compiles and
    WRITES for a non-member - the RAISE is in the ELSEIF branch - but at
    a9fca633 the token was unknown, the branch never closed the IF's deny list,
    and the RAISE was credited to it.
    """

    def test_a_raise_in_an_elseif_branch_is_not_the_deny_branch(self) -> None:
        for spelling in ("ELSEIF", "elseif", "ElseIf"):
            with self.subTest(spelling=spelling):
                body = (
                    self.HEAD + self.DENY_IF + "    NULL;\n"
                    f"  {spelling} false THEN\n    RAISE EXCEPTION 'DENIED';\n"
                    "  END IF;\n" + self.PRIV
                )
                self.assertFalse(self.accepts(f"elseif_{spelling}", self.routine(body)))

    def test_elsif_is_unchanged(self) -> None:
        body = (
            self.HEAD + self.DENY_IF + "    NULL;\n"
            "  ELSIF false THEN\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n" + self.PRIV
        )
        self.assertFalse(self.accepts("elsif_branch", self.routine(body)))

    def test_a_real_deny_before_an_elseif_still_denies(self) -> None:
        body = (
            self.HEAD + self.DENY_IF + "    RAISE EXCEPTION 'DENIED';\n"
            "  ELSEIF false THEN\n    NULL;\n  END IF;\n" + self.PRIV
        )
        self.assertTrue(self.accepts("elseif_after_deny", self.routine(body)))

    def test_elseif_closes_the_frame_like_elsif(self) -> None:
        body = self.masked(self.HEAD + "  IF true THEN NULL; ELSEIF false THEN NULL; END IF;\nEND;\n")
        (frame,) = [f for f in guards.parse_blocks(body, body) if f.kind == "IF"]
        self.assertTrue(frame.closed)


class Round25LoopHeaderTests(_Round25Base):
    """A loop header ends at its FIRST parenthesis-depth-0 LOOP
    (read_sql_construct(); brackets count). `WHILE (SELECT CASE WHEN true THEN
    loop ELSE 0 END FROM t LIMIT 1) = 0 LOOP` compiles on 17.11; its loop never
    iterates, so the guard inside is never entered and the write lands.

    At a9fca633 the verdict was right for the wrong reason: the COLUMN `loop`
    pushed a fake frame that stood in for the real loop, which owned none -
    `_closes_loop_header()`, `_opens_loop_statement()` and `_labelled_opener()`
    all took the first textual `loop` after the head. Once columns stopped
    pushing frames the real loop had to be found by the real rule.
    """

    WHILE = "WHILE (SELECT CASE WHEN true THEN loop ELSE 0 END FROM public.r21_t LIMIT 1) = 0 LOOP"

    def test_the_real_loop_owns_the_frame(self) -> None:
        body = self.masked(self.HEAD + f"  {self.WHILE}\n" + self.GUARD + "  END LOOP;\nEND;\n")
        real = body.index("LOOP\n")
        loops = [f for f in guards.parse_blocks(body, body) if f.kind == "LOOP"]
        self.assertEqual([f.start for f in loops], [real])
        head = guards._LOOP_HEAD_RE.match(body, body.index("WHILE"))
        self.assertEqual(guards._loop_keyword_of(body, head), real)
        self.assertEqual(guards._labelled_opener(body, body.index("WHILE")), real)

    def test_a_guard_in_that_loop_is_not_outer_level(self) -> None:
        body = self.HEAD + f"  {self.WHILE}\n" + self.GUARD + "  END LOOP;\n" + self.PRIV
        self.assertFalse(self.accepts("while_header_column", self.routine(body)))

    def test_a_labelled_loop_keeps_its_label(self) -> None:
        body = self.masked(
            self.HEAD + f"  <<lp>>\n  {self.WHILE}\n    EXIT lp;\n" + self.GUARD
            + "  END LOOP lp;\nEND;\n"
        )
        (loop,) = [f for f in guards.parse_blocks(body, body) if f.kind == "LOOP"]
        self.assertEqual(loop.label, "lp")
        self.assertEqual(loop.start, body.index("LOOP\n"))


class Round25FalseRedTests(_Round25Base):
    """Every fixture DENIES a non-member on 17.11 and must be ACCEPTED. At
    a9fca633 each was rejected, because a label spelled `return`, `exit`,
    `else` or a SQL CASE's `END if` was read as a statement or as structure."""

    def test_structural_labels_before_a_live_guard(self) -> None:
        for stmt in (
            "SELECT a return INTO v_x FROM public.r21_t;",
            "SELECT a AS return INTO v_x FROM public.r21_t;",
            "v_x := (SELECT 1 return);",
            "PERFORM 1 return;",
            "SELECT exit blk INTO v_x FROM public.r21_t;",
            "SELECT 1 case INTO v_x;",
            "v_x := (SELECT CASE WHEN true THEN 1 ELSE 0 END if);",
            "v_x := (SELECT CASE WHEN true THEN 1 ELSE 0 END loop);",
            "UPDATE public.t SET a = a WHERE false RETURNING a return INTO v_x;",
        ):
            with self.subTest(stmt=stmt):
                self.assertTrue(self.accepts(
                    "live_guard_after_label",
                    self.routine(self.HEAD + f"  {stmt}\n" + self.GUARD + self.PRIV),
                ))

    def test_structural_labels_inside_a_real_deny_branch(self) -> None:
        for stmt in (
            "SELECT 1 else INTO v_x;",
            "SELECT a return INTO v_x FROM public.r21_t;",
            "SELECT 1 then INTO v_x;",
            "MERGE INTO public.t USING public.r21_t s ON false WHEN MATCHED THEN DO NOTHING;",
        ):
            with self.subTest(stmt=stmt):
                self.assertTrue(self.accepts(
                    "deny_after_label", self.routine(self.deny_branch(stmt, then_raise=True))
                ))

    def test_a_label_named_like_a_block_label_is_no_exit(self) -> None:
        """`SELECT exit blk` - column `exit`, label `blk` - inside the
        routine's own `<<blk>>` block jumps nowhere; the guard after it denies
        on 17.11. The real `EXIT blk;` mirror leaves the routine before the
        guard ever runs (17.11: no error, nothing executed after it), so the
        guard authorizes nothing and it must still reject."""
        fake = "  SELECT exit blk INTO v_x FROM public.r21_t;\n"
        self.assertTrue(self.accepts(
            "exit_label", self.routine("<<blk>>\n" + self.HEAD + fake + self.GUARD + self.PRIV,
                                       close="END blk;\n")))
        self.assertFalse(self.accepts(
            "exit_real", self.routine("<<blk>>\n" + self.HEAD + "  EXIT blk;\n" + self.GUARD
                                      + self.PRIV, close="END blk;\n")))


class Round25RealStructureTests(_Round25Base):
    """Genuine PL/pgSQL keeps every verdict, with Round-25 labels composed in.

    REJECT fixtures write for a non-member on 17.11, abort before a dead
    guard, or leave the routine before the guard runs; ACCEPT fixtures deny.
    The label statement is harmless at runtime. Measured at a9fca633 on these
    96 fixtures: 3 false greens and 18 false reds.
    """

    LABELS = (
        "NULL;",
        "SELECT 1 end INTO v_x;",
        "SELECT a, loop begin INTO v_x, v_y FROM public.r21_t;",
        "SELECT begin raise INTO v_x FROM public.r21_t;",
        "SELECT a return INTO v_x FROM public.r21_t;",
        "v_x := (SELECT CASE WHEN true THEN 1 ELSE 0 END loop);",
    )

    def shapes(self, f: str) -> dict[str, tuple[str, bool]]:
        g, p, h = self.GUARD.strip(), self.PRIV, self.HEAD
        return {
            "labelled_exit_skips": (h + f"  <<blk>>\n  BEGIN\n    {f}\n    EXIT blk;\n    {g}\n  END blk;\n" + p, False),
            "return_before_guard": (h + f"  IF p_org IS NOT NULL THEN\n    {f}\n    RETURN;\n  END IF;\n  {g}\n" + p, False),
            "return_in_deny": (h + self.DENY_IF + f"    {f}\n    RETURN;\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n" + p, False),
            "handler_raise_exception": (h + f"  BEGIN\n    {f}\n    {g}\n  EXCEPTION WHEN raise_exception THEN NULL;\n  END;\n" + p, False),
            "handler_sqlstate": (h + f"  BEGIN\n    {g}\n    {f}\n  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;\n  END;\n" + p, False),
            "guard_in_case_arm": (h + f"  CASE WHEN false THEN\n    {g}\n    {f}\n  ELSE\n    NULL;\n  END CASE;\n" + p, False),
            "real_abort_then_dead_guard": (h + f"  {f}\n  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n  {g}\n" + p, False),
            "labelled_loop_exit_when": (h + f"  <<lp>>\n  LOOP\n    {f}\n    EXIT lp WHEN true;\n    {g}\n  END LOOP lp;\n" + p, False),
            "nested_declare_raise_var": (h + self.DENY_IF + f"    DECLARE\n      raise integer := 1;\n    BEGIN\n      {f}\n      raise := 2;\n    END;\n  END IF;\n" + p, False),
            "live_after_labelled_block": (h + f"  <<blk>>\n  BEGIN\n    {f}\n    EXIT blk;\n  END blk;\n  {g}\n" + p, True),
            "live_after_case_statement": (h + f"  CASE WHEN true THEN\n    {f}\n  ELSE\n    NULL;\n  END CASE;\n  {g}\n" + p, True),
            "live_after_unrelated_handler": (h + f"  BEGIN\n    {f}\n  EXCEPTION WHEN unique_violation THEN NULL;\n  END;\n  {g}\n" + p, True),
            "live_after_for_loop": (h + f"  FOR v_y IN 1..2 LOOP\n    {f}\n  END LOOP;\n  {g}\n" + p, True),
            "live_after_handler_declare": (h + f"  BEGIN\n    NULL;\n  EXCEPTION WHEN others THEN\n    DECLARE raise integer := 1;\n    BEGIN\n      {f}\n    END;\n  END;\n  {g}\n" + p, True),
            "real_deny_then_nested_declare": (h + self.DENY_IF + f"    {f}\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n  DECLARE\n    raise integer := 1;\n  BEGIN\n    raise := 2;\n  END;\n" + p, True),
            "standalone_guard": (h + f"  {f}\n  {g}\n" + p, True),
        }

    def test_real_structure_keeps_every_verdict(self) -> None:
        for label in self.LABELS:
            for name, (body, must_accept) in self.shapes(label).items():
                with self.subTest(shape=name, label=label):
                    self.assertEqual(
                        self.accepts(f"r25_{name}", self.routine(body)), must_accept,
                        f"`{name}` with `{label}` changed verdict",
                    )


#: The Round-25 matrix. Each context holds `{w}` where a word stands as a bare
#: column label, an `AS` label, a qualified column, or the column before a
#: `raise` label.
R25_CONTEXTS = (
    "SELECT a {w} INTO v_x FROM public.r21_t;",
    "SELECT a, loop {w} INTO v_x, v_y FROM public.r21_t;",
    "SELECT a, begin {w} INTO v_x, v_y FROM public.r21_t;",
    "SELECT {w} raise INTO v_x FROM public.r21_t;",
    "v_x := (SELECT 1 {w});",
    "PERFORM 1 {w};",
    "SELECT a AS {w} INTO v_x FROM public.r21_t;",
    "v_x := (SELECT CASE WHEN true THEN 1 ELSE 0 END {w});",
    "SELECT x.{w} INTO v_x FROM public.r21_t x;",
    "UPDATE public.t SET a = a WHERE false RETURNING a {w} INTO v_x;",
    "IF (SELECT 1 {w}) = 1 THEN NULL; END IF;",
    "WHILE (SELECT 0 {w}) = 1 LOOP NULL; END LOOP;",
    "FOR r IN SELECT a {w} FROM public.r21_t LOOP NULL; END LOOP;",
    "RAISE NOTICE '%', (SELECT 1 {w});",
    "SELECT 1 {w}, 2 raise INTO v_x, v_y;",
    "SELECT CASE WHEN true THEN (SELECT 1 {w}) ELSE 0 END INTO v_x;",
    "IF v_x {w} THEN NULL; END IF;",
    "CASE (SELECT 1 {w}) WHEN 1 THEN NULL; ELSE NULL; END CASE;",
    "v_x := (SELECT count(*) FROM (SELECT 1 {w}) s);",
)
R25_WORDS = (
    "exit", "begin", "end", "case", "when", "then", "else", "if", "loop",
    "exception", "elsif", "elseif", "raise", "declare", "return", "while",
    "foreach", "null", "perform",
)
#: (context index, word) pairs PostgreSQL 17.11 does not compile - a reserved
#: word as a bare column, a header whose first depth-0 terminator is the label,
#: or a column the oracle table does not have. Measured, not inferred.
R25_NOT_COMPILED = frozenset({
    (3, "end"), (3, "then"), (3, "else"),          # syntax error at the word
    (12, "loop"),                                  # FOR header ends at the label
    (16, "then"),                                  # IF header ends at the label
    *((ci, w) for ci in (3, 8) for w in (
        "case", "when", "elsif", "elseif", "while", "foreach", "null", "perform",
    )),                                            # no such column
})


class Round25MatrixTests(_Round25Base):
    """19 words x 19 contexts, minus the 21 pairs 17.11 does not compile, is
    340 statements; each is run in seven probe shapes, 2,380 fixtures, every
    one compiled AND run on 17.11 as a non-member. A, C, C2 and F write; B
    aborts before a dead guard -> REJECT. D and E deny -> ACCEPT. Measured at
    a9fca633 on these exact fixtures: 6 false greens and 110 false reds."""

    def statements(self) -> list[str]:
        out = []
        for ci, ctx in enumerate(R25_CONTEXTS):
            for w in R25_WORDS:
                if (ci, w) not in R25_NOT_COMPILED:
                    out.append(ctx.format(w=w))
        return out

    def probes(self, s: str) -> dict[str, tuple[str, bool]]:
        g, h, p = self.GUARD.strip(), self.HEAD, self.PRIV
        return {
            "A_deny_without_raise": (h + self.DENY_IF + f"    {s}\n  END IF;\n" + p, False),
            "B_dead_guard": (h + f"  {s}\n  RAISE EXCEPTION 'NOT_IMPLEMENTED';\n  {g}\n" + p, False),
            "C_swallowed_after": (h + f"  BEGIN\n    {g}\n    {s}\n  EXCEPTION WHEN others THEN NULL;\n  END;\n" + p, False),
            "C2_swallowed_before": (h + f"  BEGIN\n    {s}\n    {g}\n  EXCEPTION WHEN others THEN NULL;\n  END;\n" + p, False),
            "D_live_guard": (h + f"  {s}\n  {g}\n" + p, True),
            "E_real_deny": (h + self.DENY_IF + f"    {s}\n    RAISE EXCEPTION 'DENIED';\n  END IF;\n" + p, True),
            "F_dead_loop": (h + f"  FOR v_x IN SELECT 1 WHERE false LOOP\n    {g}\n    {s}\n  END LOOP;\n" + p, False),
        }

    def test_the_matrix(self) -> None:
        statements = self.statements()
        self.assertEqual(len(statements), len(R25_CONTEXTS) * len(R25_WORDS) - len(R25_NOT_COMPILED))
        for s in statements:
            for name, (body, must_accept) in self.probes(s).items():
                with self.subTest(probe=name, stmt=s):
                    self.assertEqual(
                        self.accepts(f"m_{name}", self.routine(body)), must_accept,
                        f"{name}: `{s}`",
                    )


class Round25StatementMapTests(_Round25Base):
    """PARSER-INTERNAL. What the forward walk proves, asserted directly."""

    def test_positions_structure_and_inert_text(self) -> None:
        body = self.masked(
            "CREATE FUNCTION public.f(p_org uuid) RETURNS void LANGUAGE plpgsql AS $f$\n"
            "DECLARE\n  raise integer := (SELECT 1 end);\nBEGIN\n"
            "  SELECT a, begin raise INTO v_x, v_y FROM public.r21_t;\n"
            "  IF (SELECT CASE WHEN true THEN 1 END) = 1 THEN\n"
            "    raise := 2;\n  ELSEIF false THEN\n    RAISE EXCEPTION 'x';\n  END IF;\n"
            "END;\n$f$;\n"
        )
        body = body[:body.rindex("$f$")]  # what check_file() passes: up to the closing tag
        walk = guards._statement_map(body)
        self.assertIsNone(walk.violation)
        at = body.index
        for word in ("DECLARE", "BEGIN\n", "IF (", "THEN\n", "ELSEIF", "RAISE", "END IF"):
            with self.subTest(structural=word):
                self.assertIn(at(word), walk.structural)
        self.assertEqual({at("CASE"), at("WHEN"), at("THEN 1"), at("END)")} & walk.sql_case,
                         {at("CASE"), at("WHEN"), at("THEN 1"), at("END)")})
        for word in ("end);", "begin raise", "raise INTO"):
            with self.subTest(inert=word):
                self.assertTrue(walk.is_inert(at(word)))
        self.assertFalse(guards._is_statement_start(body, at("raise integer")))
        self.assertFalse(guards._is_statement_start(body, at("raise INTO")))
        self.assertFalse(guards._is_statement_start(body, at("raise := 2")))
        self.assertTrue(guards._is_statement_start(body, at("RAISE EXCEPTION")))
        self.assertTrue(guards._is_statement_start(body, at("SELECT a")))

    def test_text_postgresql_rejects_is_a_violation(self) -> None:
        """Each compiles NOWHERE - 17.11 raises a syntax error - and each is
        recorded as a violation rather than guessed at."""
        for text in (
            "BEGIN\n  NULL;;\nEND;\n",
            "BEGIN\n  NULL;\n  ELSE\n  NULL;\nEND;\n",
            "BEGIN\n  IF true\n  NULL;\n  END IF;\nEND;\n",
            "BEGIN\n  WHILE true NULL; END LOOP;\nEND;\n",
            "BEGIN\n  LOOP\n    NULL;\nEND;\n",
            "BEGIN\n  CASE WHEN true THEN NULL ELSE NULL END CASE;\nEND;\n",
            "BEGIN\n  v_x := (SELECT CASE WHEN true THEN 1);\nEND;\n",
            "BEGIN\n  EXCEPTION WHEN others THEN NULL;\n  NULL;\n  EXCEPTION WHEN others THEN NULL;\nEND;\n",
        ):
            with self.subTest(text=text):
                self.assertIsNotNone(guards._statement_map(self.masked(text)).violation)

    def test_every_statement_form_is_accounted_for(self) -> None:
        """The pl_gram.y statement set, each in a form 17.11 compiles."""
        body = self.masked(
            "#variable_conflict use_column\n<<outer>>\nDECLARE\n  c CURSOR FOR SELECT 1;\n"
            "  v integer;\nBEGIN\n"
            "  v := 1; v = 2; PERFORM 1; SELECT 1 INTO v; NULL; EXECUTE 'SELECT 1';\n"
            "  GET DIAGNOSTICS v = ROW_COUNT; OPEN c; FETCH c INTO v; CLOSE c;\n"
            "  ASSERT true, 'x'; RAISE NOTICE 'x'; CALL public.p();\n"
            "  IF true THEN NULL; ELSIF false THEN NULL; ELSEIF false THEN NULL; ELSE NULL; END IF;\n"
            "  CASE v WHEN 1, 2 THEN NULL; ELSE NULL; END CASE;\n"
            "  CASE WHEN v = 1 THEN NULL; END CASE;\n"
            "  <<lp>> LOOP EXIT lp WHEN true; CONTINUE lp WHEN false; END LOOP lp;\n"
            "  WHILE false LOOP NULL; END LOOP;\n"
            "  FOR i IN REVERSE 10..1 BY 2 LOOP NULL; END LOOP;\n"
            "  FOR r IN EXECUTE 'SELECT 1' USING v LOOP NULL; END LOOP;\n"
            "  FOREACH v SLICE 0 IN ARRAY ARRAY[1] LOOP NULL; END LOOP;\n"
            "  DECLARE DECLARE BEGIN NULL; END;\n"
            "  BEGIN NULL; EXCEPTION WHEN unique_violation OR SQLSTATE '22012' THEN NULL;"
            " WHEN others THEN RAISE; END;\n"
            "  RETURN;\nEND outer;\n"
        )
        walk = guards._statement_map(body)
        self.assertIsNone(walk.violation, body[walk.violation or 0:][:60])
        self.assertTrue(walk.proves(guards.parse_blocks(body, body)))

    def test_frames_that_differ_from_the_walk_prove_nothing(self) -> None:
        body = self.masked(self.HEAD + "  BEGIN\n    NULL;\n  EXCEPTION WHEN others THEN NULL;\n  END;\nEND;\n")
        walk = guards._statement_map(body)
        frames = guards.parse_blocks(body, body)
        self.assertTrue(walk.proves(frames))
        self.assertFalse(walk.proves(frames[1:]), "a dropped frame went unnoticed")
        inner = max(frames, key=lambda f: f.start)
        saved, inner.exc_pos = inner.exc_pos, None
        try:
            self.assertFalse(walk.proves(frames), "a dropped handler went unnoticed")
        finally:
            inner.exc_pos = saved


class Round25FailClosedTests(_Round25Base):
    """Ambiguity is fail-closed at the verdict, under the strict contract."""

    def test_a_body_the_walk_cannot_account_for_credits_no_guard(self) -> None:
        """The guard is real and standalone, but the CASE statement before it is
        PostgreSQL-invalid (17.11: syntax error at or near "ELSE"), so no
        structure around it is proven."""
        body = (
            self.HEAD + "  CASE WHEN p_org IS NULL THEN NULL ELSE NULL END CASE;\n"
            + self.GUARD + self.PRIV
        )
        self.assertFalse(self.accepts("invalid_case", self.routine(body)))
        valid = body.replace("THEN NULL ELSE NULL END", "THEN NULL; ELSE NULL; END")
        self.assertTrue(self.accepts("valid_case", self.routine(valid)))

    def test_a_frame_model_gap_credits_no_guard(self) -> None:
        """Simulated: a frame walk that drops a real handler. The guard would
        read as live; the statement walk's disagreement refuses it."""
        body = (
            self.HEAD + "  BEGIN\n  " + self.GUARD
            + "  EXCEPTION WHEN others THEN NULL;\n  END;\n" + self.PRIV
        )
        self.assertFalse(self.accepts("handler_kept", self.routine(body)))
        original = guards._control_frames

        def drop_handlers(*args, **kwargs):
            frames = original(*args, **kwargs)
            for f in frames:
                f.exc_pos = None
            return frames

        guards._control_frames = drop_handlers
        try:
            self.assertFalse(self.accepts("handler_dropped", self.routine(body)))
        finally:
            guards._control_frames = original


class Round25ArchitectureTests(unittest.TestCase):
    """ARCHITECTURAL. One ownership layer, and every consumer asks it."""

    def test_the_previous_word_statement_test_is_gone(self) -> None:
        self.assertFalse(hasattr(guards, "_opens_statement_position"))
        self.assertIn("_statement_map(body)", inspect.getsource(guards._is_statement_start))

    def test_every_statement_evidence_consumer_asks_the_walk(self) -> None:
        for fn in (guards.unconditional_abort_before, guards.parse_blocks,
                   guards._terminating_return_between, guards._exit_targets):
            with self.subTest(fn=fn.__name__):
                self.assertIn("_is_statement_start(", inspect.getsource(fn))
        self.assertIn("_terminating_return_between(", inspect.getsource(guards.terminating_return_before))
        self.assertIn(
            "_terminating_return_between(",
            inspect.getsource(guards._if_blocks_with_raising_deny_branch),
        )

    def test_the_frame_walk_drops_inert_tokens_first(self) -> None:
        walk = inspect.getsource(guards._control_frames)
        self.assertIn("statements = _statement_map(body)", walk)
        inert = walk.index("statements.is_inert(m.start())")
        self.assertLess(inert, walk.index("_owns_control_frame(body, token, m.start(), owns)"))
        self.assertLess(inert, walk.index("on_raise(stack, m)"))

    def test_default_block_positions_come_from_the_walk(self) -> None:
        self.assertIn("_statement_map(body).positions",
                      inspect.getsource(guards._opens_block_position))
        self.assertIn("_statement_map(body).structural",
                      inspect.getsource(guards._owns_control_frame))

    def test_loop_heads_share_one_terminator_rule(self) -> None:
        for fn in (guards._closes_loop_header, guards._opens_loop_statement,
                   guards._labelled_opener):
            with self.subTest(fn=fn.__name__):
                self.assertIn("_loop_keyword_of(", inspect.getsource(fn))
        self.assertIn("_header_terminator(", inspect.getsource(guards._StatementWalk.header))

    def test_the_strict_verdict_requires_proven_structure(self) -> None:
        self.assertIn(".proves(frames)", inspect.getsource(guards.has_recognized_guard))


class Round25RegressionBatteryTests(_Round24Base):
    """Rounds 13-24, re-proved with the Round-25 labels composed on.

    `PERFORM 1 end, 2 case, 3 then, 4 else, loop begin, begin raise FROM
    public.r21_t;` - four structural bare labels, a label after a `loop` column
    and a `raise` label after a `begin` column - is added as the first
    statement of every historical fixture. It compiles in all of them on 17.11
    and changes nothing at runtime, so every verdict must survive it.
    """

    LABELS = "PERFORM 1 end, 2 case, 3 then, 4 else, loop begin, begin raise FROM public.r21_t;"

    def compose(self, body: str) -> str:
        first = body.index("\nBEGIN\n") + len("\nBEGIN\n") if "\nBEGIN\n" in body else (
            len("BEGIN\n") if body.startswith("BEGIN\n") else None)
        self.assertIsNotNone(first, "fixture has no outer BEGIN")
        return body[:first] + f"  {self.LABELS}\n" + body[first:]

    def test_the_round22_battery(self) -> None:
        for name, (body, must_accept) in Round22RegressionBatteryTests.battery(self).items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(f"{name}_r25", self.routine(self.compose(body))),
                    must_accept, f"`{name}` changed verdict under Round-25 labels",
                )

    def test_the_round23_chain_mutants(self) -> None:
        for name, (body, close, must_accept) in _r23_mutants(self).items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(f"{name}_r25", self.routine(self.compose(body), close=close)),
                    must_accept, f"`{name}` changed verdict under Round-25 labels",
                )

    def test_the_round24_sql_case_mutants(self) -> None:
        for name, (body, must_accept) in _r24_mutants(self).items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(f"{name}_r25", self.routine(self.compose(body))),
                    must_accept, f"`{name}` changed verdict under Round-25 labels",
                )


# ---------------------------------------------------------------------------
# Round 26: a handler section reachable before authorization
# ---------------------------------------------------------------------------
# Every earlier round asked one question of an EXCEPTION section: can it catch
# the guard's OWN denial (P0001, or its class P0000)? That is not the only way
# the section runs. PL/pgSQL enters a block's handlers for ANY error raised in
# the block's statement list - a failed lookup, an arithmetic error, a failed
# evaluation of the guard's own argument, even the guard call failing to
# resolve - and every one of those can happen BEFORE the guard has returned.
# The handler then runs with no authorization established, and whatever it does
# is the routine's result. Independent review found this live on 17.11 at
# 43edbf62, with check_file() returning [] for each shape below.
#
# The rule (strict contract only): a guard - or the IF of the negated-predicate
# idiom - inside a block that owns an EXCEPTION section is credited only when
# that section is PROVABLY HARMLESS if entered early: every handler statement is
# `NULL;` or a bare re-raising `RAISE;`, and the block declares nothing. The
# second half is not decoration. A block's declarations are initialized BEFORE
# the subtransaction its handlers roll back, so an initializer - or the CHECK of
# a domain-typed variable, which 17.11 evaluates even with no initializer - that
# has a side effect survives a `NULL;` handler that returns normally.
# "The guard comes first" is deliberately NOT a proof: its argument can fail to
# evaluate, and the call itself can fail to resolve (a `text` parameter passed
# to the uuid helper raises undefined_function), both before any authorization.


class _Round26Base(_Round25Base):
    """ORACLE, PostgreSQL 17.11 (x86_64-pc-linux-gnu, disposable local cluster).
    The `_Round25Base` schema, plus

        CREATE TABLE public.u (id integer PRIMARY KEY);            -- row (1)
        CREATE FUNCTION public.r26_touch(uuid) RETURNS integer      -- writes bins
        CREATE FUNCTION public.r26_chk(integer) RETURNS boolean     -- writes bins
        CREATE DOMAIN public.r26_dz AS integer CHECK (public.r26_chk(VALUE));

    Every fixture below was COMPILED and RUN as a non-member. "Writes" means the
    call returned normally and bins.actual_qty went 55 -> 0 with the guard never
    having authorized anything; "safe" means the guard denied (bins 55) or the
    routine returned having changed nothing (bins 55).
    """

    HANDLED = "EXCEPTION WHEN {cond} THEN\n"

    def plain(self, pre: str, cond: str, handler: str, decl: str = "") -> str:
        """`pre` then the guard, in the routine's own block, whose handler for
        `cond` runs `handler`."""
        head = f"DECLARE\n{decl}" if decl else ""
        return (
            head + "BEGIN\n" + pre + self.GUARD
            + self.HANDLED.format(cond=cond) + handler
        )

    # 1-7 and the variants: each WRITES on 17.11 and each was accepted at 43edbf62.
    def unsafe(self) -> dict:
        err = "  v_x := 1 / 0;\n"
        var = "  v_x integer;\n"
        return {
            "runtime_error_before_guard": (
                self.plain(err, "division_by_zero", self.PRIV, var), "END;\n"),
            "strict_lookup_before_guard": (
                self.plain("  SELECT a INTO STRICT v_x FROM public.t WHERE a = 42;\n",
                           "no_data_found", self.PRIV, var), "END;\n"),
            "category_handler": (
                self.plain(err, "data_exception", self.PRIV, var), "END;\n"),
            "explicit_sqlstate_handler": (
                self.plain(err, "SQLSTATE '22012'", self.PRIV, var), "END;\n"),
            "labelled_block": (
                "<<blk>>\n" + self.plain(err, "division_by_zero", self.PRIV, var),
                "END blk;\n"),
            "guard_argument_fails": (
                "BEGIN\n  PERFORM public.wardah_assert_org_member((1 / 0)::text::uuid);\n"
                + self.HANDLED.format(cond="division_by_zero") + self.PRIV, "END;\n"),
            "unrelated_handler_reached_by_earlier_failure": (
                self.plain("  INSERT INTO public.u (id) VALUES (1);\n",
                           "unique_violation", self.PRIV), "END;\n"),
            "deny_branch_with_custom_sqlstate": (
                "BEGIN\n" + self.DENY_IF + "    RAISE insufficient_privilege;\n"
                "  END IF;\n" + self.HANDLED.format(cond="insufficient_privilege")
                + self.PRIV, "END;\n"),
            "predicate_idiom_after_a_failure": (
                "DECLARE\n" + var + "BEGIN\n" + err + self.DENY_IF
                + "    RAISE EXCEPTION 'DENIED';\n  END IF;\n"
                + self.HANDLED.format(cond="division_by_zero") + self.PRIV, "END;\n"),
            "null_handler_initializer_side_effect": (
                self.plain(err, "division_by_zero", "  NULL;\n",
                           "  v_w integer := public.r26_touch(p_org);\n" + var),
                "END;\n"),
            "null_handler_domain_check_side_effect": (
                self.plain(err, "division_by_zero", "  NULL;\n",
                           "  v_d public.r26_dz;\n" + var), "END;\n"),
        }

    def resolution_failure(self) -> str:
        """The guard is the block's FIRST statement with a bare parameter as its
        argument - and still never runs: the parameter is `text`, so the call
        raises undefined_function and the handler writes. Live on 17.11."""
        return self.routine(
            "BEGIN\n  PERFORM public.wardah_assert_org_member(p_org);\n"
            + self.HANDLED.format(cond="undefined_function")
            + "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org::uuid;\n"
        ).replace("f_probe(p_org uuid)", "f_probe(p_org text)")

    # 8-10 and the harmless-section forms: each is safe on 17.11.
    def safe(self) -> dict:
        var = "  v_x integer;\n"
        return {
            "no_handler": (
                "DECLARE\n" + var + "BEGIN\n  v_x := 1;\n" + self.GUARD + self.PRIV),
            "authorization_before_later_risky_code": (
                "DECLARE\n" + var + "BEGIN\n" + self.GUARD
                + "  BEGIN\n    v_x := 1 / 0;\n  EXCEPTION WHEN division_by_zero THEN\n  "
                + self.PRIV + "  END;\n" + self.PRIV),
            "unrelated_handler_outside_the_guard_block": (
                "DECLARE\n" + var + "BEGIN\n"
                "  BEGIN\n    v_x := 1 / 0;\n  EXCEPTION WHEN division_by_zero THEN\n"
                "    NULL;\n  END;\n" + self.GUARD + self.PRIV),
            "inert_null_handler": (
                "BEGIN\n  INSERT INTO public.u (id) VALUES (1);\n" + self.GUARD
                + self.PRIV + self.HANDLED.format(cond="unique_violation") + "  NULL;\n"),
            "inert_reraise_handler": (
                "BEGIN\n  PERFORM 1 / 0;\n" + self.GUARD + self.PRIV
                + self.HANDLED.format(cond="division_by_zero") + "  RAISE;\n"),
            "inert_handler_on_an_empty_declare_chain": (
                "DECLARE\nDECLARE\nBEGIN\n  PERFORM 1 / 0;\n" + self.GUARD + self.PRIV
                + self.HANDLED.format(cond="division_by_zero")
                + "  NULL;\n  NULL;\n"),
            "inert_handler_predicate_idiom": (
                "BEGIN\n" + self.DENY_IF + "    RAISE EXCEPTION 'DENIED';\n  END IF;\n"
                + self.PRIV + self.HANDLED.format(cond="unique_violation")
                + "  NULL;\n"),
        }


class Round26HandlerReachabilityTests(_Round26Base):
    """RED at 43edbf62: every unsafe shape below was accepted."""

    def test_a_handler_reachable_before_the_guard_is_not_trusted(self) -> None:
        for name, (body, close) in self.unsafe().items():
            with self.subTest(case=name):
                self.assertFalse(
                    self.accepts(f"r26_{name}", self.routine(body, close=close)),
                    f"`{name}`: the handler runs before authorization and the "
                    "routine was still accepted",
                )

    def test_the_guard_coming_first_proves_nothing(self) -> None:
        self.assertFalse(self.accepts("r26_resolution", self.resolution_failure()))

    def test_a_writing_handler_on_the_guard_block_is_refused(self) -> None:
        """Conservative, and pinned as such. On 17.11 this routine denies a
        non-member (its guard is first and resolves), but nothing in the text
        proves the section is unreachable before the guard returns - the shape
        above is the same text with one parameter type changed."""
        body = "BEGIN\n" + self.GUARD + self.PRIV + self.HANDLED.format(
            cond="unique_violation") + self.PRIV
        self.assertFalse(self.accepts("r26_conservative", self.routine(body)))


class Round26ControlTests(_Round26Base):
    """GREEN at 43edbf62 and after: no false red from the new rule."""

    def test_safe_shapes_stay_accepted(self) -> None:
        for name, body in self.safe().items():
            with self.subTest(case=name):
                self.assertTrue(self.accepts(f"r26_{name}", self.routine(body)))

    def test_a_swallowing_handler_still_rejects(self) -> None:
        for cond in ("raise_exception", "SQLSTATE 'P0001'", "plpgsql_error", "others"):
            with self.subTest(cond=cond):
                body = ("BEGIN\n" + self.GUARD + self.PRIV
                        + self.HANDLED.format(cond=cond) + "  NULL;\n")
                self.assertFalse(self.accepts("r26_swallow", self.routine(body)))

    def test_a_nested_handler_around_the_guard_still_rejects(self) -> None:
        body = ("BEGIN\n  BEGIN\n" + self.GUARD
                + "  EXCEPTION WHEN unique_violation THEN\n    NULL;\n  END;\n" + self.PRIV)
        self.assertFalse(self.accepts("r26_nested", self.routine(body)))

    def test_reachability_rules_are_unchanged(self) -> None:
        cases = {
            "real_raise_before_guard": (
                "BEGIN\n  RAISE EXCEPTION 'stop';\n" + self.GUARD + self.PRIV, "END;\n", False),
            "real_return_before_guard": (
                "BEGIN\n" + self.PRIV + "  RETURN;\n" + self.GUARD, "END;\n", False),
            "labelled_exit_before_guard": (
                "<<blk>>\nBEGIN\n" + self.PRIV + "  EXIT blk;\n" + self.GUARD,
                "END blk;\n", False),
            "labelled_exit_when_before_guard": (
                "<<blk>>\nBEGIN\n  EXIT blk WHEN p_org IS NOT NULL;\n" + self.GUARD
                + self.PRIV, "END blk;\n", False),
            "declare_chain_guard": (
                "DECLARE\nDECLARE\n  v_x integer;\nBEGIN\n" + self.GUARD + self.PRIV,
                "END;\n", True),
            "round24_sql_case_in_a_never_entered_loop": (
                "DECLARE\n  r record;\nBEGIN\n  FOR r IN SELECT 1 WHERE false LOOP\n"
                + self.GUARD + "    PERFORM (SELECT CASE WHEN true THEN loop ELSE 0 END"
                " FROM public.t);\n  END LOOP;\n" + self.PRIV, "END;\n", False),
        }
        for name, (body, close, must_accept) in cases.items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.accepts(f"r26_{name}", self.routine(body, close=close)),
                    must_accept,
                )


class Round26FixtureMigrationTests(_Round26Base):
    """`definer_outer_handler()` moved to an inert `NULL;` body in Round 26 so
    that the handler CONDITION is again the only thing under test. Nothing is
    dropped by that move: every module-level fixture it built that is accepted
    with the inert body is rebuilt here with the old `WRITING_HANDLER_BODY` and
    must now be refused - the writing handler can run before authorization."""

    OUTER_HANDLER_TAIL = "THEN\n  NULL;\nEND;\n$function$;\n"

    def outer_handler_fixtures(self) -> dict:
        found = {}
        for gname, value in globals().items():
            items = (
                value.items() if isinstance(value, dict)
                else enumerate(value) if isinstance(value, (tuple, list))
                else ()
            )
            for key, sql in items:
                if (
                    isinstance(sql, str)
                    and sql.endswith(self.OUTER_HANDLER_TAIL)
                    and f"  PERFORM {OUTER}(p_org);\n" in sql
                ):
                    found[f"{gname}[{key}]"] = sql
        return found

    def test_the_writing_body_is_refused_for_every_accepted_condition(self) -> None:
        fixtures = self.outer_handler_fixtures()
        accepted = 0
        for name, sql in fixtures.items():
            if not self.accepts(f"r26_inert_{accepted}", sql):
                continue  # a catching or unreadable condition: refused either way
            accepted += 1
            writing = sql[: -len(self.OUTER_HANDLER_TAIL)] + (
                "THEN\n" + WRITING_HANDLER_BODY + "END;\n$function$;\n")
            with self.subTest(fixture=name):
                self.assertFalse(
                    self.accepts(f"r26_writing_{accepted}", writing),
                    f"{name}: a writing handler on the guard's block was accepted",
                )
        self.assertGreaterEqual(accepted, 10, "the migrated fixture set shrank")


class Round26HandlerSectionModelTests(_Round26Base):
    """The rule at the function level, on the frames the scanner builds."""

    def frames_of(self, body: str):
        text = self.masked(self.routine(body))
        return text, guards.parse_blocks(text)

    def test_the_helper_names_the_owning_block(self) -> None:
        body, _close = self.unsafe()["runtime_error_before_guard"]
        text, frames = self.frames_of(body)
        pos = guards.GUARD_RE.search(text).start()
        self.assertTrue(guards.handler_can_run_unauthorized(text, frames, pos))
        text, frames = self.frames_of(self.safe()["inert_null_handler"])
        pos = guards.GUARD_RE.search(text).start()
        self.assertFalse(guards.handler_can_run_unauthorized(text, frames, pos))

    def test_a_later_block_does_not_count(self) -> None:
        text, frames = self.frames_of(self.safe()["authorization_before_later_risky_code"])
        pos = guards.GUARD_RE.search(text).start()
        self.assertFalse(guards.handler_can_run_unauthorized(text, frames, pos))

    def test_both_strict_consumers_ask_it(self) -> None:
        for fn in (guards.has_recognized_guard, guards.has_negated_raising_predicate):
            with self.subTest(fn=fn.__name__):
                self.assertIn("handler_can_run_unauthorized", inspect.getsource(fn))


# ---------------------------------------------------------------------------
# Round 27: a normally-completing handler and the routine's RESULT
# ---------------------------------------------------------------------------
# Round 26 credited a `NULL;` handler on a block that declares nothing, because
# the handler's subtransaction rollback undoes the block's writes. Result state
# is not rolled back: PL/pgSQL variables are not transactional, and rows
# already handed to RETURN NEXT / RETURN QUERY stay in the result set. So a
# routine that fills an OUT / INOUT parameter, a RETURNS TABLE column, or a
# SETOF result before an early failure returns that value to an unauthorized
# caller through the "inert" handler. Independent review found this live on
# 17.11 at 6e982e2f with check_file() returning [] - for the standalone guard
# and for the negated-predicate idiom whose own denial the handler catches.
#
# The rule (strict contract only, one shared helper for both consumers): a
# handler that can complete normally is harmless only when the block declares
# nothing AND the routine's CREATE header proves it has no result state - a
# FUNCTION returning `void`, or a PROCEDURE, with no OUT or INOUT parameter.
# Every other shape credits only handlers that all re-raise. A plain scalar
# return is refused too, although 17.11 raises 2F005 when its handler falls
# off the end: that is a deliberate fail-closed simplification, pinned below.


class _Round27Base(_Round26Base):
    """ORACLE, PostgreSQL 17.11 (x86_64-pc-linux-gnu, disposable local cluster).

        CREATE TABLE public.secrets (org_id uuid, secret text);   -- 'TOPSECRET'
        CREATE TABLE public.bins (actual_qty integer, org_id uuid);  -- 55
        wardah_assert_org_member(uuid) raises P0001; wardah_is_org_member(uuid)
        returns false.

    Every fixture from `matrix()` and `extras()` was COMPILED under its own
    name and RUN as a non-member role with no privilege on either table.
    "Leaks" means the call returned normally and its result carried TOPSECRET;
    "clean" means it returned normally with bins still 55 and no secret;
    "aborts" means the call failed. Results (788 fixtures, 0 accepted leaks):

        matrix, result shape x normally-completing handler   384 leak
        matrix, `scalar` x normally-completing handler        48 abort (2F005)
        matrix, result-less shape x normally-completing      144 clean
        matrix, any shape x only re-raising handlers         192 abort
        extras refused but not leaking, kept as conservative pins:
          `table_assignment_only` (no RETURN NEXT: 0 rows), clean
          `void/declarations/null` (the Round 26 rule), clean
          `*/write_then_reraise` (the handler writes), abort
    """

    POPULATE_OUT = (
        "  SELECT secret INTO leaked FROM public.secrets WHERE org_id = p_org::uuid;\n")
    POPULATE_NEXT = POPULATE_OUT + "  RETURN NEXT;\n"
    POPULATE_QUERY = (
        "  RETURN QUERY SELECT secret FROM public.secrets WHERE org_id = p_org::uuid;\n")
    POPULATE_SETOF_NEXT = (
        "  RETURN NEXT (SELECT secret FROM public.secrets WHERE org_id = p_org::uuid);\n")
    WRITE = "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org::uuid;\n"
    SCALAR_TAIL = (
        "  RETURN (SELECT secret FROM public.secrets WHERE org_id = p_org::uuid);\n")

    # shape -> (kind, extra parameters, RETURNS clause, pre-failure step, tail
    # after the guard). `tail` is only needed where the shape must RETURN.
    SHAPES = {
        "out": ("FUNCTION", ", OUT leaked text", "", POPULATE_OUT, ""),
        "out_two": ("FUNCTION", ", OUT leaked text, OUT other integer", "",
                    POPULATE_OUT, ""),
        "inout_function": ("FUNCTION", ", INOUT leaked text", "", POPULATE_OUT, ""),
        "inout_procedure": ("PROCEDURE", ", INOUT leaked text", "", POPULATE_OUT, ""),
        "out_procedure": ("PROCEDURE", ", OUT leaked text", "", POPULATE_OUT, ""),
        "table_return_next": ("FUNCTION", "", "RETURNS TABLE (leaked text)\n",
                              POPULATE_NEXT, ""),
        "setof_return_next": ("FUNCTION", "", "RETURNS SETOF text\n",
                              POPULATE_SETOF_NEXT, ""),
        "setof_return_query": ("FUNCTION", "", "RETURNS SETOF text\n",
                               POPULATE_QUERY, ""),
        "scalar": ("FUNCTION", "", "RETURNS text\n", "", SCALAR_TAIL),
        "void": ("FUNCTION", "", "RETURNS void\n", WRITE, ""),
        "void_qualified": ("FUNCTION", "", "RETURNS pg_catalog.void\n", WRITE, ""),
        "procedure": ("PROCEDURE", "", "", WRITE, ""),
    }
    RESULTLESS = frozenset({"void", "void_qualified", "procedure"})

    GUARD_ON = "  PERFORM public.wardah_assert_org_member({arg});\n"
    # entry -> (parameter type, statement(s) that fail before authorization -
    # the guard or the negated-predicate IF included - and the caught condition)
    ENTRIES = {
        "guard_argument_fails": (
            "uuid", GUARD_ON.format(arg="(p_org::text || 'z')::uuid"),
            "invalid_text_representation"),
        "guard_argument_fails_category": (
            "uuid", GUARD_ON.format(arg="(p_org::text || 'z')::uuid"),
            "data_exception"),
        "guard_argument_fails_sqlstate": (
            "uuid", GUARD_ON.format(arg="(p_org::text || 'z')::uuid"),
            "SQLSTATE '22P02'"),
        "runtime_error_before_guard": (
            "uuid", "  PERFORM 1 / 0;\n" + GUARD_ON.format(arg="p_org"),
            "division_by_zero"),
        "strict_lookup_before_guard": (
            "uuid",
            "  SELECT org_id INTO STRICT p_org FROM public.secrets WHERE false;\n"
            + GUARD_ON.format(arg="p_org"),
            "no_data_found"),
        "guard_resolution_fails": (
            "text", GUARD_ON.format(arg="p_org"), "undefined_function"),
        "negated_predicate_denial": (
            "uuid",
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    RAISE insufficient_privilege;\n  END IF;\n",
            "insufficient_privilege"),
        "negated_predicate_errcode_denial": (
            "uuid",
            "  IF NOT public.wardah_is_org_member(p_org) THEN\n"
            "    RAISE EXCEPTION 'DENIED' USING ERRCODE = '42501';\n  END IF;\n",
            "SQLSTATE '42501'"),
    }

    # handler form -> (EXCEPTION section text for condition {cond}, completes
    # normally on some path?)
    HANDLERS = {
        "null": ("EXCEPTION WHEN {cond} THEN\n  NULL;\n", True),
        "null_with_comments": (
            "EXCEPTION\n  -- swallow the early failure\n  WHEN {cond} THEN\n"
            "    /* nothing */\n    NULL /* still nothing */ ;\n\n", True),
        "null_twice": ("EXCEPTION WHEN {cond} THEN\n  NULL;\n  NULL;\n", True),
        "empty": ("EXCEPTION WHEN {cond} THEN\n", True),
        "one_arm_reraises_one_returns": (
            "EXCEPTION\n  WHEN unique_violation THEN\n    RAISE;\n"
            "  WHEN {cond} THEN\n    NULL;\n", True),
        "one_arm_returns_one_reraises": (
            "EXCEPTION\n  WHEN {cond} THEN\n    NULL;\n"
            "  WHEN unique_violation THEN\n    RAISE;\n", True),
        "reraise": ("EXCEPTION WHEN {cond} THEN\n  RAISE;\n", False),
        "every_arm_reraises": (
            "EXCEPTION\n  WHEN unique_violation THEN\n    RAISE;\n"
            "  WHEN {cond} THEN\n    RAISE;\n", False),
    }

    @staticmethod
    def header(kind: str, params: str, returns: str, name: str = "f_probe") -> str:
        return (
            f"CREATE OR REPLACE {kind} public.{name}({params})\n{returns}"
            "LANGUAGE plpgsql\nSECURITY DEFINER\n"
            "SET search_path TO 'public', 'pg_temp'\nAS $function$\n"
        )

    def build(self, shape: str, entry: str, handler: str, *, label: bool = False,
              declare: str = "") -> str:
        kind, extra, returns, populate, tail = self.SHAPES[shape]
        ptype, fails, cond = self.ENTRIES[entry]
        section, _normal = self.HANDLERS[handler]
        head = "<<blk>>\n" if label else ""
        decl = f"DECLARE\n{declare}" if declare else ""
        return (
            self.header(kind, f"p_org {ptype}{extra}", returns)
            + head + decl + "BEGIN\n" + populate + fails + tail
            + section.format(cond=cond)
            + ("END blk;\n" if label else "END;\n") + "$function$;\n"
        )

    def expected(self, shape: str, handler: str) -> bool:
        """True = ACCEPT. Only a handler that can complete normally on a shape
        that has result state is refused by the Round 27 rule."""
        return not (self.HANDLERS[handler][1] and shape not in self.RESULTLESS)

    def matrix(self) -> dict:
        return {
            f"{shape}/{entry}/{handler}": (
                self.build(shape, entry, handler), self.expected(shape, handler))
            for shape in self.SHAPES
            for entry in self.ENTRIES
            for handler in self.HANDLERS
        }

    def extras(self) -> dict:
        """Composed shapes outside the matrix: (sql, ACCEPT?)."""
        nested = (
            "  BEGIN\n    SELECT secret INTO leaked FROM public.secrets"
            " WHERE org_id = p_org;\n  EXCEPTION WHEN unique_violation THEN\n"
            "    NULL;\n  END;\n")
        return {
            "out/labelled_block/null": (
                self.build("out", "guard_argument_fails", "null", label=True), False),
            "inout_function/labelled_negated_predicate/null": (
                self.build("inout_function", "negated_predicate_denial", "null",
                           label=True), False),
            "void/labelled_block/null": (
                self.build("void", "guard_argument_fails", "null", label=True), True),
            "out/declarations/null": (
                self.build("out", "runtime_error_before_guard", "null",
                           declare="  v_x integer;\n"), False),
            "out/declarations/reraise": (
                self.build("out", "runtime_error_before_guard", "reraise",
                           declare="  v_x integer;\n"), True),
            "void/declarations/null": (
                self.build("void", "runtime_error_before_guard", "null",
                           declare="  v_x integer;\n"), False),
            "out/repeated_declare_chain/null": (
                self.build("out", "runtime_error_before_guard", "null",
                           declare="DECLARE\n"), False),
            "void/repeated_declare_chain/null": (
                self.build("void", "runtime_error_before_guard", "null",
                           declare="DECLARE\n"), True),
            "out/nested_exception_block_populates/null": (
                self.header("FUNCTION", "p_org uuid, OUT leaked text", "")
                + "BEGIN\n" + nested
                + self.GUARD_ON.format(arg="(p_org::text || 'z')::uuid")
                + "EXCEPTION WHEN invalid_text_representation THEN\n  NULL;\n"
                "END;\n$function$;\n", False),
            "out/write_then_reraise": (
                self.header("FUNCTION", "p_org uuid, OUT leaked text", "")
                + "BEGIN\n" + self.POPULATE_OUT
                + self.GUARD_ON.format(arg="(p_org::text || 'z')::uuid")
                + "EXCEPTION WHEN invalid_text_representation THEN\n"
                + self.WRITE + "  RAISE;\nEND;\n$function$;\n", False),
            "void/write_then_reraise": (
                self.header("FUNCTION", "p_org uuid", "RETURNS void\n")
                + "BEGIN\n" + self.WRITE
                + self.GUARD_ON.format(arg="(p_org::text || 'z')::uuid")
                + "EXCEPTION WHEN invalid_text_representation THEN\n"
                + self.WRITE + "  RAISE;\nEND;\n$function$;\n", False),
            "table_assignment_only/null": (
                self.header("FUNCTION", "p_org uuid", "RETURNS TABLE (leaked text)\n")
                + "BEGIN\n" + self.POPULATE_OUT
                + self.GUARD_ON.format(arg="(p_org::text || 'z')::uuid")
                + "EXCEPTION WHEN invalid_text_representation THEN\n  NULL;\n"
                "END;\n$function$;\n", False),
        }


class Round27ReviewerReproductionTests(_Round27Base):
    """RED at 6e982e2f: the reviewers' A-F shapes, each accepted there."""

    def cases(self) -> dict:
        return {
            "A_out_standalone_guard_argument_failure":
                self.build("out", "guard_argument_fails", "null"),
            "B_out_negated_predicate_denial":
                self.build("out", "negated_predicate_denial", "null"),
            "C_returns_table":
                self.build("table_return_next", "strict_lookup_before_guard", "null"),
            "D_setof_return_next":
                self.build("setof_return_next", "negated_predicate_errcode_denial", "null"),
            "D_setof_return_query":
                self.build("setof_return_query", "runtime_error_before_guard", "null"),
            "E_inout_function":
                self.build("inout_function", "negated_predicate_denial", "null"),
            "E_inout_procedure":
                self.build("inout_procedure", "guard_resolution_fails", "null"),
            "F_scalar_conservative":
                self.build("scalar", "guard_argument_fails", "null"),
        }

    def test_each_reproduction_is_refused(self) -> None:
        for name, sql in self.cases().items():
            with self.subTest(case=name):
                self.assertFalse(
                    self.accepts(f"r27_{name}", sql),
                    f"`{name}`: a normally-completing handler returns result "
                    "state set before authorization, and it was accepted",
                )

    def test_the_finding_names_the_routine(self) -> None:
        errors = self.verdict("r27_named", self.cases()["A_out_standalone_guard_argument_failure"])
        self.assertEqual(len(errors), 1)
        self.assertIn("public.f_probe", errors[0])
        self.assertIn("no recognized tenant/authorization assertion", errors[0])


class Round27MatrixTests(_Round27Base):
    """Every result shape x every early entry x every handler form.

    RED at 6e982e2f for every result-bearing shape with a normally-completing
    handler; every other cell was already this verdict and must stay it."""

    def test_the_matrix(self) -> None:
        cells = self.matrix()
        self.assertEqual(len(cells), len(self.SHAPES) * len(self.ENTRIES) * len(self.HANDLERS))
        for name, (sql, accept) in cells.items():
            with self.subTest(cell=name):
                self.assertEqual(self.accepts(f"r27_{name}", sql), accept)

    def test_the_matrix_is_not_one_sided(self) -> None:
        verdicts = {accept for _sql, accept in self.matrix().values()}
        self.assertEqual(verdicts, {True, False})

    def test_both_consumers_are_in_the_matrix(self) -> None:
        """The standalone guard and the negated-predicate idiom each reach the
        rule, so neither consumer can drift from the shared policy."""
        entries = set(self.ENTRIES)
        self.assertIn("guard_argument_fails", entries)
        self.assertIn("negated_predicate_denial", entries)
        for entry in ("guard_argument_fails", "negated_predicate_denial"):
            with self.subTest(entry=entry):
                self.assertFalse(self.accepts("r27_c", self.build("out", entry, "null")))
                self.assertTrue(self.accepts("r27_c", self.build("out", entry, "reraise")))
                self.assertTrue(self.accepts("r27_c", self.build("void", entry, "null")))


class Round27ComposedTests(_Round27Base):
    """Composed shapes outside the matrix."""

    def test_composed_shapes(self) -> None:
        for name, (sql, accept) in self.extras().items():
            with self.subTest(case=name):
                self.assertEqual(self.accepts(f"r27_{name}", sql), accept)


class Round27ControlTests(_Round27Base):
    """GREEN at 6e982e2f and after: what the rule must NOT refuse."""

    def test_resultless_null_handler_stays_accepted(self) -> None:
        for shape in sorted(self.RESULTLESS):
            for handler in ("null", "empty", "null_with_comments"):
                with self.subTest(shape=shape, handler=handler):
                    self.assertTrue(self.accepts(
                        "r27_ok", self.build(shape, "guard_argument_fails", handler)))

    def test_bare_reraise_is_safe_on_every_shape(self) -> None:
        for shape in self.SHAPES:
            for handler in ("reraise", "every_arm_reraises"):
                with self.subTest(shape=shape, handler=handler):
                    self.assertTrue(self.accepts(
                        "r27_raise", self.build(shape, "guard_argument_fails", handler)))

    def test_round26_safe_shapes_are_unchanged(self) -> None:
        for name, body in self.safe().items():
            with self.subTest(case=name):
                self.assertTrue(self.accepts(f"r27_r26_{name}", self.routine(body)))

    def test_no_handler_on_a_result_shape_stays_accepted(self) -> None:
        sql = (self.header("FUNCTION", "p_org uuid, OUT leaked text", "")
               + "BEGIN\n" + self.GUARD_ON.format(arg="p_org") + self.POPULATE_OUT
               + "END;\n$function$;\n")
        self.assertTrue(self.accepts("r27_no_handler", sql))


class Round27ResultShapeModelTests(_Round27Base):
    """`_routine_has_no_result_state()` answers from the CREATE header only,
    and anything it cannot read is False."""

    def probe(self, header: str) -> bool:
        masked = self.masked(header + "BEGIN\nEND;\n$function$;\n")
        return guards._routine_has_no_result_state(masked)

    def test_headers(self) -> None:
        cases = {
            ("FUNCTION", "p_org uuid", "RETURNS void\n"): True,
            ("FUNCTION", "IN p_org uuid", "RETURNS void\n"): True,
            ("FUNCTION", "p_org uuid", "RETURNS pg_catalog.void\n"): True,
            ("FUNCTION", "p_org uuid", "RETURNS /* nothing */ void\n"): True,
            ("FUNCTION", "p_org uuid, \"out\" text", "RETURNS void\n"): True,
            ("FUNCTION", "p_org uuid, p_n text DEFAULT 'out'", "RETURNS void\n"): True,
            ("PROCEDURE", "p_org uuid", ""): True,
            ("PROCEDURE", "", ""): True,
            # Intentional fail-closed simplifications, each a real PostgreSQL
            # spelling of a result-less routine or harmless in practice:
            ("FUNCTION", "p_org uuid", "RETURNS \"void\"\n"): False,
            ("FUNCTION", "p_org uuid", "RETURNS text\n"): False,
            # Result-bearing shapes:
            ("FUNCTION", "p_org uuid", "RETURNS SETOF void\n"): False,
            ("FUNCTION", "p_org uuid", "RETURNS SETOF text\n"): False,
            ("FUNCTION", "p_org uuid", "RETURNS TABLE (x text)\n"): False,
            ("FUNCTION", "p_org uuid, OUT x text", ""): False,
            ("FUNCTION", "p_org uuid, out x text", ""): False,
            ("FUNCTION", "p_org uuid, INOUT x text", ""): False,
            ("PROCEDURE", "p_org uuid, INOUT x text", ""): False,
            ("PROCEDURE", "p_org uuid, OUT x text", ""): False,
        }
        for (kind, params, returns), want in cases.items():
            with self.subTest(kind=kind, params=params, returns=returns):
                self.assertEqual(self.probe(self.header(kind, params, returns)), want)

    def test_a_fragment_without_a_header_proves_nothing(self) -> None:
        self.assertFalse(guards._routine_has_no_result_state("BEGIN\n  NULL;\nEND;\n"))

    def test_one_shared_policy(self) -> None:
        """The result-shape test lives in the shared handler model only; the two
        strict consumers reach it through handler_can_run_unauthorized()."""
        self.assertIn("_routine_has_no_result_state",
                      inspect.getsource(guards._handler_section_is_inert))
        for fn in (guards.has_recognized_guard, guards.has_negated_raising_predicate):
            with self.subTest(fn=fn.__name__):
                source = inspect.getsource(fn)
                self.assertNotIn("_routine_has_no_result_state", source)
                self.assertIn("handler_can_run_unauthorized", source)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
# This MUST stay the last statement in the file. It used to sit mid-file, just
# after the PR #241 classes, and `unittest.main()` exits the process - so
# `python3 scripts/ci/test_check_definer_guards.py`, which is exactly how the
# `DEFINER guard scanner selftest` step in ci-cd.yml invokes this suite, never
# reached the class definitions below it. Measured at the starting head
# ad2e748e: 267 of 301 tests ran under CI's own command, and every Round-21
# class was silently absent - defined never, let alone executed. Nothing was
# marked skipped, so the green tick said 301 tests' worth of nothing.
#
# `python3 -m unittest scripts.ci.test_check_definer_guards` imports the module
# instead of running it, which is why the full count was visible there and the
# gap went unnoticed. Keep new classes ABOVE this block.
if __name__ == "__main__":
    unittest.main(verbosity=2)
