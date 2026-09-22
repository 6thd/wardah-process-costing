#!/usr/bin/env python3
"""
CI guard: prevent new SECURITY DEFINER functions without a tenant/authorization guard.

Scans all migration files numbered > BASELINE_CUTOFF for new/replaced DEFINER
functions. Fails if any client-callable function lacks one of the reviewed
server-boundary guards.

A guard counts only when it appears as an executable function CALL
(`guard(...)` or `public.guard(...)`) with the helper's canonical arity, inside
the masked function body. A textual occurrence of the name — a dollar-quote tag,
a quoted identifier, a bare identifier, comment or literal text — never
satisfies the gate, and neither does a call to a different overload of the name.

It must also be able to RUN and to DENY: it cannot sit after a terminating
RETURN, an outer-level aborting RAISE, or a labelled EXIT that jumps out of the
block it sits in, and no enclosing EXCEPTION handler may be able to catch its
P0001 — including through that code's class, P0000, which `WHEN plpgsql_error`
and `WHEN SQLSTATE 'P0000'` both reach.

Recognized guards:
  - wardah_assert_org_member / wardah_assert_org_admin: raise on denial, so a
    call alone is an assertion.
  - wardah_is_org_member: returns BOOLEAN and does NOT raise, so a call whose
    result is discarded authorizes nothing. It counts only in the negated
    raising idiom, verified structurally: `IF ... NOT wardah_is_org_member(...)
    THEN RAISE ... END IF`.
  - wardah_178_assert_permission: Migration 178's assertion wrapper around
    wardah_has_exact_permission. Unlike matching a bare boolean permission
    helper, this wrapper raises on denial and preserves the central Super Admin,
    active-membership, role-org, role-active and expiry semantics.

Exemptions:
  - Functions this migration itself closes to every client role. The REVOKE must
    NAME the function - same schema, name and argument types - it must revoke
    the privilege itself rather than only `GRANT OPTION FOR` it, and no later
    GRANT in the file may put the privilege back. Below the strict cutoff this
    keeps its historical meaning (close PUBLIC); from the cutoff on, closing
    PUBLIC while granting `authenticated` is not a closure.
  - Functions listed in KNOWN_EXEMPT (intentionally open/delegating/superseded,
    with a documented reason). That ledger is HISTORICAL: it is keyed by bare
    name, so it stops applying at MIGRATION_STRICT_CUTOFF, where a new overload
    of an exempt name would otherwise inherit an exemption written for a
    different function.

Statement model (what a rule is allowed to assume):
  Attribution is by IDENTITY, not by position. Every CREATE/ALTER FUNCTION and
  every GRANT/REVOKE is parsed once into a schema-qualified identity with its
  argument type list, read from the UNMASKED source so that quoted identifiers
  are visible and case-sensitive. A definition owns only its own statement, so
  a routine with no dollar-quoted body cannot borrow the next one's guard, and
  `ALTER FUNCTION ... SECURITY DEFINER` is a finding in its own right rather
  than something blamed on the CREATE before it.

Division of labour with the acceptance database:
  This scanner proves STRUCTURE in one migration's bytes. It cannot see what the
  whole chain finally produced, so the catalog-side facts - which functions are
  really SECURITY DEFINER, who can really execute them, and whether a recognized
  guard name still resolves to the reviewed single-signature helper - are
  asserted by scripts/ci/fresh-db/acceptance_definer_guard_contract.sql, whose
  own selftest drives four deliberately broken catalogs through it.
"""

import functools
import pathlib
import re
import sys

MIGRATIONS_DIR = pathlib.Path("sql/migrations")
BASELINE_FILE = next(pathlib.Path("sql/baseline").glob("000_schema_baseline_*.sql"), None)

KNOWN_EXEMPT = {
    # Documented in SECURITY_DEFINER_AUDIT.md — open to anon deliberately
    "rpc_get_invitation_preview",
    # Migration 149 definitions are superseded in 151 before the chain is usable:
    # the trigger becomes SECURITY INVOKER, and the balance helper gains an
    # explicit org lookup + wardah_assert_org_member guard. Keeping these names
    # here lets the per-file scanner acknowledge migration ordering without
    # weakening the final-state acceptance gate, which verifies the 151 bodies.
    "wardah_guard_allocation_immutability",
    "wardah_receipt_line_uninvoiced_base",
    # has_permission (migration 170): guarded by a direct
    # `p_user_id IS DISTINCT FROM auth.uid()` self-check, not an
    # org-membership helper — the generic guard patterns don't apply here
    # because this function's whole purpose is validating identity, not org
    # membership, for a caller checking their own permissions.
    "has_permission",
    # Migration 178 assertion helper. It is an internal, non-client-callable
    # wrapper around wardah_has_exact_permission and is itself the recognized
    # authorization assertion used by the public manual-journal RPCs.
    "wardah_178_assert_permission",
    # Migration 178 batch wrapper performs no table mutation or privileged read;
    # every entry is delegated to rpc_post_manual_journal_entry, which performs
    # the exact-permission assertion against that entry's own organization.
    "rpc_batch_post_manual_journal_entries",
}

# ---------------------------------------------------------------------------
# PostgreSQL lexical primitives
# ---------------------------------------------------------------------------
# Every security-bearing pattern in this file is built from the three
# definitions below - the identifier alphabet, the whitespace set and the
# keyword boundary derived from the first. They lead the file because the very
# first pattern after them, the guard CALL shape, already needs all three.

# ONE unquoted-identifier alphabet, matching PostgreSQL's ident_start /
# ident_cont: an ASCII letter or underscore, or ANY non-ASCII character, then
# the same plus digits and `$`. PostgreSQL's scanner accepts every high-bit
# byte, so the range runs to U+10FFFF - it previously stopped at U+FFFF, which
# made an identifier containing a 4-byte UTF-8 character unparseable and, for a
# block label, invisible: no label was recorded and the labelled-EXIT bypass
# reopened.
#
# Round 19: these two strings are the file's ONLY spelling of that alphabet.
# `_IDENT_CONT_RE` - one character of the continuation class, used by
# _dollar_tag_at() to refuse a tag that would start inside an identifier, and
# by the statement model to walk an identifier - is now DERIVED from
# `_IDENT_CONT` rather than transcribed beside it, so the tag reader and the
# statement model cannot drift the way `str.isalnum() + "_"` had drifted from
# both. `$` is deliberately in the continuation class: it continues an
# identifier (`a$$$` is identifier `a$$` plus a stray `$`), which is exactly
# why a dollar tag may not begin there.
_IDENT_START = "A-Za-z_\x80-\U0010FFFF"
_IDENT_CONT = "A-Za-z0-9_$\x80-\U0010FFFF"
_IDENT_CONT_RE = re.compile(f"[{_IDENT_CONT}]")


def _continues_identifier(text: str, i: int) -> bool:
    """True when `text[i]` continues a PostgreSQL identifier (scan.l ident_cont).

    The ONE membership twin of `_IDENT_CONT`, for the raw-character checks that
    cannot phrase themselves as a regex class. Round 21 (Grok, B2): the
    E-string prefix test asked `str.isalnum() or "_"` instead, and that is a
    Unicode CATEGORY test - it excludes `$` and every non-ASCII code point
    outside L*/N*, all of which PostgreSQL's ident_cont accepts. Every such
    disagreement let an identifier ENDING IN `E` masquerade as an escape-string
    prefix, so an ordinary quoted literal was masked under backslash-escape
    rules and swallowed the executable text after it.
    """
    if not 0 <= i < len(text):
        return False
    # Indexed one character at a time so the masker's mutable `out` list of
    # characters and an ordinary string answer through the same rule.
    return _IDENT_CONT_RE.match(text[i]) is not None


# ---------------------------------------------------------------------------
# Round 21: ONE PostgreSQL whitespace definition
# ---------------------------------------------------------------------------
# PostgreSQL's scan.l spells its whitespace class `space [ \t\n\r\f\v]`, and
# that is the WHOLE of it. Python's `\s` is a strictly larger, Unicode-aware
# set, and the difference is not cosmetic: measured against PostgreSQL 17.11,
# 23 of the 29 code points `\s` matches are NOT PostgreSQL whitespace, and 19
# of those 23 are PostgreSQL identifier CONTINUATION characters - U+0085,
# U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F and U+3000,
# every one of which encodes to UTF-8 bytes >= 0x80 and so lands inside
# ident_cont's `\200-\377` byte range. (The remaining four, U+001C-U+001F, are
# neither: PostgreSQL rejects them outright.)
#
# So a multi-word keyword written `END\s+IF` does not mean "END, whitespace,
# IF". It also matches `END\u00a0IF`, which PostgreSQL reads as ONE ordinary
# identifier - `_control_frames()` popped an IF frame that PostgreSQL never
# opened, and the guard left inside that still-open IF was credited as if it
# stood at the routine's outer statement level. Proven live on 17.11: the
# column `end\u00a0if` came back from `pg_attribute` as a single identifier and
# the privileged UPDATE ran for a non-member with the guard never executed.
#
# These are the file's ONLY spelling of that set. `_PG_WS_CHARS` is the
# definition; `_PG_WS` is the same characters escaped for use inside a regex
# `[]` class, and `_PLPGSQL_WS` is the membership twin kept under its historical
# name. A grammar cannot drift from the membership test, or either from the
# other, because there is only one source.
_PG_WS_CHARS = " \t\n\r\f\v"
_PG_WS = re.escape(_PG_WS_CHARS)
_PLPGSQL_WS = _PG_WS_CHARS
# The two separator spellings every security-bearing pattern below uses in
# place of `\s+` and `\s*`.
_WS1 = f"[{_PG_WS}]+"
_WS0 = f"[{_PG_WS}]*"

# ---------------------------------------------------------------------------
# Round 20: ONE PostgreSQL keyword boundary, derived from that alphabet
# ---------------------------------------------------------------------------
# Python's `\b` is NOT a PostgreSQL token boundary. It is defined against
# `\w`, and `\w` is a Unicode CATEGORY test: it excludes `$` and every
# non-ASCII code point outside the letter/digit categories. PostgreSQL's
# ident_cont - the alphabet immediately above, and the one `_previous_word()`
# and `_is_assignment_target()` were already corrected to walk in Round 19 -
# accepts `$` and EVERY non-ASCII code point. So Python sees a word boundary in
# the MIDDLE of a single PostgreSQL identifier, and every keyword matcher
# written with `\b` read the identifier's keyword-shaped SUFFIX as the keyword.
#
# Verified on PostgreSQL 17.11: `col$end`, `end$x`, `x$end$y`, `coĺend`,
# `col·end`, `col​end` and `col😀end` are each ONE unquoted
# identifier - all 98 forms of this shape used by the Round 20 tests were
# created as columns and read back from `pg_attribute` unchanged. Python's
# `\bEND\b` matches inside every one of them.
#
# Round 19 fixed the two hand-written identifier WALKS. It did not fix the
# forward keyword RECOGNIZERS, and `_BLOCK_TOKEN_RE` never consults a walk at
# all: it builds the control-frame stack straight from its own matches. A fake
# END from `col$end` therefore popped a live frame, which re-owned a later SQL
# `ELSE`, which manufactured a DECLARE section, which swallowed a real outer
# `RAISE EXCEPTION` - and the dead guard after that abort was credited as the
# routine's authorization boundary. Proven live on 17.11 against
# `prosecdef = true`, client-executable routines.
#
# These two constants are the file's ONLY spelling of that boundary. Both are
# DERIVED from `_IDENT_CONT`, so a keyword lexer cannot drift from the
# identifier alphabet the way `\b` had drifted from it. `\w` is a SUBSET of
# ident_cont, so this rule is strictly narrower than `\b`: it can only REFUSE
# a match `\b` accepted, never add one, and the matches it refuses are exactly
# those where PostgreSQL reads one identifier rather than a keyword.
_KW_LEFT = f"(?<![{_IDENT_CONT}])"
_KW_RIGHT = f"(?![{_IDENT_CONT}])"


def _pg_kw(pattern: str) -> str:
    """`pattern` fenced by PostgreSQL token boundaries on both sides."""
    return f"{_KW_LEFT}(?:{pattern}){_KW_RIGHT}"


GUARD_NAMES = [
    "wardah_assert_org_member",
    "wardah_assert_org_admin",
    # Match only the assertion wrapper, never a bare boolean permission lookup.
    "wardah_178_assert_permission",
]

# A recognized guard is an EXECUTABLE CALL, never a textual occurrence of the
# name. Masking alone cannot close this class: masking keeps delimiters and
# identifiers, so a bare-name matcher still accepted a guard named as an outer
# dollar-quote tag ($wardah_assert_org_member$), as a nested dollar tag, as a
# quoted alias ("wardah_assert_org_member") or as a bare non-call identifier
# (PERFORM wardah_assert_org_member;). All of those are non-executable, so the
# name must be followed by optional whitespace and an opening parenthesis.
#
#   left boundary: not preceded by an identifier character, a dollar sign (a
#                  dollar-quote tag) or a double quote (a quoted identifier),
#                  and not preceded by a `.` unless that qualifier is `public`,
#                  so another schema's same-named function cannot stand in.
#   qualification: the existing optional `public.` prefix.
#   call shape:    name, optional whitespace, `(`.
GUARD_CALL_PATTERN = (
    f"(?<![{_IDENT_CONT}\".])(?:public{_WS0}[.]{_WS0})?(?:"
    + "|".join(GUARD_NAMES)
    + f"){_WS0}[(]"
)
GUARD_RE = re.compile(GUARD_CALL_PATTERN, re.IGNORECASE)

# ---------------------------------------------------------------------------
# Boolean membership predicates
# ---------------------------------------------------------------------------
# wardah_is_org_member(uuid) returns BOOLEAN. It does NOT raise on denial, so
# calling it and discarding the result authorizes nothing:
#
#     PERFORM public.wardah_is_org_member(p_org);   -- result thrown away
#     UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;
#
# It is a real guard only when its FALSE result actually denies, which in every
# historical use means the negated form inside an IF whose branch raises:
#
#     IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
#       RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
#     END IF;
#
# That is checked structurally below, never by a flat regex: the call must sit
# in the CONDITION of an IF, and that IF's own deny branch must raise at its own
# nesting level. A raise inside a nested IF does not count, an ELSE/ELSIF branch
# does not count, and an unbalanced block is simply not recognized (fail closed).

BOOLEAN_PREDICATES = [
    "wardah_is_org_member",
]

NEGATED_PREDICATE_RE = re.compile(
    _KW_LEFT + f"NOT{_WS1}(?:public{_WS0}[.]{_WS0})?(?:"
    + "|".join(BOOLEAN_PREDICATES) + f"){_WS0}[(]",
    re.IGNORECASE,
)

# The negated predicate must be an ENTIRE top-level condition term: the whole
# condition, or one complete top-level OR disjunct. Merely occurring somewhere in
# the condition is not enough, because a conjunction can make the deny branch
# unreachable while the text still reads as a guard:
#
#     IF NOT public.wardah_is_org_member(p_org) AND false THEN
#       RAISE EXCEPTION 'DENIED';        -- never runs; non-members proceed
#     END IF;
#
# Non-membership must by itself guarantee entry into the raising branch. In a
# disjunction each disjunct alone suffices, so an OR term is safe; under AND it
# is not, so anything else in the term disqualifies it.
_TOP_LEVEL_OR_RE = re.compile(_pg_kw("OR"), re.IGNORECASE)


def _split_top_level_or(condition: str) -> list[str]:
    """Split on OR at parenthesis depth 0."""
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(condition):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif depth == 0:
            m = _TOP_LEVEL_OR_RE.match(condition, i)
            if m and not _continues_identifier(condition, i - 1):
                parts.append(condition[start:i])
                start = m.end()
    parts.append(condition[start:])
    return parts


def _strip_outer_parens(text: str) -> str:
    text = text.strip()
    while text.startswith("(") and text.endswith(")"):
        depth = 0
        for i, ch in enumerate(text):
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    if i != len(text) - 1:
                        return text
                    break
        text = text[1:-1].strip()
    return text


def _is_sole_negated_predicate(term: str) -> bool:
    """True when `term` is exactly `NOT [public.]predicate(args)` and nothing
    else — no trailing conjunct, no surrounding expression."""
    term = _strip_outer_parens(term)
    m = NEGATED_PREDICATE_RE.match(term)
    if m is None:
        return False
    # The predicate's own arity must match the reviewed helper's, for the same
    # reason a raising guard's must: an overload is a different function.
    if _call_arity(term, m.end() - 1) != GUARD_ARITY.get(
        _predicate_name(term, m), object()
    ):
        return False
    # Consume the call's balanced argument list; anything after it disqualifies.
    depth = 0
    for i in range(m.end() - 1, len(term)):
        if term[i] == "(":
            depth += 1
        elif term[i] == ")":
            depth -= 1
            if depth == 0:
                return not term[i + 1:].strip()
    return False


_TRAILING_IDENT_RE = re.compile(f"([{_IDENT_START}][{_IDENT_CONT}]*){_WS0}$")


def _predicate_name(term: str, match) -> str:
    """The bare predicate name inside a matched `NOT [public.]pred(` prefix."""
    head = term[match.start(): match.end() - 1]
    m = _TRAILING_IDENT_RE.search(head)
    return m.group(1).lower() if m else ""


# ---------------------------------------------------------------------------
# Structural PL/pgSQL block model
# ---------------------------------------------------------------------------
# From this migration on, a raising assertion counts only at the function's
# outer statement level. Older migrations are immutable historical inputs and
# keep their previously validated compatibility; the cutoff is a migration
# NUMBER, never a function-name exemption.
MIGRATION_STRICT_CUTOFF = 191

_BLOCK_TOKEN_RE = re.compile(
    _KW_LEFT
    + f"(END{_WS1}IF|END{_WS1}LOOP|END{_WS1}CASE|ELSIF|ELSE|EXCEPTION|BEGIN|IF"
      f"|THEN|LOOP|CASE|END|RAISE)"
    + _KW_RIGHT,
    re.IGNORECASE,
)
_NON_ABORTING_RAISE_RE = re.compile(
    _KW_LEFT + f"RAISE{_WS1}(NOTICE|WARNING|INFO|LOG|DEBUG)" + _KW_RIGHT,
    re.IGNORECASE,
)
_RAISE_BEFORE_RE = re.compile(_KW_LEFT + f"RAISE{_WS0}$", re.IGNORECASE)

# Round 13 (Fable, F8): the block parser treated the TOKEN `RAISE` anywhere in
# an IF's deny branch as a denying statement. `raise` is not reserved in
# PostgreSQL, so it is a perfectly ordinary identifier, and
#
#   IF NOT public.wardah_is_org_member(p_org) THEN
#     v_flag := (SELECT 1 AS raise);
#   END IF;
#   UPDATE ...;
#
# compiles, denies nothing, and on PostgreSQL 17.11 let a non-member reach the
# privileged UPDATE with no exception raised - while the scanner read the
# branch as a real authorization boundary.
#
# A RAISE counts only where a PL/pgSQL statement can BEGIN. The test is the
# smallest one that is robust: the previous token must open a statement -
# nothing at all, a `;`, or one of the keywords that introduces a statement
# list. `AS raise`, `SELECT raise` and `v := raise` all fail it, and every
# real spelling (`THEN RAISE`, `; RAISE`, `BEGIN RAISE`, `LOOP RAISE`) passes.
#
# Round 14 (Codex): this ALSO accepted `>>`, on the reasoning that `>>` closes
# a `<<label>>`. PostgreSQL spells integer right shift `>>` too, so an
# ordinary expression whose right operand is an identifier named `raise` -
# `8 >> raise` over a column, or over a function parameter of that name -
# placed a bare `raise` directly after `>>` and it counted as a denying
# statement again. That reopened the very false green this helper closed: the
# oracle shows such a routine stays SECURITY DEFINER and client-callable, and
# a non-member call raises nothing and reaches the privileged write.
#
# The exception was never needed. PostgreSQL 17.11 rejects
# `<<lbl>> RAISE EXCEPTION 'x';` with `syntax error at or near "RAISE"`: a
# label owns a BLOCK or a LOOP, never a bare statement, so a real RAISE after
# a labelled construct is always reached through `BEGIN` (`<<lbl>> BEGIN RAISE
# ...; END lbl;`) or `LOOP` (`<<lp>> LOOP RAISE ...; END LOOP lp;`) - both
# already in the keyword set below. A `>>` can therefore NEVER legitimately
# precede a RAISE statement, which makes deleting the branch the whole
# correction: it removes false-green surface and defends no real case.
#
# Labels themselves are untouched. _block_labels() and _labelled_opener()
# remain the only label parser, they attribute a label FORWARD to the BEGIN or
# LOOP it owns, and nothing here duplicates that knowledge.
# The keywords after which a PL/pgSQL STATEMENT may begin.
#
# Round 16: `declare` was in this set and does not belong. DECLARE opens a
# DECLARATION section, and PostgreSQL reads the token after it as a variable
# NAME - `DECLARE RAISE integer := 7;` declares a variable literally called
# RAISE and returns 7. All three spellings of a RAISE statement placed
# directly after DECLARE are syntax errors on PostgreSQL 17.11 (the parser
# takes `RAISE EXCEPTION` as name + type and then chokes on the message
# literal), while `DECLARE x integer; BEGIN RAISE EXCEPTION 'x'; END` is
# valid: the real RAISE is reached through BEGIN, which is in this set.
#
# So `declare` defended no real case and cost two live misclassifications of
# `DECLARE raise integer := 1;` - a declaration PostgreSQL accepts in all of
# its forms (bare, initialised, custom-typed, ALIAS FOR $1, CONSTANT):
#
#   * parse_blocks() recorded the declared identifier as the IF frame's
#     raise_pos, so a deny branch that denies nothing read as an
#     authorization boundary. Proven unsafe on the oracle: prosecdef = true,
#     PUBLIC and authenticated both executable, and a non-member call raised
#     nothing and drove the privileged UPDATE (bins.actual_qty 55 -> 0).
#   * unconditional_abort_before() counted it as an earlier outer-level
#     abort, so a real `PERFORM public.wardah_assert_org_member(...)` after
#     an outer `DECLARE raise integer := 1;` was written off as unreachable -
#     a false RED on a routine the oracle shows really does deny (the guard
#     raised TENANT_MEMBERSHIP_REQUIRED and the UPDATE did not run).
#
# Removing the keyword fixes both at once, in the one shared definition.
_STATEMENT_OPENER_KEYWORDS = frozenset(
    {"then", "else", "begin", "loop"}
)

# `_PLPGSQL_WS` - the same set as the characters THEMSELVES, for membership
# tests - is derived from `_PG_WS_CHARS` beside the identifier alphabet, so it
# can no longer be transcribed out of step with the regex class.

# ---------------------------------------------------------------------------
# Round 17: the DECLARE region, and assignment targets
# ---------------------------------------------------------------------------
# Round 16 removed `declare` from the opener set above, which made the FIRST
# declaration of a variable named `raise` inert. Two sibling spellings of the
# same family survived it, because neither is reached through the DECLARE
# keyword, and they fail in OPPOSITE directions:
#
#   A. A second (or third) declaration is reached through the `;` that
#      terminates the previous one, and `;` is a universal opener above:
#
#        DECLARE
#          x integer := 1;
#          raise integer := 2;     <- `;` before it, so it read as a statement
#        BEGIN ...
#
#      Proven on PostgreSQL 17.11: the routine compiles, `raise` is an ordinary
#      declaration identifier, nothing is raised, and an unguarded SECURITY
#      DEFINER routine built around it (prosecdef = true) drove its privileged
#      UPDATE for a NON-member - bins.actual_qty 55 -> 0 - while the scanner
#      recorded the declared identifier as the IF frame's raise_pos and
#      check_file() returned []. A false GREEN.
#
#   B. An assignment to such a variable sits directly after the BEGIN that ends
#      the declaration section, and `begin` is an opener - correctly, since
#      `BEGIN RAISE EXCEPTION ...` is the real thing:
#
#        DECLARE
#          raise integer := 1;
#        BEGIN
#          raise := 2;             <- `BEGIN` before it, so it read as a RAISE
#          PERFORM public.wardah_assert_org_member(p_org);
#
#      The oracle shows `raise := 2` is an ordinary assignment that executes and
#      aborts nothing (the authorized path writes the assigned value 2), and the
#      real guard genuinely denies a non-member with TENANT_MEMBERSHIP_REQUIRED
#      while the UPDATE does not run. The scanner counted the assignment as an
#      earlier outer-level abort, called the real guard unreachable, and
#      REJECTED a correctly guarded routine. A false RED.
#
# The distinction PostgreSQL draws is structural, and these two helpers are the
# smallest model of it that answers the only question this parser asks - "can a
# RAISE statement begin at this offset?". They add no expression, declaration
# or assignment grammar, and nothing else in the file changes, so parse_blocks()
# and unconditional_abort_before() keep sharing one classification and cannot
# drift apart.
#
# The region model rests on PL/pgSQL's block shape, confirmed on 17.11:
#
#     [ <<label>> ] [ DECLARE declarations ] BEGIN statements END
#
# A declaration is `name [CONSTANT] type [:= expr];` and cannot contain a nested
# block, so the BEGIN that ends a declaration section is always one the section
# itself reaches - including for a DECLARE nested inside an enclosing block or
# an IF branch, where the enclosing BEGIN lies BEFORE the DECLARE and is never a
# candidate.
#
# Round 22: that is NOT the same as the FIRST `BEGIN` after the DECLARE, which
# is what this file used to take. A declaration's initializer is an ordinary SQL
# expression and `begin` is UNRESERVED, so an initializer may legally SPELL the
# keyword - and masking does not remove it, because the masker blanks comments
# and literal CONTENT while deliberately keeping executable identifiers. The
# offset that ends the section is resolved by `_owned_section_begin()`, the one
# helper both declaration consumers ask, and its note carries the 17.11 grammar
# evidence and the boundary rule that separates the two readings.
#
# Suppression therefore ends at exactly the right BEGIN, and the control that
# matters most stays recognized: in
#
#     DECLARE x integer; BEGIN RAISE EXCEPTION 'x'; END
#
# the RAISE lies after the BEGIN, outside the span, and still counts.
_DECLARE_TOKEN_RE = re.compile(_pg_kw("DECLARE"), re.IGNORECASE)
_SECTION_BEGIN_RE = re.compile(_pg_kw("BEGIN"), re.IGNORECASE)

# `:=` is PL/pgSQL's assignment operator and 17.11 accepts a bare `=` for it too
# (`DO $$ DECLARE raise integer := 1; BEGIN raise = 2; END $$` runs and leaves
# raise = 2). No spelling of a RAISE statement can be followed by either: the
# grammar continues with a level, a format literal, a condition name, SQLSTATE,
# USING, or the `;` of a bare re-raise. So a word that an assignment operator
# follows is an assignment TARGET, never the RAISE keyword. `=>` named-argument
# notation lands here too and is equally not a RAISE statement.
_ASSIGNMENT_OPERATOR_RE = re.compile(r"[ \t\n\r\f\v]*(?::=|=)")

# ---------------------------------------------------------------------------
# Round 18: the two pieces of evidence the DECLARE region accepted on faith
# ---------------------------------------------------------------------------
# Round 17 proved the POSITION of a DECLARE token, not just the word, and got
# the statement-position half right. The other two branches asked only what the
# single character before the word was, and both characters occur in ordinary
# executable text that PostgreSQL 17.11 accepts:
#
#   * a raw `>>` was taken as a labelled block opener. `>>` is also the integer
#     right-shift operator, so `SELECT 8 >> declare INTO v FROM t` - `declare`
#     as an ordinary column - manufactured a section. So did `8>>declare`,
#     `8 >> /* c */ declare`, a newline or tab in between, and the composed
#     `SELECT a << b >> declare INTO v FROM t`, all of which run on 17.11.
#   * a raw `$` was taken as the dollar-quote that opens the routine body. `$`
#     also CONTINUES an unquoted identifier (scan.l ident_cont), so
#     `col$declare` - one identifier, `v := col$declare` runs on 17.11 - opened
#     a section too.
#
# A manufactured span runs from the fake DECLARE to the next BEGIN, or to the
# end of the body when there is none, and _is_statement_start() suppresses every
# RAISE inside it. Both shared consumers were hit, in opposite directions, and
# both were proven on 17.11 against `prosecdef = true`, client-executable
# routines:
#
#   FALSE GREEN - `SELECT 8 >> declare INTO v FROM t; RAISE EXCEPTION
#     'NOT_IMPLEMENTED'; PERFORM public.wardah_assert_org_member(p_org);` aborts
#     at NOT_IMPLEMENTED for member and non-member alike, so the PERFORM is dead
#     code that can never authorize anything. With the real abort hidden,
#     unconditional_abort_before() found no earlier abort and the dead guard was
#     credited; check_file() returned []. `col$declare` and `a << b >> declare`
#     do the same.
#
#   FALSE RED - the same shift inside a real deny branch
#     (`IF NOT public.wardah_is_org_member(p_org) THEN SELECT 8 >> declare ...;
#     RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED'; END IF;`) denies a
#     non-member live, yet the swallowed RAISE left the IF frame with no
#     raise_pos and parse_blocks() saw no boundary at all.
#
# The correction proves the STRUCTURE both branches were standing in for, and
# takes both proofs from machinery that already exists rather than adding a
# second reader:
#
#   * a labelled DECLARE is recognized FORWARD, `<<` first, through the same
#     `_LABEL_OPEN_RE` + `_parse_identity()` + `>>` sequence _block_labels()
#     uses. A complete label is required, and the `<<` must itself sit where a
#     block may begin - which is what separates `<<blk>> DECLARE` from
#     `a << b >> declare`, where the `<<` follows an operand. No generic `>>`
#     boundary rule comes back, and this adds no third label parser.
#   * a body-opening dollar quote is proved by `_dollar_tag_at()`, the one
#     shared reader that already refuses a tag beginning inside an identifier.
#     `col$declare` has no closing `$` and matches no tag at all; `col$$declare`
#     and `x$abc$declare` are refused on exactly the identifier boundary that
#     closed Round 13's masker bypass, so the two cannot disagree about where a
#     body starts.
#
# A `$` that ends a valid tag somewhere OTHER than the body opener - the closing
# delimiter of a nested literal, immediately followed by DECLARE - would still
# be accepted. That text does not compile on 17.11 (an expression cannot be
# followed by a bare DECLARE), so it can only appear in SQL PostgreSQL rejects,
# and it is a bounded residue of a branch that previously accepted every `$` in
# the body.


def _prev_nonspace(body: str, pos: int) -> int:
    """Index of the last non-whitespace character before `pos`, or -1.

    PostgreSQL's whitespace set, not Python's. Round 21 brought the file's last
    `str.isspace()` walks onto this same set, so `_skip_ws()` and this reader no
    longer disagree about the 19 Unicode spaces PostgreSQL reads as identifier
    characters.
    """
    j = pos - 1
    while j >= 0 and body[j] in _PLPGSQL_WS:
        j -= 1
    return j


def _ends_dollar_body_opener(body: str, j: int) -> bool:
    """True when the `$` at `j` is the closing character of a dollar-quote tag.

    The tag's own name is spelled from dolq_cont, which excludes `$`, so the
    nearest preceding `$` is the only candidate for the tag's opening character:
    if a valid tag ends at `j`, that `$` begins it. `_dollar_tag_at()` then
    decides, and it is the same reader the masker uses - including its refusal
    of a tag that would begin inside an identifier, which is what makes
    `col$declare`, `col$$declare` and `x$abc$declare` prove nothing.
    """
    k = body.rfind("$", 0, j)
    return k >= 0 and _dollar_tag_at(body, k) == body[k:j + 1]


def _label_opener_before(body: str, pos: int) -> int | None:
    """Offset of the `<<` of a complete `<<label>>` ending just before `pos`.

    Round 20. A label is the one PL/pgSQL construct that can stand between a
    statement position and the BLOCK or LOOP it owns, so `_opens_block_position()`
    has to see through it - and `>>` alone is not it. PostgreSQL spells integer
    and inet/box right shift `>>` as well, and `a << b >> c` is an ordinary
    expression on 17.11.

    The `>>` is located backward, but the LABEL is then proved FORWARD through
    exactly the `_LABEL_OPEN_RE` + `_parse_identity()` + `>>` sequence
    `_block_labels()` uses, and the parsed identity must be ONE part that ends
    at the very `>>` that was found. So this reads the same label grammar from
    the other side rather than inventing a second one, and an operator pair that
    no complete label reaches proves nothing.

    Whether the label itself stands anywhere legal is NOT decided here: the
    caller keeps walking left from the returned `<<`, which is what separates
    `; <<blk>> DECLARE` from `SELECT a << b >> declare`.
    """
    j = _prev_nonspace(body, pos)
    if j < 1 or body[j] != ">" or body[j - 1] != ">":
        return None
    start = body.rfind("<<", 0, j - 1)
    if start < 0:
        return None
    parsed, after = _parse_identity(body, body, start + 2)
    if parsed is None or len(parsed[0]) != 1:
        return None
    return start if _skip_ws(body, after) == j - 1 else None


def _owns_statement_list(body: str, word: str, word_start: int) -> bool:
    """True when the keyword at `word_start` opens a PL/pgSQL STATEMENT LIST.

    `_opens_statement_position()` asks only WHICH WORD precedes, and three of
    the four words in its opener set also occur inside ordinary SQL, where they
    open an expression arm rather than a statement list. PostgreSQL 17.11
    accepts all three, and each one manufactured a declaration section:

        SELECT CASE WHEN true  THEN declare ELSE 0       END INTO v FROM t
        SELECT CASE WHEN false THEN 0       ELSE declare END INTO v FROM t
        SELECT loop declare INTO v FROM t
        SELECT loop << b >> declare INTO v FROM t
        SELECT begin declare INTO v FROM t

    `THEN` and `ELSE` are SQL CASE keywords there; `loop` and `begin` are
    unreserved, so they are ordinary column names with `declare` as the alias.
    The span a fake DECLARE opens runs to the next BEGIN, and every RAISE inside
    it stops counting - so a routine that really aborts at
    `RAISE EXCEPTION 'NOT_IMPLEMENTED'` had that abort hidden and the DEAD
    `PERFORM public.wardah_assert_org_member(...)` after it credited as its
    authorization boundary. Proven live on all five: prosecdef = true,
    client-executable, the call aborted for member and non-member alike, and
    check_file() still returned [].

    The question the WORD cannot answer - which construct OWNS this keyword - is
    one `_control_frames()` already answers, so it is asked there rather than in
    a second parser:

      * a THEN or an ELSE belongs to a statement list exactly when the
        innermost construct enclosing it is an IF. A SQL CASE arm is enclosed by
        the CASE frame instead, which a bare END closes.
      * a LOOP opens one exactly when `_opens_loop_statement()` proves the
        keyword is a real loop. Frame closure ALONE is not that proof: in
        `LOOP SELECT loop declare INTO v FROM t; EXIT; END LOOP;` the identifier
        is pushed after the real loop, so it STEALS the END LOOP that pops the
        innermost frame and comes back closed - a live false green on 17.11 if
        closure were the whole test.

    Anything else - including a word that is not an opener at all - owns no
    statement list. Narrowing here can only WITHHOLD a declaration section, and
    withholding one leaves the RAISE statements inside it counted, which is the
    fail-closed direction for both consumers.
    """
    if word in ("then", "else"):
        enclosing = _enclosing(_block_frames(body), word_start)
        if not enclosing:
            return False
        return max(enclosing, key=lambda fr: fr.start).kind == "IF"
    if word == "loop":
        return _opens_loop_statement(body, word_start)
    return False


def _opens_loop_statement(body: str, pos: int) -> bool:
    """True when the LOOP keyword at `pos` really opens a loop body.

    Two independent things must hold, because neither is sufficient alone:

      * a LOOP frame BEGINS at `pos` and is CLOSED by its own END LOOP. An
        unclosed frame is already dropped, which disposes of a bare
        `SELECT loop declare INTO v FROM t;` with no loop anywhere.
      * the loop's HEAD stands where a statement may begin. The head is the
        keyword `_labelled_opener()` already models - a bare LOOP, or the
        WHILE / FOR / FOREACH whose header ends at this LOOP - and a header
        contains no `;`, so one is not looked for across a statement boundary.
        A `<<lp>>` label needs no separate branch: `_opens_block_position()`
        sees through a complete label to wherever the label itself stands, for
        the plain and the WHILE / FOR / FOREACH forms alike.

    The second test is what the stolen END LOOP above cannot fake: the word
    before that `loop` is `SELECT`, which opens no statement.

    Round 20: that label branch USED to be a separate `pos in _block_labels()`
    shortcut, and it bypassed the head test completely. `_block_labels()` took
    any `>>` that a complete `<<ident>>` reached, so the ordinary shift
    expression `SELECT a << b >> loop declare INTO v_x FROM public.t` - valid
    on 17.11, with `loop` an unreserved column name and `declare` its alias -
    labelled the fake LOOP frame the identifier pushes. Placed inside a real
    loop the fake frame also STEALS that loop's END LOOP and so comes back
    closed, which is the exact case the head test was added to stop; the
    manufactured label handed it a way around. The shortcut is gone and the
    head test is now the only route, with the label read through
    `_opens_block_position()` where an operand before the `<<` disqualifies it.

    Bounded residue, fail-closed: a loop whose head reaches `pos` only through
    text this does not model keeps its DECLARE section unrecognized, which
    leaves the RAISE statements inside it counted.
    """
    if not any(
        fr.kind == "LOOP" and fr.start == pos for fr in _block_frames(body)
    ):
        return False
    for m in _LOOP_HEAD_RE.finditer(body, 0, pos + 1):
        head = m.start()
        if ";" in body[head:pos]:
            continue
        keyword = _LOOP_KW_RE.search(body, head)
        if (
            keyword is not None
            and keyword.start() == pos
            and _opens_block_position(body, head)
        ):
            return True
    return False


def _owns_statement_list_lexically(body: str, word: str, word_start: int) -> bool:
    """`_owns_statement_list()`'s question answered WITHOUT consulting frames.

    The strict test asks which construct owns a THEN, an ELSE or a LOOP, and it
    answers that by reading `_block_frames()`. `_control_frames()` cannot ask it
    - that is the walk which BUILDS those frames - so the frame model passes
    this variant into the same grammar instead of growing a second one.

    It keeps the two rules that need no frames: the word must be one of the four
    statement openers, and an `END LOOP` opens nothing. It drops only the
    construct-ownership refinement, which makes it strictly MORE permissive than
    the strict test - and that is the direction the frame model needs. Dropping
    a frame PostgreSQL really opens is the fail-OPEN direction here: the
    construct's own closer then pops somebody else's frame, an enclosing BEGIN
    ends early, and a guard that sits inside a handler or a loop is reported at
    the routine's outer statement level. Manufacturing one is the failure this
    round closes. So the frame model refuses only what it can PROVE is not
    structure, and `SELECT begin FROM t` - the Round-21 case - is refused here
    because `select` opens no statement.
    """
    if word not in _STATEMENT_OPENER_KEYWORDS:
        return False
    return not (word == "loop" and _previous_word(body, word_start)[0] == "end")


def _is_sql_qualified(body: str, pos: int) -> bool:
    """True when the token at `pos` is the tail of a dot-qualified SQL name.

    Round 21 (Grok, A2), and the ONE rule that says a PL/pgSQL structural token
    cannot be owned through SQL `.` qualification. PostgreSQL lets EVERY word
    this scanner treats as structure stand after a dot, reserved or not: `t.end`,
    `t . end` and `(t).end` all resolve to a column, and so do the `begin`,
    `loop`, `case`, `if`, `raise`, `exception`, `when`, `return`, `then`, `else`
    and `elsif` spellings - all 36 accepted live on PostgreSQL 17.11.

    No PL/pgSQL structural keyword is ever preceded by a dot, so this refuses
    exactly the qualified-identifier reading and nothing else. It is applied to
    every token the block lexer matches rather than to END alone, so a later
    keyword cannot reopen the hole through a spelling nobody enumerated.
    """
    j = _prev_nonspace(body, pos)
    return j >= 0 and body[j] == "."


def _opens_block_position(body: str, pos: int, owns=None) -> bool:
    """True when a PL/pgSQL BLOCK may begin at `pos`.

    A block is a statement, so every statement position qualifies; the routine's
    own outermost block is the one that does not, because callers slice the body
    from the CREATE statement and it opens directly after the dollar-quote that
    opens the body.

    Round 19: `BEGIN` is handled by walking back rather than by accepting the
    word, because `begin` is unreserved and `SELECT begin declare INTO v FROM t`
    is the same false green as the CASE arms above. A block-opening BEGIN itself
    stands where a block may begin, so the test simply repeats there - which
    keeps `BEGIN DECLARE v integer; BEGIN v := 1; END; END` (valid on 17.11)
    working at the body opener, after a `;`, and after a THEN, an ELSE or a LOOP
    that `_owns_statement_list()` accepts. The walk is iterative and each step
    moves strictly left, so no chain of BEGINs can recurse without bound.

    Round 20: a complete `<<label>>` is stepped over the same way, because a
    label OWNS the block or loop after it - so `<<blk>> DECLARE ... BEGIN` and
    `<<lp>> WHILE ... LOOP` are block positions exactly when the label is one.
    That is the whole of the label rule: `_label_opener_before()` proves the
    construct is a real label, and this walk then asks where the label stands,
    so `SELECT a << b >> declare` and `SELECT a << b >> loop` - both ordinary
    shift expressions on 17.11 - reach the operand `a` and are refused. Every
    step still moves strictly left, the label step included.

    Round 22: a DECLARE is stepped over the same way, because the BEGIN that
    OWNS a declaration section opens a block wherever that section does - and
    for the empty `DECLARE BEGIN` list, valid on 17.11, no `;` stands between
    them to say so. Which offset that is comes from `_owned_section_begin()`,
    the one resolver both declaration consumers use, so the frame model and the
    span model cannot disagree about where a block opens.
    """
    while True:
        j = _prev_nonspace(body, pos)
        if j < 0:
            return True
        if body[j] == ";":
            return True
        if body[j] == "$" and _ends_dollar_body_opener(body, j):
            return True
        label = _label_opener_before(body, pos)
        if label is not None:
            pos = label
            continue
        word, word_start = _previous_word(body, pos)
        if word == "declare":
            # Round 22: `DECLARE BEGIN ... END` is a legal EMPTY declaration
            # list on 17.11, so a block DOES open directly after the keyword
            # with no `;` before it - and the frame model used to refuse it, so
            # a labelled `<<blk>> DECLARE BEGIN` pushed no BEGIN frame, the
            # label attached to nothing, and an `EXIT blk` that really does skip
            # a guard became invisible. Proven live: the routine compiles, the
            # non-member UPDATE runs and no assertion executes.
            #
            # Only ONE offset after a DECLARE qualifies, and which one is
            # `_owned_section_begin()`'s answer, never a second reading of the
            # section - `SELECT declare BEGIN` must still open nothing. Where
            # the DECLARE itself stands is decided by continuing this same walk
            # from it, exactly as the `begin` step below does, so a label before
            # it is handled by the label step already in this loop and no new
            # grammar is introduced. The step moves strictly left.
            declare = _DECLARE_TOKEN_RE.match(body, word_start)
            if declare is None or _owned_section_begin(body, declare.end()) != pos:
                return False
            pos = word_start
            continue
        if word != "begin":
            return (owns or _owns_statement_list)(body, word, word_start)
        pos = word_start


def _opens_frame_position(body: str, pos: int) -> bool:
    """Where a PL/pgSQL BLOCK or STATEMENT may begin, without reading frames."""
    return _opens_block_position(body, pos, _owns_statement_list_lexically)


def _closes_loop_header(body: str, pos: int) -> bool:
    """True when the LOOP at `pos` ends a loop HEADER.

    `_opens_loop_statement()` asks this too, but it also requires a closed LOOP
    frame, which is exactly what `_control_frames()` is still computing. This is
    the head half alone: the bare LOOP, or the WHILE / FOR / FOREACH whose header
    reaches this keyword with no `;` in between, standing where a statement may
    begin. That last test is what `SELECT loop declare INTO v FROM t` fails - the
    word before the identifier is `SELECT`.
    """
    for m in _LOOP_HEAD_RE.finditer(body, 0, pos + 1):
        head = m.start()
        if ";" in body[head:pos]:
            continue
        keyword = _LOOP_KW_RE.search(body, head)
        if (
            keyword is not None
            and keyword.start() == pos
            and _opens_frame_position(body, head)
        ):
            return True
    return False


def _owns_control_frame(body: str, token: str, pos: int) -> bool:
    """True when the matched token really OPENS the PL/pgSQL construct it names.

    Round 21 (Codex, A1). Matching a keyword is not owning one. `BEGIN`, `IF`
    and `LOOP` are UNRESERVED in PostgreSQL - `SELECT begin FROM t`,
    `SELECT if FROM t` and `SELECT loop FROM t` all run on 17.11 - so the word
    alone pushed a frame that PostgreSQL never opened. A manufactured BEGIN in
    particular took the EXCEPTION section away from the real block: the handler
    attached to the fake frame, the real one was left with no handler and then
    dropped as unclosed, and an assertion the handler demonstrably swallows was
    reported as the routine's live authorization boundary. Proven live: the
    guard raises when called directly, while the SECURITY DEFINER routine
    returns normally.

    Each opener is proved in its own terms rather than by one keyword list:

      * BEGIN and IF must stand where a block or statement may begin.
      * LOOP must stand there too, OR close a WHILE / FOR / FOREACH header,
        which is not a statement position and needs the head rule instead.
      * CASE is RESERVED, so a bare `case` cannot be an identifier at all and
        the dot rule covers the only other spelling. An embedded SQL CASE is a
        real CASE frame, which is why a bare END closes one.

    Proving rather than guessing is what keeps this fail-closed: a token that
    cannot be shown to open a construct opens none, and no frame is manufactured
    that could erase a real guard's evidence.
    """
    if token == "CASE":  # nosec B105 - parsed PL/pgSQL keyword, not a credential
        return True
    if token == "LOOP":  # nosec B105 - parsed PL/pgSQL keyword, not a credential
        return _opens_frame_position(body, pos) or _closes_loop_header(body, pos)
    return _opens_frame_position(body, pos)


@functools.lru_cache(maxsize=256)
def _labelled_declare_offsets(body: str) -> frozenset[int]:
    """Offsets of every DECLARE that a complete `<<label>>` introduces.

    Read forward from the `<<`, exactly as _block_labels() reads a label, so
    `<<blk>> DECLARE x integer; BEGIN ... END blk;` - valid on 17.11, with or
    without whitespace after the `>>` - keeps its section, while a `>>` that is
    only the right-shift operator introduces nothing. The label's TEXT is not
    needed here, so the masked body serves as its own raw text: a quoted label's
    content is blanked, which still parses as one identifier part.
    """
    offsets = set()
    for m in _LABEL_OPEN_RE.finditer(body):
        if not _opens_block_position(body, m.start()):
            continue
        parsed, after = _parse_identity(body, body, m.end())
        if parsed is None or len(parsed[0]) != 1:
            continue
        if not body.startswith(">>", after):
            continue
        target = _skip_ws(body, after + 2)
        if _DECLARE_TOKEN_RE.match(body, target):
            offsets.add(target)
    return frozenset(offsets)


def _opens_declaration_section(body: str, pos: int) -> bool:
    """True when a DECLARE at `pos` can actually open a declaration section.

    `declare` is UNRESERVED in PostgreSQL, so it is also a legal bare column or
    variable name: `SELECT declare INTO v FROM t` runs on 17.11. Treating every
    occurrence of the word as a section opener would let such an identifier
    start a span that swallows a real outer-level `RAISE EXCEPTION` after it,
    and a routine whose guard genuinely cannot run would be accepted. So the
    position is checked, not just the word.

    A declaration section belongs to a BLOCK, so DECLARE opens one exactly where
    a block may begin - verified on 17.11 at body start and after `;`, BEGIN,
    THEN, ELSE and LOOP - plus directly after a `<<label>>`, which owns the
    block (`<<blk>> DECLARE ... BEGIN ... END blk;`). After anything else, as in
    `SELECT declare ...`, `8 >> declare` or `col$declare`, the word is part of an
    ordinary expression or identifier.
    """
    return (
        pos in _labelled_declare_offsets(body)
        or _opens_block_position(body, pos)
    )


@functools.lru_cache(maxsize=1024)
def _owned_section_begin(body: str, start: int) -> int | None:
    """Offset of the BEGIN that actually OPENS the block `start` declares.

    `start` is the offset just past a DECLARE keyword that
    `_opens_declaration_section()` has already proved opens a section. The
    answer is the ONE thing both declaration consumers need - where the
    declaration list stops and the block begins - so it is resolved once here
    rather than searched for separately in each.

    Round 22. The model this file carried was that the FIRST `BEGIN` after a
    DECLARE always ends the section. It does not. A declaration's initializer is
    an ordinary SQL expression, `begin` is UNRESERVED in PostgreSQL, and the
    masker keeps executable identifiers by design - it blanks comments and
    literal CONTENT, nothing else. Every one of these compiles on 17.11, and in
    each the masked body still spells a `begin` that opens no block:

        x integer := (SELECT begin FROM t LIMIT 1);
        x integer := (SELECT 1 AS begin);
        x integer := (SELECT t.begin FROM t t LIMIT 1);
        x integer := (SELECT (t).begin FROM t t LIMIT 1);
        x integer := abs((SELECT begin FROM t LIMIT 1));
        c CURSOR FOR SELECT begin FROM t;   -- and at paren depth 0

    Taking the first of those as the section end truncated the span in two
    security-bearing directions at once: a later declaration fell OUT of the
    section, so `raise integer := 2;` was read as an abort that PostgreSQL never
    executes, and a block label attached to a `begin` owning no frame, so an
    `EXIT` that really does skip a guard stopped being visible.

    The discriminator is the declaration grammar, confirmed on 17.11, not an
    expression parser:

        [ <<label>> ] DECLARE declaration* BEGIN statements END

    Every declaration ends with `;`, and no declaration may be NAMED `begin`:
    `DECLARE begin integer := 1;` is rejected, because BEGIN is reserved to
    PL/pgSQL even though SQL leaves the word unreserved. So the opening BEGIN is
    the first candidate standing at a DECLARATION BOUNDARY - either the section
    start itself, which is the empty `DECLARE BEGIN` section 17.11 accepts, or
    directly after the `;` that ended the previous declaration. A `begin`
    anywhere else inside the section is expression text, whatever it spells.

    Two conditions refuse the spellings that could reach a boundary by accident.
    A block opener never stands inside an unclosed parenthesis - parens survive
    masking exactly where they are structural, since any inside a comment or a
    literal are already blank - and it is never the tail of a dot-qualified name
    (`t.begin`, `t . begin`, `(t).begin`), which is the rule `_is_sql_qualified()`
    already states once for every structural token.

    Ambiguity fails CLOSED: a candidate that cannot be PROVED to own the block is
    skipped, which leaves the declaration section open rather than ending it
    early. `None` means no BEGIN in this body owns the section at all.
    """
    depth = 0
    cursor = start
    for match in _SECTION_BEGIN_RE.finditer(body, start):
        at = match.start()
        depth += body.count("(", cursor, at) - body.count(")", cursor, at)
        cursor = at
        if depth != 0 or _is_sql_qualified(body, at):
            continue
        if _skip_ws(body, start) == at:
            # `DECLARE BEGIN` - an empty declaration list, valid on 17.11.
            return at
        previous = _prev_nonspace(body, at)
        if previous >= 0 and body[previous] == ";":
            return at
    return None


@functools.lru_cache(maxsize=256)
def _declaration_spans(body: str) -> tuple[tuple[int, int], ...]:
    """`(start, end)` for every DECLARE section in the body, end-exclusive.

    A DECLARE that never reaches a BEGIN cannot compile; the span simply runs to
    the end of the body rather than guessing at a boundary that is not there.
    """
    spans = []
    for m in _DECLARE_TOKEN_RE.finditer(body):
        if not _opens_declaration_section(body, m.start()):
            continue
        opener = _owned_section_begin(body, m.end())
        spans.append((m.end(), opener if opener is not None else len(body)))
    return tuple(spans)


def _in_declaration_section(body: str, pos: int) -> bool:
    """True when `pos` lies between a DECLARE and the BEGIN that ends it.

    Everything in that span is a declaration, and every `;` in it terminates a
    declaration rather than an executable statement.
    """
    return any(start <= pos < end for start, end in _declaration_spans(body))


# Round 18: an assignment TARGET is not always a bare word. PL/pgSQL accepts a
# selector chain after the variable, and every form below was compiled AND run on
# PostgreSQL 17.11 with `raise` as the variable's name - each one assigns, reads
# the value back, and aborts nothing:
#
#     raise.actual_qty := 2;      raise.actual_qty = 3;
#     raise /* c */ . /* c */ actual_qty := 4;      raise."Odd Field" := 5;
#     raise[1] := 2;   raise[1] = 3;   raise [1] := 4;   raise[1][2] := 5;
#     raise[1:2] := ARRAY[7,7];    raise[idx[1]] := 8;
#     raise[1].actual_qty := 6;    raise.arr[1] := 6;    raise.a.b.c := 13;
#     raise[1].a[1].subfield := 2;   raise[1]."Odd Field" := 14;
#
# so the chain is `.field` and `[subscript]` in any order and to any depth, and
# the dotted depth is NOT capped at a two-part name: `raise.a.b.c := 13` assigns
# and execution continues past it. Stopping at the first word made
# `raise.actual_qty := 2` and `raise[1] := 2` read as RAISE statements, and the
# oracle shows the cost concretely: an unguarded SECURITY DEFINER routine whose
# deny branch holds only `raise.actual_qty := 2` stays `prosecdef = true` and
# client-executable, denies a non-member nothing, and drove its privileged UPDATE
# for one - bins.actual_qty 55 -> 0 - while parse_blocks() recorded the target as
# the IF frame's raise_pos and check_file() returned []. The subscript form does
# the same.
#
# Only these two selectors are consumed, and only as selectors: no expression
# grammar, no arithmetic, nothing that lets arbitrary text between the word and
# an operator pass for a target. A real RAISE cannot be mistaken for one either -
# its grammar continues with a level, a format literal, a condition name,
# SQLSTATE, USING or `;`, and none of those begins with `.` or `[`.
#
# A quoted field name reads as `"` + blanks + `"` in the masked body every caller
# passes: _mask_quoted_identifier() blanks the content INCLUDING a doubled `""`,
# so no interior quote survives and the delimiters alone bound the name. A BARE
# field name is read by `_UNQUOTED_IDENT_RE`, the file's one unquoted-identifier
# definition, rather than a second spelling of PostgreSQL's identifier alphabet.
_TARGET_QUOTED_FIELD_RE = re.compile(r'"[^"]*"')


def _skip_plpgsql_ws(body: str, i: int) -> int:
    """Forward twin of _prev_nonspace(): PostgreSQL's whitespace set, not
    Python's. Comments are already whitespace in the masked body."""
    while i < len(body) and body[i] in _PLPGSQL_WS:
        i += 1
    return i


def _skip_target_selectors(body: str, i: int) -> int:
    """Consume the `.field` / `[subscript]` chain of an assignment target.

    Returns `i` unchanged the moment anything else appears, and refuses to
    consume a selector that is not complete - an unclosed `[` or a `.` with no
    identifier after it leaves the position where it was rather than running to
    the end of the body.
    """
    n = len(body)
    while True:
        j = _skip_plpgsql_ws(body, i)
        if j >= n:
            return i
        if body[j] == ".":
            name = _skip_plpgsql_ws(body, j + 1)
            field = (
                _TARGET_QUOTED_FIELD_RE.match(body, name)
                or _UNQUOTED_IDENT_RE.match(body, name)
            )
            if field is None:
                return i
            i = field.end()
        elif body[j] == "[":
            end = _skip_subscript(body, j)
            if end is None:
                return i
            i = end
        else:
            return i


def _skip_subscript(body: str, i: int) -> int | None:
    """Index just past the `[...]` opening at `i`, or None when it is not closed.

    Nested brackets are balanced, because `raise[idx[1]] := 8` is a real target
    on 17.11. A `;` ends the statement, so a bracket that reaches one was never a
    subscript and nothing is consumed.
    """
    depth = 0
    for j in range(i, len(body)):
        if body[j] == "[":
            depth += 1
        elif body[j] == "]":
            depth -= 1
            if depth == 0:
                return j + 1
        elif body[j] == ";":
            return None
    return None


def _is_assignment_target(body: str, pos: int) -> bool:
    """True when the word at `pos` is the left side of a PL/pgSQL assignment.

    Round 19: the word is walked with `_IDENT_CONT_RE`, the file's one
    continuation class, not `str.isalnum() + "_"`. Those are not the same set,
    and PostgreSQL 17.11 sides with ident_cont on every disagreement:

      * `$` continues an identifier, so `raise$x := 2`, `raise$x = 2`,
        `raise$ := 2` and `raise$$x := 2` each assign to ONE ordinary variable.
        The old walk stopped at the `$`, found no assignment operator there and
        reported a RAISE statement, so a deny branch that denies nothing read as
        an authorization boundary. Proven live: prosecdef = true, executable by
        the client role, nothing raised, and the privileged UPDATE ran for a
        non-member (bins.actual_qty 55 -> 0).
      * EVERY non-ASCII code point continues an identifier (scan.l takes the
        whole \200-\377 byte range), while str.isalnum() is a Unicode CATEGORY
        test that excludes combining marks, format characters, punctuation and
        emoji. `raise\u0301`, `raise\u00b7`, `raise\u200b` and `raise\U0001F600`
        are single identifiers PostgreSQL accepts and assigns to; all four were
        the same live bypass.
    """
    end = pos
    while end < len(body) and _IDENT_CONT_RE.match(body, end):
        end += 1
    end = _skip_target_selectors(body, end)
    return _ASSIGNMENT_OPERATOR_RE.match(body, end) is not None


def _previous_word(body: str, pos: int) -> tuple[str, int]:
    """The identifier word ending just before `pos`, folded, with its start.

    Whitespace is skipped, and a COMMENT is already whitespace in the masked
    body every caller passes - which is what makes the decision below
    independent of spacing. Returns ("", pos) when the preceding token is not
    an identifier word at all.

    Round 19: the walk back uses `_IDENT_CONT_RE` for the same reason, and the
    run it collects must then BE one identifier - `_UNQUOTED_IDENT_RE` matching
    it exactly. That is what keeps a keyword-shaped SUFFIX from passing for a
    keyword:

      * `col$then`, `col$loop` and `col\u0301then` are each ONE identifier on
        17.11, so `SELECT col$then raise INTO v FROM t` selects that column
        under the alias `raise` and raises nothing. Walking back over
        `isalnum() + "_"` stopped at the `$` and read `then`, which opens a
        statement, so the alias counted as a RAISE statement and manufactured a
        deny boundary - live, with the UPDATE reached by a non-member.
      * When the run does not start where an identifier may start, `pos` is
        INSIDE a token rather than after one (`col$then$raise` is a single
        identifier, and `\bRAISE\b` still matches its tail). "" is returned, so
        no opener is claimed for a boundary PostgreSQL does not have. A run that
        begins with a digit cannot arise from text 17.11 compiles at all - it
        rejects `8then` as "trailing junk after numeric literal".
    """
    j = pos - 1
    while j >= 0 and body[j] in _PLPGSQL_WS:
        j -= 1
    end = j + 1
    while j >= 0 and _IDENT_CONT_RE.match(body, j):
        j -= 1
    start = j + 1
    word = _UNQUOTED_IDENT_RE.match(body, start) if start < end else None
    if word is None or word.end() != end:
        return "", start
    return body[start:end].lower(), start


def _opens_statement_position(body: str, pos: int) -> bool:
    """The PREVIOUS-TOKEN half of the statement-start test.

    Split out of _is_statement_start() so that the DECLARE-section model can
    reuse the very same positional rule without calling back into the structural
    tests that themselves depend on it. Rounds 13-16 live here unchanged.
    """
    j = pos - 1
    while j >= 0 and body[j] in _PLPGSQL_WS:
        j -= 1
    if j < 0:
        return True
    if body[j] == ";":
        return True
    word, word_start = _previous_word(body, pos)
    if word not in _STATEMENT_OPENER_KEYWORDS:
        return False
    if word == "loop" and _previous_word(body, word_start)[0] == "end":
        return False
    return True


def _is_statement_start(body: str, pos: int) -> bool:
    """True when a PL/pgSQL statement may begin at `pos`.

    `LOOP` has to be an opener, because `LOOP RAISE EXCEPTION ...` is the real
    thing. But PostgreSQL also closes a labelled loop as
    `END LOOP <label>;`, and `raise` is a perfectly ordinary label there, so
    `LOOP` alone made the loop's END-LABEL read as the start of a RAISE
    statement.

    Round 15: the oracle confirms `<<raise>> WHILE false LOOP NULL; END LOOP
    raise;` compiles on PostgreSQL 17.11 and raises NOTHING - as do the plain
    LOOP, FOR and FOREACH forms - while an unguarded SECURITY DEFINER routine
    built around it stayed `prosecdef = true`, executable by PUBLIC and
    `authenticated`, and drove its privileged UPDATE for a non-member. The
    same misreading hit the other caller in the opposite direction: an end
    label named `raise` counted as an earlier outer-level abort and a real
    `PERFORM public.wardah_assert_org_member(...)` after it was written off as
    unreachable.

    So when the previous word is `LOOP`, the word before THAT decides: `END
    LOOP` closes a loop, and whatever follows is its label, never a statement.
    Everything that genuinely opens a loop body - a bare `LOOP`, `<<lp>> LOOP`,
    `WHILE x LOOP`, `FOR ... LOOP` - has something other than `END` there and
    is unaffected, and `END LOOP; RAISE ...` still reaches the `;` test above.

    A labelled BLOCK needs nothing here: it closes as `END <label>;`, and
    `END` was never an opener. Labels are still parsed only by
    _block_labels()/_labelled_opener(); this reads two keywords, and adds no
    second label parser.

    DECLARE is deliberately absent from the opener set - see the note there.
    It begins a DECLARATION section, not a statement, so the identifier after
    it is a variable name.

    Round 17: the previous token alone cannot settle two cases, so two
    structural tests run first. Inside a DECLARE section every `;` terminates a
    DECLARATION, so a second or third variable named `raise` is not a statement
    however it is reached; and a word an assignment operator follows is the
    TARGET of that assignment, which no RAISE statement can be. Both tests live
    here, in the one classifier both callers share, so neither caller can drift.
    """
    if _in_declaration_section(body, pos):
        return False
    if _is_assignment_target(body, pos):
        return False
    return _opens_statement_position(body, pos)

# ---------------------------------------------------------------------------
# Which EXCEPTION handlers can actually catch an authorization failure
# ---------------------------------------------------------------------------
# A PL/pgSQL `RAISE EXCEPTION` without an explicit SQLSTATE raises P0001
# (raise_exception), which is what all three recognized assertion helpers do.
# A handler swallows the denial when any of its conditions matches that code.
#
# PostgreSQL matches a handler condition against the raised SQLSTATE in
# exactly two ways (plpgsql exec.c, exception_matches_conditions):
#
#   exact     the condition's own code equals the raised code;
#   CATEGORY  the condition's code is a category - its last three characters
#             are '000' - and the raised code belongs to that class.
#
# So P0001 is caught by the exact code P0001 AND by its class code P0000. That
# second door was open: `WHEN plpgsql_error` (P0000) and `WHEN SQLSTATE 'P0000'`
# both catch a P0001 assertion and neither was recognized. Verified on a live
# PostgreSQL, not inferred.
#
# Every condition NAME is resolved by PostgreSQL at compile time - an
# unrecognized one is a hard error - so the only names that can reach P0001 are
# the two below plus OTHERS. An unknown identifier therefore cannot be an
# attacker's invention and is correctly treated as non-catching; that is what
# keeps `WHEN unique_violation` from producing a false red.
_P0001_CATCHING_CODES = frozenset({"P0001", "P0000"})
_P0001_CATCHING_NAMES = frozenset({"others", "raise_exception", "plpgsql_error"})

# Handler headers inside an EXCEPTION section, on MASKED text so that a WHEN in
# a comment or a literal cannot invent one. Conditions are then split on OR.
_HANDLER_WHEN_RE = re.compile(_pg_kw("WHEN"), re.IGNORECASE)
_HANDLER_THEN_RE = re.compile(_pg_kw("THEN"), re.IGNORECASE)
_CONDITION_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# A condition name may also be written as a QUOTED identifier - PostgreSQL's
# lexer accepts `WHEN "raise_exception" THEN` and resolves it to the very same
# condition as the bare name. The masker blanks quoted-identifier CONTENT while
# keeping both delimiters, so such a term reads as `"              "` in the
# masked body and matched no name at all: `WHEN "raise_exception"`,
# `WHEN "others"` and `WHEN "plpgsql_error"` each swallowed an assertion's
# authorization failure while the scanner reported the function as guarded.
# The name is therefore recovered from the unmasked source at the same offsets,
# exactly as the SQLSTATE value below is.
# The same UESCAPE grammar as _UESCAPE_CLAUSE_RE, including its E-string
# operand: the two must agree about what a delimited identifier looks like, or
# a handler written `WHEN U&"other!0073" UESCAPE E'!' THEN` fails this shape
# test, never reaches the shared reader, and silently counts as non-catching.
_QUOTED_CONDITION_RE = re.compile(
    f"""\\A(?:U&)?"[^"]*"(?:{_WS0}UESCAPE{_WS0}[Ee]?'[^']*')?\\Z""",
    re.IGNORECASE,
)
# The masker blanks literal CONTENT, so `WHEN SQLSTATE 'P0001'` reads as
# `WHEN SQLSTATE '     '` in the masked body. Rather than unmasking literals
# globally - which would hand guard detection back every string it was hardened
# against - the SQLSTATE value alone is recovered from the unmasked text at the
# same offsets, and only inside a handler condition. Locating the keyword and
# the quotes on MASKED text is also what makes `WHEN SQLSTATE /* why */ 'P0001'`
# resolve: the comment is whitespace by then, so no separator regex has to
# anticipate it.
_SQLSTATE_KEYWORD_RE = re.compile(_pg_kw("SQLSTATE"), re.IGNORECASE)

# PostgreSQL's lexer is BYTE based (src/backend/parser/scan.l):
#
#     dolq_start  [A-Za-z\200-\377_]
#     dolq_cont   [A-Za-z\200-\377_0-9]
#
# Every byte from \200 to \377 is accepted, and the lexer never asks what
# character those bytes spell. In a UTF-8 source each non-ASCII codepoint
# encodes to bytes that are ALL >= 0x80, so "any codepoint >= U+0080" is the
# exact character-level equivalent of that byte range - which is the same rule
# `_IDENT_START`/`_IDENT_CONT` already apply to ordinary identifiers further
# down. Note dolq_cont, unlike ident_cont, excludes `$`: a `$` ends the tag.
#
# str.isalpha()/str.isalnum() are NOT that rule and were the previous test.
# They are Unicode CATEGORY tests, so every non-ASCII codepoint outside
# categories L*/N* was read as "not a tag": emoji, combining marks, ZWSP, NBSP,
# soft hyphen, U+FEFF, private-use characters and `Ⅸ` among them. PostgreSQL
# opens a dollar-quoted literal on all of those, so the masker left the
# literal's CONTENT visible as executable text - and a guard name written
# inside it counted as a real assertion. Verified against a live PostgreSQL 17
# over the whole ASCII range plus a Unicode spread: every disagreement was a
# non-ASCII codepoint PostgreSQL accepted and this scanner rejected.
# `_PG_WS` - PostgreSQL's own whitespace set as a regex character class - is
# defined once, beside the identifier alphabet it is used with. Round 21 moved
# it there and removed this second spelling of it.

_DOLQ_START = "A-Za-z_\x80-\U0010FFFF"
_DOLQ_CONT = "A-Za-z0-9_\x80-\U0010FFFF"
_DOLLAR_TAG_RE = re.compile(f"\\$(?:[{_DOLQ_START}][{_DOLQ_CONT}]*)?\\$")
# The unquoted-identifier alphabet and the keyword-boundary rule derived
# from it now live beside the structural block model above, because the
# PL/pgSQL keyword lexers there are their first consumer. Nothing is
# respelled here: `_DOLQ_*` above is dollar-tag grammar, which differs from
# ident_cont in excluding `$`.
_SIMPLE_ESCAPES = {
    "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t",
    "\\": "\\", "'": "'", '"': '"',
}


def _decode_pg_escape_string(raw: str) -> str | None:
    """Decode an E'' escape-string's raw content. None when a backslash escape
    is not one this scanner confidently understands - the caller then fails
    closed instead of comparing against a guessed value."""
    out = []
    i, n = 0, len(raw)
    while i < n:
        ch = raw[i]
        if ch == "'" and raw[i:i + 2] == "''":
            out.append("'")
            i += 2
            continue
        if ch == "\\" and i + 1 < n:
            nxt = raw[i + 1]
            if nxt == "x":
                j = i + 2
                digits = ""
                while j < n and len(digits) < 2 and raw[j] in "0123456789abcdefABCDEF":
                    digits += raw[j]
                    j += 1
                if not digits:
                    return None
                out.append(chr(int(digits, 16)))
                i = j
                continue
            if nxt in "01234567":
                j = i + 1
                digits = ""
                while j < n and len(digits) < 3 and raw[j] in "01234567":
                    digits += raw[j]
                    j += 1
                # PostgreSQL's \ooo is a BYTE value, not a Unicode code point:
                # an octal escape whose value exceeds 255 wraps modulo 256
                # (\461 = octal 305 = 0x131, low byte 0x31 = '1'). chr() of the
                # unmasked int would instead have produced an unrelated
                # high-range character and hidden a real 'P0001' spelling.
                out.append(chr(int(digits, 8) & 0xFF))
                i = j
                continue
            if nxt in _SIMPLE_ESCAPES:
                out.append(_SIMPLE_ESCAPES[nxt])
                i += 2
                continue
            return None
        out.append(ch)
        i += 1
    return "".join(out)


def _read_sqlstate_literal(
    term: str, raw_body: str, offset: int, pos: int
) -> tuple[str | None, bool]:
    """Decode a SQLSTATE using the masker's shared RAW literal spans.

    Unknown operands (including U& strings and their optional UESCAPE clause)
    fail closed. Unicode value decoding is deliberately outside this reader's
    contract; it must never be mistaken for an unrelated exception condition.
    Dollar quoting remains standalone, and ordinary chains assume PostgreSQL's
    standard_conforming_strings=on. Returns (value, unparseable).
    """
    raw = raw_body[offset:offset + len(term)]
    if raw[pos:pos + 1] == "$":
        match = _DOLLAR_TAG_RE.match(raw, pos)
        if match:
            end = raw.find(match.group(), match.end())
            if end != -1:
                return raw[match.end():end], False
        return None, True
    if raw[pos:pos + 1] in ("E", "e") and raw[pos + 1:pos + 2] == "'":
        pos += 1
    if raw[pos:pos + 1] != "'":
        return None, True
    try:
        spans, escape = _quoted_chain_spans(raw, pos)
    except MaskError:
        return None, True
    values = []
    for start, end in spans:
        content = raw[start + 1:end - 1]
        value = _decode_pg_escape_string(content) if escape else content.replace("''", "'")
        if value is None:
            return None, True
        values.append(value)
    return "".join(values), False


# ONE PostgreSQL-aware reader for a DELIMITED identifier, shared by every place
# that has to resolve an identifier's identity: routine and schema names,
# parameter types, and exception-condition names. PostgreSQL spells a delimited
# identifier two ways and resolves BOTH to the same identifier:
#
#     "raise_exception"           ordinary quoted identifier
#     U&"raise_excepti\006Fn"     Unicode delimited identifier (scan.l, UIDENT)
#
# The second was invisible to the scanner: a handler written
# `WHEN U&"raise_exception" THEN` swallowed an assertion's authorization
# failure while the function was still reported as guarded. Recognizing only
# the first spelling is exactly the incomplete-fix shape that reopened it, so
# the U& form is decoded here rather than special-cased at any call site.
#
# `UESCAPE 'c'` replaces the default backslash; PostgreSQL rejects a hex digit,
# `+`, `'`, `"` and whitespace as that character. Anything this reader cannot
# resolve returns None and every caller FAILS CLOSED on that - an identity that
# cannot be proven must never be compared as if it were known.
_UAMP_PREFIX_RE = re.compile(r'U&(?=")', re.IGNORECASE)
# PostgreSQL 17.11 requires "a simple string literal" after UESCAPE, and that
# admits the E-prefixed escape-string form: `UESCAPE E'!'` is accepted, and
# `UESCAPE E'\\'` selects the backslash. `N'!'`, `U&'!'` and a two-character
# operand are all rejected there - all three verified on the oracle.
#
# Round 13 (Fable, F9): only the plain `'c'` form was matched, so
# `U&"authenticate!0064" UESCAPE E'!'` showed NO clause at all, the content
# was decoded against the default backslash, and the reader returned a
# plausible but WRONG identity (`authenticate!0064`). A wrong identity is
# worse than an unresolved one: it looks like an ordinary non-client role, so
# it never trips the UNRESOLVED_GRANTEE fail-closed path and a GRANT spelled
# that way reopened a closed function invisibly. The content is read with the
# SAME escape-string decoder the SQLSTATE path uses, and a keyword-without-a-
# recognized-clause fails closed rather than falling back to a guess.
_UESCAPE_CLAUSE_RE = re.compile(
    f"[{_PG_WS}]*UESCAPE[{_PG_WS}]*(?P<e>[Ee])?'(?P<val>[^']*)'", re.IGNORECASE
)
_UESCAPE_KEYWORD_RE = re.compile(
    f"[{_PG_WS}]*" + _pg_kw("UESCAPE"), re.IGNORECASE
)
_UHEX4_RE = re.compile(r"[0-9A-Fa-f]{4}")
_UHEX6_RE = re.compile(r"\+([0-9A-Fa-f]{6})")
_BAD_UESCAPE_CHARS = frozenset('+\'"0123456789abcdefABCDEF')


def _decode_unicode_identifier(content: str, esc: str) -> str | None:
    """Decode a U&"..." identifier's content, or None when PostgreSQL would
    reject it. Surrogate PAIRS are combined as PostgreSQL combines them; a lone
    surrogate, a NUL, and a malformed escape are all errors there, so they are
    unresolvable here too."""
    out, i, n, high = [], 0, len(content), None
    while i < n:
        ch = content[i]
        if ch != esc:
            if high is not None:
                return None
            out.append(ch)
            i += 1
            continue
        if content[i + 1:i + 2] == esc:
            if high is not None:
                return None
            out.append(esc)
            i += 2
            continue
        m4 = _UHEX4_RE.match(content, i + 1)
        if m4:
            code, i = int(m4.group(0), 16), m4.end()
        else:
            m6 = _UHEX6_RE.match(content, i + 1)
            if m6 is None:
                return None
            code, i = int(m6.group(1), 16), m6.end()
        if 0xD800 <= code <= 0xDBFF:
            if high is not None:
                return None
            high = code
            continue
        if 0xDC00 <= code <= 0xDFFF:
            if high is None:
                return None
            out.append(chr(0x10000 + ((high - 0xD800) << 10) + (code - 0xDC00)))
            high = None
            continue
        if high is not None or code == 0:
            return None
        out.append(chr(code))
    if high is not None:
        return None
    return "".join(out)


def _read_delimited_identifier(raw: str, pos: int, masked: str | None = None):
    """(resolved name, index just past it) for a `"..."` or `U&"..."`
    identifier at `pos`, or None when there is none or it cannot be resolved.

    `raw` must be UNMASKED text: masking blanks quoted-identifier content by
    design, so the identity only exists in the raw source. `masked` is the SAME
    span masked and offset-aligned, and it is what decides STRUCTURE - here,
    whether a `UESCAPE` clause follows the closing quote.

    That split matters because a comment is not whitespace in raw bytes. With
    raw text alone, `U&"authenticate!0064" /* c */ UESCAPE '!'` - which
    PostgreSQL resolves to the role `authenticated` - showed no UESCAPE clause,
    so the content was decoded against the DEFAULT backslash escape and this
    function returned a plausible but WRONG identity instead of None. A wrong
    identity never trips the UNRESOLVED_GRANTEE fail-closed path, so a GRANT
    spelled that way reopened a closed function invisibly. Callers that hold
    only raw text keep the old behaviour, which is why every caller in this
    module passes `masked`.
    """
    if masked is None:
        masked = raw
    elif len(masked) != len(raw):
        # The two views must be offset-aligned or the clause below would be
        # read at the wrong place. Fail closed rather than guess.
        return None
    uamp = _UAMP_PREFIX_RE.match(raw, pos)
    start = uamp.end() if uamp else pos
    if raw[start:start + 1] != '"':
        return None
    j, buf = start + 1, []
    while j < len(raw):
        if raw[j] == '"':
            if raw.startswith('""', j):
                buf.append('"')
                j += 2
                continue
            j += 1
            break
        buf.append(raw[j])
        j += 1
    else:
        return None
    content = "".join(buf)
    if not uamp:
        return _pg_identifier(content, quoted=True), j
    escape = "\\"
    # STRUCTURE from masked (so an intervening comment is already whitespace),
    # CONTENT from raw at the same offset (the masker blanks literal content,
    # so the escape character itself only exists in the raw source).
    clause = _UESCAPE_CLAUSE_RE.match(masked, j)
    if clause:
        value = raw[clause.start("val"):clause.end("val")]
        if clause.group("e"):
            escape = _decode_pg_escape_string(value)
        else:
            escape = value
        # PostgreSQL wants exactly one character, and rejects a hex digit,
        # `+`, `'`, `"` and whitespace as that character.
        if escape is None or len(escape) != 1:
            return None
        if escape in _BAD_UESCAPE_CHARS or escape in _PLPGSQL_WS:
            return None
        j = clause.end()
    elif _UESCAPE_KEYWORD_RE.match(masked, j):
        # A UESCAPE clause in a shape this reader does not model. Decoding the
        # content against the default backslash would invent an identity.
        return None
    decoded = _decode_unicode_identifier(content, escape)
    if decoded is None:
        return None
    return _pg_identifier(decoded, quoted=True), j


def _handler_condition_spans(body: str, start: int, end: int):
    """Absolute (start, end) spans of each `WHEN <conditions> THEN` list in
    [start, end).

    Deliberately permissive about which WHEN it finds: an extra span can only
    add conditions to the catch test, which fails closed. A condition that is
    not a recognized catching name still does not catch, so an ordinary
    `CASE WHEN ... THEN` in a handler body cannot invent a false red.
    """
    spans = []
    pos = start
    while True:
        w = _HANDLER_WHEN_RE.search(body, pos, end)
        if w is None:
            return spans
        t = _HANDLER_THEN_RE.search(body, w.end(), end)
        if t is None:
            return spans
        spans.append((w.end(), t.start()))
        pos = t.end()


def _split_top_level_or_spans(condition: str, base: int) -> list[tuple[int, int]]:
    """Absolute (start, end) span of each top-level OR term.

    The string form cannot be used to locate a term: masking blanks literal
    CONTENT but keeps the delimiters, so `SQLSTATE \'P0002\' OR SQLSTATE \'P0001\'`
    masks to two textually IDENTICAL terms. Recovering a term\'s offset with
    str.index() then returns the FIRST one, and the second term\'s SQLSTATE value
    is read out of the first term\'s raw bytes - so a handler that really does
    catch P0001 could be read as catching something else entirely.
    """
    spans, depth, start = [], 0, 0
    for i, ch in enumerate(condition):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif depth == 0:
            m = _TOP_LEVEL_OR_RE.match(condition, i)
            if m and not _continues_identifier(condition, i - 1):
                spans.append((base + start, base + i))
                start = m.end()
    spans.append((base + start, base + len(condition)))
    return spans


def _quoted_condition_name(term: str, raw_body: str | None, offset: int) -> str | None:
    """The PostgreSQL identity of a quoted condition name, or None when it
    cannot be resolved from the raw source (callers fail closed on None).

    `term` is masked text already known to be one delimited identifier;
    `raw_body` is the same body unmasked and offset-aligned, so the identifier's
    content is read back at the same offsets and resolved by the SHARED
    identifier reader - which is what makes the ordinary `"..."` and the Unicode
    `U&"..."` spellings resolve to the same condition here, as they do in
    PostgreSQL.
    """
    if raw_body is None:
        return None
    raw = raw_body[offset:offset + len(term)]
    if len(raw) != len(term):
        return None
    start = term.find('"')
    if start == -1:
        return None
    if term[start - 2:start].upper() == "U&" and start >= 2:
        start -= 2
    read = _read_delimited_identifier(raw, start, term)
    if read is None:
        return None
    return read[0]


def _condition_catches_p0001(body: str, raw_body: str | None, start: int, end: int) -> bool:
    """True when one condition term in body[start:end] can catch a P0001."""
    for term_start, term_end in _split_top_level_or_spans(body[start:end], start):
        term = body[term_start:term_end]
        offset = term_start
        stripped = term.strip()
        if _CONDITION_NAME_RE.match(stripped) and stripped.lower() in _P0001_CATCHING_NAMES:
            return True
        if _QUOTED_CONDITION_RE.match(stripped):
            # A quoted condition name. Comparison is case-insensitive on
            # purpose: PostgreSQL keeps a quoted identifier's case, so
            # `"RAISE_EXCEPTION"` resolves to no condition at all and is a hard
            # compile error - it can never be a live handler - and treating it
            # as catching keeps this reader fail-closed rather than inventing a
            # third folding rule. An unresolvable span is caught too; an
            # unrelated quoted name such as `"unique_violation"` still does not
            # catch, so no false red is invented.
            name = _quoted_condition_name(term, raw_body, offset)
            if name is None or name.lower() in _P0001_CATCHING_NAMES:
                return True
            continue
        kw = _SQLSTATE_KEYWORD_RE.search(term)
        if kw is None:
            continue
        if raw_body is None:
            continue
        # `SQLSTATE <literal>`: the delimiters survive masking, the value does
        # not, so read the value from the unmasked source at the same offsets.
        # PostgreSQL accepts a plain '...' literal, an E'...' escape string, or
        # a $tag$...$tag$ dollar-quoted literal here; an operand that starts
        # one of these forms but cannot be confidently decoded fails closed
        # (treated as catching P0001) rather than being waved through as
        # unrelated.
        lit_pos = _skip_ws(term, kw.end())
        value, unparseable = _read_sqlstate_literal(term, raw_body, offset, lit_pos)
        if unparseable:
            return True
        if value is not None and value.strip().upper() in _P0001_CATCHING_CODES:
            return True
    return False


# A PL/pgSQL block or loop may carry a `<<label>>`, and `EXIT <label>` then
# transfers control to just after that construct's END — including for a plain
# BEGIN block, which is the one shape people do not expect. `EXIT` with no label
# only ever leaves the innermost LOOP, so it cannot skip an outer-level
# statement; a label is what makes the jump able to cross a block boundary.
#
# Attribution is FORWARD, from the label to what it labels, because a block's
# real grammar is
#
#     [ <<label>> ] [ DECLARE declarations ] BEGIN ... END [ label ];
#
# and the label therefore precedes the DECLARE, not the BEGIN. Walking BACKWARD
# from BEGIN over whitespace - the first attempt at this - landed on the `;` of
# the last declaration and returned no label at all, so every function with a
# declaration section (the ordinary shape) silently lost its label and the
# labelled-EXIT bypass reopened. Only BEGIN and LOOP take a label: PL/pgSQL
# labels blocks and loops, never an IF or a CASE, so those are not label targets
# and no wider grammar is modelled here.
#
# The label's own text is read through _parse_identity(), the same identifier
# reader the statement model uses, so a quoted label works and PostgreSQL's
# folding rules are honoured: an unquoted label folds to lower case, a quoted one
# keeps its case, and `<<"Auth_Block">>` is therefore NOT `EXIT auth_block`.
_LABEL_OPEN_RE = re.compile(r"<<")
_DECLARE_KW_RE = re.compile(_pg_kw("DECLARE"), re.IGNORECASE)
_BEGIN_KW_RE = re.compile(_pg_kw("BEGIN"), re.IGNORECASE)
_LOOP_KW_RE = re.compile(_pg_kw("LOOP"), re.IGNORECASE)
_LOOP_HEAD_RE = re.compile(_pg_kw("LOOP|WHILE|FOR|FOREACH"), re.IGNORECASE)


def _labelled_opener(body: str, pos: int) -> int | None:
    """Offset of the block/loop keyword a label ending at `pos` attaches to.

    Deliberately strict about what may follow the label: BEGIN, a DECLARE
    section, or a loop head. That is the whole grammar, and requiring it is also
    what stops the inet/box shift operators from inventing a label - in
    `a << b >> c` the text after `>>` is an ordinary expression, not a block
    opener, so no label is recorded.
    """
    i = _skip_ws(body, pos)
    if _BEGIN_KW_RE.match(body, i):
        return i
    declare = _DECLARE_KW_RE.match(body, i)
    if declare:
        # A declaration section runs to the BEGIN that opens the block - and a
        # declaration CAN spell BEGIN, because masking keeps executable
        # identifiers and `begin` is unreserved in SQL. The label belongs to the
        # real opener, so this asks `_owned_section_begin()`, the same resolver
        # `_declaration_spans()` uses; there is no second search for it.
        return _owned_section_begin(body, declare.end())
    if _LOOP_HEAD_RE.match(body, i):
        # WHILE/FOR/FOREACH open their frame at the LOOP keyword that ends the
        # loop header, which is where parse_blocks() pushes the frame.
        #
        # Round 20: bounded by the first `;`, because a loop HEADER contains
        # none - the same bound `_opens_loop_statement()` already applies when
        # it walks a head. Unbounded, this search adopted the next LOOP
        # anywhere later in the body, so a label could be attached to a real
        # loop it does not introduce and across any number of statements.
        opener = _LOOP_KW_RE.search(body, i)
        if opener is None or ";" in body[i:opener.start()]:
            return None
        return opener.start()
    return None


# ---------------------------------------------------------------------------
# PostgreSQL identifier identity - the ONE definition
# ---------------------------------------------------------------------------
# Every security decision in this scanner ultimately compares two identifiers:
# is this EXIT's target the label on the block the guard sits in, does this
# REVOKE name the function that was just defined, is this the same overload,
# is this grantee `authenticated`. If the scanner's notion of "same identifier"
# differs from PostgreSQL's ANYWHERE, that difference is a false green.
#
# It differed in three separate places, each with its own rules, and four
# consecutive review rounds each found a fresh instance:
#
#   * the unquoted alphabet stopped at U+FFFF, so a label containing a 4-byte
#     UTF-8 character parsed as nothing at all and no label was recorded;
#   * folding used Python's `str.lower()`, which folds the whole Unicode
#     repertoire, while PostgreSQL's downcase_identifier() downcases ONLY
#     ASCII A-Z in a multibyte encoding - so `rpc_bÄd` and `rpc_bäd`, two
#     different functions, merged into one, and U+212A KELVIN SIGN folding to
#     a one-byte `k` moved the length clip two bytes and un-merged a pair
#     PostgreSQL had already merged;
#   * the NAMEDATALEN clip existed as its OWN layer applied to labels and EXIT
#     targets but not to routine names, schemas or type names.
#
# So identity is defined once, here, and every security-bearing comparison in
# this file is built on it. PostgreSQL's own order is reproduced exactly:
# downcase first (scansup.c), then truncate (truncate_identifier), because the
# fold can change the byte length and therefore where the clip falls.
#
# `_ASCII_FOLD` is what downcase_identifier() does when `enc_is_single_byte` is
# false, which is the case for the UTF-8 databases this repository uses: bytes
# 'A'-'Z' are lowered and every other byte is left exactly as it is.
_NAMEDATALEN_LIMIT = 63
_ASCII_FOLD = {c: c + 32 for c in range(ord("A"), ord("Z") + 1)}


def _fold_unquoted(text: str) -> str:
    """downcase_identifier() for a multibyte encoding: ASCII A-Z and nothing
    else. Never str.lower(), which folds the whole Unicode repertoire and can
    even change the UTF-8 byte length."""
    return text.translate(_ASCII_FOLD)


def _pg_identifier(text: str, quoted: bool = False) -> str:
    """One identifier as PostgreSQL will resolve and store it.

    `text` is the identifier's own characters - for a quoted identifier, its
    content with `""` already unescaped, not the surrounding quotes.

    Unquoted: fold ASCII A-Z only, never `str.lower()`, so a non-ASCII code
    point keeps its identity exactly as PostgreSQL keeps it.
    Quoted: content survives verbatim, case included.
    Both: clipped to NAMEDATALEN-1 = 63 BYTES on a character boundary, which is
    what pg_mbcliplen() guarantees - errors="ignore" drops only a partial
    trailing sequence, and the input is always valid UTF-8 here.
    """
    folded = text if quoted else _fold_unquoted(text)
    raw = folded.encode("utf-8")
    if len(raw) <= _NAMEDATALEN_LIMIT:
        return folded
    return raw[:_NAMEDATALEN_LIMIT].decode("utf-8", "ignore")


def _effective_identifier(name: str) -> str:
    """Length clip alone, for an identifier whose folding is already resolved.

    Kept as a thin wrapper so it cannot drift into a second definition of
    identity: it is _pg_identifier()'s quoted path, which applies no folding.
    """
    return _pg_identifier(name, quoted=True)


def _block_labels(body: str, raw_body: str | None = None) -> dict[int, str]:
    """{opener offset: canonical label} for every `<<label>>` in the body.

    The unmasked default is resolved here rather than in parse_blocks(), which
    CodeFactor already flags for complexity (#244); this keeps that method's
    branch count exactly where it was.

    Round 20: the `<<` must stand where a PL/pgSQL construct may BEGIN, the same
    proof `_labelled_declare_offsets()` already required of it. Without that,
    the only test was that a complete `<<ident>>` reached a `>>` - and
    PostgreSQL spells right shift `>>` too, so the ordinary expression
    `SELECT a << b >> loop declare INTO v_x FROM public.t` labelled a frame that
    an identifier had pushed, and `SELECT a << b >> begin$x ...` did the same
    through a keyword-shaped identifier suffix. A label on a frame is not inert:
    `_opens_loop_statement()` used to accept a labelled LOOP frame without any
    further proof, and `labelled_exit_before()` matches an EXIT target against
    it. Asking where the `<<` stands is what an operand before it fails.

    No recursion: `_opens_block_position()` reaches `_block_frames()`, which
    walks the structure with NO labels, and its own label step is the backward
    reader rather than this map.
    """
    if raw_body is None:
        raw_body = body
    labels: dict[int, str] = {}
    for m in _LABEL_OPEN_RE.finditer(body):
        if not _opens_block_position(body, m.start()):
            continue
        parsed, after = _parse_identity(raw_body, body, m.end())
        if parsed is None:
            continue
        parts, _quoted = parsed
        if len(parts) != 1:
            continue
        after = _skip_ws(body, after)
        if not body.startswith(">>", after):
            continue
        opener = _labelled_opener(body, after + 2)
        if opener is not None:
            labels[opener] = _effective_identifier(parts[0])
    return labels


class _Frame:
    __slots__ = ("kind", "start", "end", "then_pos", "closed", "raise_pos", "exc_pos",
                 "label")

    def __init__(self, kind, start, label=None):
        self.kind = kind
        self.start = start
        self.end = 1 << 60
        self.then_pos = None
        self.closed = False
        self.raise_pos = None
        self.exc_pos = None
        self.label = label


def _control_frames(body: str, labels: dict[int, str], on_raise=None):
    """The BEGIN / IF / LOOP / CASE / EXCEPTION stack walk itself.

    Round 19 split this out of parse_blocks() so the DECLARE-evidence test can
    ask the SAME structure which construct owns a THEN, an ELSE or a LOOP,
    instead of a second parser drifting from this one. `on_raise` carries the
    only part that is not pure structure - and the only part that calls back
    into the statement classifier - so passing None gives a walk the
    declaration model can use without recursing through it.

    ROUND 21 FRAME-MUTATION AUDIT. Every mutation this walk performs, what
    proves the token is PL/pgSQL structure, and what stops embedded SQL, a
    qualified identifier or identifier-continuation ambiguity from stealing it.
    The first three defences are shared by EVERY row, so they are stated once:

      SHARED-1  the token must be a PostgreSQL keyword token. `_KW_LEFT` /
                `_KW_RIGHT` are derived from `_IDENT_CONT`, so a keyword-shaped
                SUFFIX inside one identifier (`col$end`, `end$x`, `co\u0301lend`)
                matches nothing. [Round 20]
      SHARED-2  a multiword token is keyword + `_PG_WS` + keyword, so
                `END\u00a0IF` - ONE identifier on 17.11 - is not `END IF`.
                [Round 21 B1]
      SHARED-3  `_is_sql_qualified()` refuses any token whose previous
                significant character is `.`, so `t.end`, `t . end` and
                `(t).end` mutate nothing. Applied to all 13 tokens, not to END
                alone. [Round 21 A2]

      PUSH BEGIN / IF / LOOP - `_owns_control_frame()` must prove the token
        OPENS the construct. All three words are UNRESERVED, so SHARED-1..3 do
        not stop a bare column name; the position test does. BEGIN and IF need a
        block or statement position; LOOP needs that or a WHILE/FOR/FOREACH
        header. [Round 21 A1]
      PUSH CASE - reserved, so it is never a bare identifier, and SHARED-3
        covers `t.case`. An embedded SQL CASE is a REAL CASE frame, which is why
        a bare END closes one; refusing it would leave that END to pop a BEGIN.
      ANNOTATE THEN / ELSE - both RESERVED, so neither can be a bare column
        name; SHARED-1..3 are the whole defence. No position test is applied,
        because a real THEN follows an expression rather than a statement
        boundary and testing it would DROP real annotations.
      ANNOTATE ELSIF - not a SQL keyword at all, so a bare `elsif` identifier is
        possible and only SHARED-1..3 apply. That direction is fail-CLOSED: a
        spurious `closed` flag makes `on_raise` withhold the deny branch, which
        reports a finding. Adding a position test here would risk DROPPING a
        real ELSIF, and that IS fail-open - a RAISE in the ELSIF branch would
        then be credited to the IF's own deny branch.
      ANNOTATE EXCEPTION - `exception` is not a SQL keyword either, so the
        handler section must also stand where a statement may begin. Both real
        forms qualify: after the block's last `;`, and directly after BEGIN for
        a block with an empty statement list.
      POP END / END IF / END LOOP / END CASE - all four begin with RESERVED
        `END`, so no bare identifier reaches them; SHARED-1..3 are the defence,
        and SHARED-2 is what Round 21 added. No position test: a SQL CASE's END
        follows an expression, and refusing it would unbalance the stack.
      RAISE callback - SHARED-1..3, plus `_is_statement_start()` inside
        parse_blocks()'s `on_raise`, which is the Round 13-19 statement-position
        model.

    Unclosed frames stay out of `frames`, so a stack this walk cannot balance
    recognizes nothing rather than guessing - the same fail-closed rule as
    before.
    """
    stack, frames = [], []

    def pop(kinds, at):
        for i in range(len(stack) - 1, -1, -1):
            if stack[i].kind in kinds:
                fr = stack.pop(i)
                fr.end = at
                frames.append(fr)
                return

    for m in _BLOCK_TOKEN_RE.finditer(body):
        # A dot-qualified SQL name is never PL/pgSQL structure, whichever word
        # it ends in. Applied to EVERY token the lexer matches - push, annotate,
        # pop and RAISE alike - so no spelling is left to a per-keyword patch.
        if _is_sql_qualified(body, m.start()):
            continue
        token = " ".join(m.group(1).upper().split())
        if token in ("BEGIN", "IF", "LOOP", "CASE"):
            if not _owns_control_frame(body, token, m.start()):
                continue
            stack.append(_Frame(token, m.start(), labels.get(m.start())))
        elif token == "THEN":  # nosec B105 - parsed PL/pgSQL keyword, not a credential
            if stack and stack[-1].kind == "IF" and stack[-1].then_pos is None:
                stack[-1].then_pos = m.start()
        elif token in ("ELSIF", "ELSE"):
            if stack and stack[-1].kind == "IF":
                stack[-1].closed = True
        elif token == "EXCEPTION":  # nosec B105 - parsed PL/pgSQL keyword, not a credential
            # `RAISE EXCEPTION` is a statement, not a handler section.
            if _RAISE_BEFORE_RE.search(body[max(0, m.start() - 16): m.start()]):
                continue
            # `exception` is not a SQL keyword at all, so `SELECT exception
            # FROM t` runs on 17.11; a handler section only ever opens where a
            # statement may begin.
            if not _opens_frame_position(body, m.start()):
                continue
            for fr in reversed(stack):
                if fr.kind == "BEGIN":
                    if fr.exc_pos is None:
                        fr.exc_pos = m.start()
                    break
        elif token == "END IF":  # nosec B105 - parsed PL/pgSQL keyword, not a credential
            pop(("IF",), m.start())
        elif token == "END LOOP":  # nosec B105 - parsed PL/pgSQL keyword, not a credential
            pop(("LOOP",), m.start())
        elif token == "END CASE":  # nosec B105 - parsed PL/pgSQL keyword, not a credential
            pop(("CASE",), m.start())
        elif token == "END":  # nosec B105 - parsed PL/pgSQL keyword, not a credential
            pop(("BEGIN", "CASE"), m.start())
        elif token == "RAISE" and on_raise is not None:  # nosec B105 - parsed PL/pgSQL keyword, not a credential
            on_raise(stack, m)

    # Unclosed frames stay out of `frames`, so nothing depending on them is
    # recognized. That fails closed rather than guessing at the structure.
    return frames


def parse_blocks(body: str, raw_body: str | None = None):
    """Model BEGIN / IF / LOOP / CASE nesting and EXCEPTION sections.

    LOOP covers WHILE, FOR and FOREACH, which all open with LOOP and close with
    END LOOP. A bare END closes the innermost BEGIN or CASE, so a CASE
    expression cannot silently close an enclosing block.

    `raw_body` is the SAME span of the unmasked source. It is consulted only for
    block-label text, which masking necessarily hides for a quoted label.
    """
    def on_raise(stack, m):
        fr = stack[-1] if stack else None
        if (
            fr is not None
            and fr.kind == "IF"
            and fr.then_pos is not None
            and not fr.closed
            and fr.raise_pos is None
            and not _NON_ABORTING_RAISE_RE.match(body, m.start())
            and _is_statement_start(body, m.start())
        ):
            fr.raise_pos = m.start()

    return _control_frames(body, _block_labels(body, raw_body), on_raise)


@functools.lru_cache(maxsize=256)
def _block_frames(body: str) -> tuple:
    """The same walk, structure only, for the DECLARE-evidence test.

    No label text is needed (only kind/start/end are read) and no `on_raise`,
    so this cannot re-enter _is_statement_start() and the declaration model
    that depends on it.
    """
    return tuple(_control_frames(body, {}))


def _enclosing(frames, pos):
    return [f for f in frames if f.start < pos < f.end]


def _handler_catches(body: str, frame, raw_body: str | None = None) -> bool:
    """True when the block's EXCEPTION handlers can catch a P0001 assertion.

    Every `WHEN ... THEN` header in the handler section is resolved condition by
    condition, so a catching condition anywhere in an OR-list counts and an
    unrelated one (`unique_violation`) still does not. `raw_body` is the SAME
    span of the unmasked source; it is consulted only for the SQLSTATE value,
    which masking necessarily hides.
    """
    if frame.exc_pos is None:
        return False
    for start, end in _handler_condition_spans(body, frame.exc_pos, frame.end):
        if _condition_catches_p0001(body, raw_body, start, end):
            return True
    return False


def is_swallowed(body: str, frames, pos: int, raw_body: str | None = None) -> bool:
    """True when an authorization failure raised at `pos` would be caught by an
    enclosing block's own EXCEPTION handlers.

    Only blocks that actually enclose `pos` count: a later, unrelated nested
    exception block elsewhere in the function must not invalidate this guard,
    and a handler for an unrelated condition cannot catch the assertion.
    """
    for frame in _enclosing(frames, pos):
        if frame.kind != "BEGIN":
            continue
        if (
            frame.exc_pos is not None
            and pos < frame.exc_pos
            and _handler_catches(body, frame, raw_body)
        ):
            return True
    return False


def is_outer_statement_level(frames, pos: int) -> bool:
    """True when `pos` sits at the function's outermost PL/pgSQL statement level.

    Not inside IF/ELSIF/ELSE, LOOP/WHILE/FOR/FOREACH, CASE, a nested BEGIN, or
    an EXCEPTION handler. Identity and org-resolution reads may legitimately
    precede the guard: this is about execution level, not textual first-line
    placement. Reachability past an earlier RETURN is handled separately by
    terminating_return_before().
    """
    enclosing = _enclosing(frames, pos)
    if any(f.kind in ("IF", "LOOP", "CASE") for f in enclosing):
        return False
    begins = [f for f in enclosing if f.kind == "BEGIN"]
    if len(begins) > 1:
        return False
    if begins and begins[0].exc_pos is not None and pos > begins[0].exc_pos:
        return False
    return True


# A plain `RETURN` (with or without an expression) ends the invocation, so any
# assertion after it is dead code even at the outer statement level. RETURN NEXT
# and RETURN QUERY do NOT terminate a set-returning function, so they are not
# treated as exits. `RETURNS` in the function header is not a word match.
_TERMINATING_RETURN_RE = re.compile(
    _pg_kw("RETURN") + f"(?!{_WS1}(?:NEXT|QUERY)" + _KW_RIGHT + ")",
    re.IGNORECASE,
)


def terminating_return_before(body: str, pos: int) -> bool:
    """True when the invocation can already have ended before `pos`.

    Deliberately conservative and purely textual: any terminating RETURN earlier
    in the body disqualifies the candidate, whether it is unconditional dead code
    (`RETURN; PERFORM assert...`) or an early exit on some input path
    (`IF p_skip THEN RETURN; END IF; PERFORM assert...`). Both leave the
    privileged work unguarded on at least one path. This can reject a complex
    future function whose returns are all provably guarded; the remedy is to move
    the authorization boundary earlier, never to weaken this gate.
    """
    m = _TERMINATING_RETURN_RE.search(body, 0, pos)
    return m is not None


# RETURN is not the only way the invocation can already be over. An aborting
# RAISE at the function's OUTER statement level ends it just as surely, so an
# assertion placed after one is dead code that no caller ever reaches:
#
#     RAISE EXCEPTION 'NOT_IMPLEMENTED';
#     PERFORM public.wardah_assert_org_member(p_org);   -- never executes
#
# Only an OUTER-level raise counts. A raise inside an IF/LOOP/CASE or a nested
# BEGIN is conditional, so a later assertion is still reachable and must not be
# rejected. RAISE NOTICE/WARNING/INFO/LOG/DEBUG report without aborting and are
# excluded; a bare re-`RAISE;` inside a handler is not outer level by
# construction.
_ABORTING_RAISE_RE = re.compile(
    _pg_kw("RAISE")
    + f"(?!{_WS1}(?:NOTICE|WARNING|INFO|LOG|DEBUG)" + _KW_RIGHT + ")",
    re.IGNORECASE,
)


def unconditional_abort_before(body: str, frames, pos: int) -> bool:
    """True when an outer-level aborting RAISE precedes `pos`."""
    for m in _ABORTING_RAISE_RE.finditer(body, 0, pos):
        if not _is_statement_start(body, m.start()):
            # A bare `raise` identifier ends no invocation (Round 13, F8).
            continue
        if is_outer_statement_level(frames, m.start()):
            return True
    return False


# RETURN and an aborting RAISE end the whole invocation. A labelled EXIT does
# something narrower and just as effective: it leaves the block it names and
# resumes after that block's END, so every statement still pending inside that
# block is skipped. When the named block is the one the candidate guard sits in,
# the guard is on the skipped side of the jump:
#
#     <<auth_block>>
#     BEGIN
#       UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;
#       EXIT auth_block;                                  -- jumps past END
#       PERFORM public.wardah_assert_org_member(p_org);   -- never executes
#     END auth_block;
#
# The privileged write has already happened and the assertion is dead code, yet
# the guard call is a real call, at the outer statement level, with no RETURN and
# no aborting RAISE before it - so every earlier reachability rule accepts it.
#
# The test is deliberately narrow, so that an EXIT which does NOT cross the
# guard's block cannot produce a false red: the labelled frame must CONTAIN the
# candidate position, and the EXIT must sit inside that same frame, earlier. An
# inner labelled block that exits itself and completes before a later outer-level
# guard therefore still passes. `EXIT label WHEN <predicate>` is covered by the
# same rule - a conditional jump still leaves a path on which the guard never
# runs, which is exactly what terminating_return_before() already treats as
# disqualifying. An unlabelled EXIT is not matched: it can only leave the
# innermost LOOP, and anything inside a loop is already rejected as not
# outer-level.
#
# The EXIT's own target is read with the SAME identifier reader as the block
# label, for the same reason: PostgreSQL accepts a quoted identifier on either
# side, and the masker blanks quoted content, so a hand-rolled ASCII pattern read
# `EXIT "auth_block";` as `EXIT "          ";` and matched nothing at all. Going
# through _parse_identity() also picks up the high-range identifier characters
# _UNQUOTED_IDENT_RE already models, so a non-ASCII label is not a way out
# either.
_EXIT_KW_RE = re.compile(_pg_kw("EXIT"), re.IGNORECASE)
_WHEN_KW_RE = re.compile(_pg_kw("WHEN"), re.IGNORECASE)

# A target that is label-SHAPED but that this scanner cannot resolve to one
# identifier. It matches any block containing both the EXIT and the candidate,
# so an EXIT whose destination cannot be read never silently authorizes
# anything. A token that is not label-shaped at all (a comma, a digit) is not
# this: it means the EXIT is not an EXIT statement - `SELECT exit, x FROM t`
# names a column - and treating that as a wildcard would be a false red.
_UNREADABLE_EXIT_TARGET = object()


def _exit_targets(body: str, raw_body: str, end: int):
    """(offset, target) for each EXIT before `end` that names a destination."""
    out = []
    for m in _EXIT_KW_RE.finditer(body, 0, end):
        i = _skip_ws(body, m.end())
        if i >= len(body) or body[i] == ";" or _WHEN_KW_RE.match(body, i):
            continue  # `EXIT;` and `EXIT WHEN <predicate>` carry no label
        parsed, _after = _parse_identity(raw_body, body, i)
        if parsed is None:
            if raw_body[i] == '"' or _UNQUOTED_IDENT_RE.match(raw_body, i):
                out.append((m.start(), _UNREADABLE_EXIT_TARGET))
            continue
        parts, _quoted = parsed
        # A label is a single identifier; `EXIT a.b` is not one this scanner can
        # resolve, so it fails closed rather than being dropped.
        out.append(
            (m.start(),
             _effective_identifier(parts[0]) if len(parts) == 1
             else _UNREADABLE_EXIT_TARGET)
        )
    return out


def labelled_exit_before(
    body: str, frames, pos: int, raw_body: str | None = None, after: int = 0
) -> bool:
    """True when a labelled EXIT in `body[after:pos]` can jump out of a block
    that contains `pos`, skipping it."""
    if raw_body is None:
        raw_body = body
    for exit_pos, target in _exit_targets(body, raw_body, pos):
        if exit_pos < after:
            continue
        for frame in frames:
            if not (frame.start < pos < frame.end
                    and frame.start < exit_pos < frame.end):
                continue
            if target is _UNREADABLE_EXIT_TARGET or frame.label == target:
                return True
    return False


def is_unreachable_at(
    body: str, frames, pos: int, raw_body: str | None = None
) -> bool:
    """True when `pos` can be skipped - through a terminating RETURN, an
    outer-level aborting RAISE, or a labelled EXIT out of its own block."""
    return (
        terminating_return_before(body, pos)
        or unconditional_abort_before(body, frames, pos)
        or labelled_exit_before(body, frames, pos, raw_body)
    )


# For migrations under the strict contract the assertion must be a STANDALONE
# statement: `PERFORM [public.]guard(args);` and nothing else. PostgreSQL does
# not execute the call in `PERFORM guard(x) WHERE false;` - the query returns no
# rows - and `SELECT guard(x) WHERE false;` is the same trick. Migration 191
# uses the standalone PERFORM form exclusively (9 occurrences, no other shape),
# so this costs nothing today and keeps the authorization boundary provable.
_PERFORM_HEAD_RE = re.compile(_KW_LEFT + f"PERFORM{_WS0}$", re.IGNORECASE)


def is_standalone_perform_assertion(body: str, match) -> bool:
    """True when the guard call is exactly a `PERFORM guard(...);` statement."""
    if not _PERFORM_HEAD_RE.search(body[:match.start()]):
        return False
    depth = 0
    for i in range(match.end() - 1, len(body)):
        ch = body[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return body[i + 1:].lstrip().startswith(";")
    return False


def _if_blocks_with_raising_deny_branch(body: str, raw_body: str | None = None):
    """(if_token_pos, condition_start, condition_end, raise_pos) for each IF whose
    own deny branch reaches an aborting RAISE at its own nesting level.

    The RAISE must be REACHABLE: a terminating RETURN between THEN and the RAISE
    means the deny branch can exit before it ever denies, so the block is not an
    authorization boundary. A labelled EXIT (with or without a WHEN clause)
    between THEN and the RAISE, targeting a block that contains the RAISE, is
    the same bypass - it lets the deny branch jump past the RAISE instead of
    returning past it, so it disqualifies the branch exactly like RETURN does.
    """
    frames = list(parse_blocks(body, raw_body))
    blocks = []
    for f in frames:
        if f.kind != "IF" or f.then_pos is None or f.raise_pos is None:
            continue
        if _TERMINATING_RETURN_RE.search(body, f.then_pos, f.raise_pos):
            continue
        if labelled_exit_before(
            body, frames, f.raise_pos, raw_body, after=f.then_pos
        ):
            continue
        blocks.append((f.start, f.start + 2, f.then_pos, f.raise_pos))
    return blocks


def has_negated_raising_predicate(
    body: str, strict: bool = False, raw_body: str | None = None
) -> bool:
    """True when a boolean membership predicate is negated as a WHOLE top-level
    condition term of an IF whose deny branch reaches an aborting RAISE, that
    denial is not swallowed, and - under the strict contract - the guarding IF
    sits at the outer statement level with no terminating RETURN before it."""
    frames = parse_blocks(body, raw_body)
    for if_pos, cond_start, cond_end, raise_pos in _if_blocks_with_raising_deny_branch(
        body, raw_body
    ):
        if is_swallowed(body, frames, raise_pos, raw_body):
            continue
        if strict and not is_outer_statement_level(frames, if_pos):
            continue
        if strict and is_unreachable_at(body, frames, if_pos, raw_body):
            continue
        condition = body[cond_start:cond_end]
        if any(_is_sole_negated_predicate(t) for t in _split_top_level_or(condition)):
            return True
    return False


def has_recognized_guard(
    body: str, strict: bool = False, raw_body: str | None = None
) -> bool:
    """A raising assertion helper, or a boolean predicate in the negated raising
    idiom. A guard whose failure an enclosing handler can swallow never counts;
    under the strict contract it must also be a standalone PERFORM statement at
    the outer statement level, with no terminating RETURN before it."""
    frames = parse_blocks(body, raw_body)
    for m in GUARD_RE.finditer(body):
        # An overload is a different function in PostgreSQL, so a call that does
        # not match the reviewed helper's arity is not the reviewed helper.
        if not guard_call_has_canonical_arity(body, m):
            continue
        if is_swallowed(body, frames, m.start(), raw_body):
            continue
        if strict:
            if not is_standalone_perform_assertion(body, m):
                continue
            if not is_outer_statement_level(frames, m.start()):
                continue
            if is_unreachable_at(body, frames, m.start(), raw_body):
                continue
        return True
    return has_negated_raising_predicate(body, strict=strict, raw_body=raw_body)


def migration_number(path: pathlib.Path):
    """Leading number of a migration filename, or None when it has none."""
    head = path.stem.split("_")[0]
    return int(head) if head.isdigit() else None


class MaskError(Exception):
    """A construct the length-preserving masker cannot mask soundly."""


def _dollar_tag_at(sql: str, i: int) -> str | None:
    """Return the dollar-quote tag opening at i, or None.

    PostgreSQL tags are `$$` or `$tag$` with the tag spelled from
    dolq_start/dolq_cont (see `_DOLLAR_TAG_RE`), so `$1` - a positional
    parameter - is not a tag.

    A tag also cannot BEGIN inside an identifier. PostgreSQL's unquoted
    identifiers admit `$` as a continuation character (scan.l ident_cont), and
    its lexer takes the longest identifier first, so in

        CREATE TABLE public.marker_a (col$a$ integer);

    `col$a$` is ONE column name and no literal is opened at all. Round 13
    (Fable): without this boundary the masker matched `$a$` there and blanked
    everything up to the NEXT `$a$` in the file - which on PostgreSQL 17.11 is
    ordinary executable SQL. That hid whole `CREATE ... SECURITY DEFINER`
    statements and whole GRANT statements from every consumer at once, a full
    acceptance bypass rather than a missed sub-case.

    The boundary lives HERE, in the one shared reader, so `mask_sql_checked()`,
    `_dollar_spans()`, `_read_string_literal_at()` and the SQLSTATE literal
    reader cannot disagree about where a literal starts - the same reason the
    tag grammar itself was centralized.

    This deliberately shares ONE compiled boundary rule with the SQLSTATE
    literal reader. They were two separate transcriptions of the same grammar
    before, and they disagreed: a tag this masker refused to recognize left the
    literal's content exposed as executable text. A single reader cannot drift.
    """
    if i >= len(sql) or sql[i] != "$":
        return None
    if i > 0 and _IDENT_CONT_RE.match(sql, i - 1):
        # The previous character continues an identifier, so this `$` does too.
        # `$` itself is in ident_cont, which is what makes `a$$$` - identifier
        # `a$$` followed by a stray `$` - open nothing either.
        return None
    match = _DOLLAR_TAG_RE.match(sql, i)
    return match.group(0) if match else None


def _blank(out: list[str], start: int, end: int) -> None:
    """Overwrite [start, end) with spaces, keeping newlines so offsets and line
    numbers both survive."""
    for k in range(start, end):
        if out[k] != "\n":
            out[k] = " "


def _mask_line_comment(sql: str, out: list[str], i: int) -> int:
    n = len(sql)
    j = i
    while j < n and sql[j] != "\n":
        out[j] = " "
        j += 1
    return j


def _mask_block_comment(sql: str, out: list[str], i: int) -> int:
    """Mask a /* ... */ comment, honouring PostgreSQL's nesting. Raises when the
    comment is never closed, because everything after it would otherwise be
    scanned as executable text."""
    n = len(sql)
    depth = 0
    j = i
    while j < n:
        if sql.startswith("/*", j):
            depth += 1
            out[j] = out[j + 1] = " "
            j += 2
        elif sql.startswith("*/", j):
            depth -= 1
            out[j] = out[j + 1] = " "
            j += 2
            if depth == 0:
                return j
        else:
            if sql[j] != "\n":
                out[j] = " "
            j += 1
    raise MaskError("unterminated block comment")


def _is_escape_string(sql: str, i: int) -> bool:
    """True when the quote at i opens an E'' escape-string literal.

    The `E` counts as a literal PREFIX only when it is a token of its own. When
    the character before it continues an identifier, PostgreSQL has read one
    identifier ENDING in `E` and the quote after it opens an ordinary literal.

    Round 21 (Grok, B2): that boundary was `str.isalnum() or "_"`, which is
    narrower than PostgreSQL's ident_cont on exactly the characters that make
    the difference - `$` and every non-ASCII code point outside L*/N*. With a
    domain named `v$e` or `v\u0301e` on PostgreSQL 17.11, `v$e'a\\'` is a
    type-prefixed constant whose literal is `a\\`; the old test read the `'` as
    an E-string opener, applied backslash-escape rules, ran the literal past
    the `\\'` and blanked the executable statements after it. A `RETURN;` that
    ends the routine was masked away, and the dead guard behind it was credited
    as the routine's authorization boundary. Both spellings compile live.

    `_continues_identifier()` is the file's ONE membership test for that class,
    the same one `_previous_word()` and `_is_assignment_target()` walk with, so
    the masker and the statement model cannot disagree about where an
    identifier ends.
    """
    if i == 0 or sql[i - 1] not in "Ee":
        return False
    return not _continues_identifier(sql, i - 2)


def _quoted_span_end(sql: str, i: int, escape: bool) -> int:
    """Exclusive end of one raw quoted span, with the CHAIN's escape mode."""
    n = len(sql)
    j = i + 1
    while j < n:
        ch = sql[j]
        if escape and ch == "\\" and j + 1 < n:
            j += 2
            continue
        if ch == "'":
            if sql.startswith("''", j):
                j += 2
                continue
            return j + 1
        j += 1
    raise MaskError("unterminated single-quoted literal")


def _continuation_quote(sql: str, end: int) -> int | None:
    """PostgreSQL quote continuation: whitespace/newline and -- comments.

    Inspect RAW text: masking a block comment into whitespace would invent a
    continuation PostgreSQL does not accept. CR and LF both count as newlines.
    A prefix on a later segment is unsupported syntax and fails closed.

    The separator set is PostgreSQL 17's, which is NOT PostgreSQL 16's. v17
    added the vertical tab to scan.l's `space` class:

        space              [ \t\n\r\f\v]      -- v16 had no \v
        non_newline_space  [ \t\f\v]
        quotecontinue      {non_newline_whitespace}*{newline}{special_whitespace}*{quote}

    so under v17 - the version this project runs - a VT is ordinary whitespace
    on BOTH sides of the required newline. Omitting it split one continued
    literal into two: the SQLSTATE reader then decoded only the first segment
    (`E'P00'` out of `E'P00'\v\n'0\x31'`, missing that the handler really
    catches P0001 and swallows the assertion), and the masker ended the literal
    early, exposing its remaining content - a fake guard after an escaped quote
    in a continued E-string - as executable text. Both were false greens,
    reproduced on a live PostgreSQL 17.
    A VT is whitespace but never a NEWLINE, so it still cannot supply the
    newline PostgreSQL requires; `'a'\v'b'` stays two literals, not one.
    """
    i, n = end, len(sql)
    newline = False
    while i < n:
        if sql[i] in " \t\v\f\r\n":
            newline |= sql[i] in "\r\n"
            i += 1
        elif sql.startswith("--", i):
            i += 2
            while i < n and sql[i] not in "\r\n":
                i += 1
        else:
            break
    if not newline:
        return None
    if sql[i:i + 1] == "'":
        return i
    if sql[i:i + 2].lower() == "e'" or sql[i:i + 3].lower() == "u&'":
        raise MaskError("unsupported prefixed string continuation")
    return None


def _quoted_chain_spans(sql: str, i: int) -> tuple[list[tuple[int, int]], bool]:
    """Shared literal boundaries for masking and SQLSTATE decoding.

    Input starts at the first quote; returned spans include both delimiters.
    Only the leading E/e determines escape mode. Bare continuation segments
    inherit it, including escaped quotes; the mode ends with this chain.
    """
    escape = _is_escape_string(sql, i)
    spans = []
    while True:
        end = _quoted_span_end(sql, i, escape)
        spans.append((i, end))
        next_quote = _continuation_quote(sql, end)
        if next_quote is None:
            return spans, escape
        i = next_quote


def _mask_quoted(sql: str, out: list[str], i: int) -> int:
    """Mask chain contents and separator comments, preserving delimiters."""
    spans, _ = _quoted_chain_spans(sql, i)
    previous_end = i
    for start, end in spans:
        _blank(out, previous_end, start)
        _blank(out, start + 1, end - 1)
        previous_end = end
    return previous_end


def _mask_quoted_identifier(sql: str, out: list[str], i: int) -> int:
    """Mask the CONTENT of a "quoted identifier", keeping both delimiters.

    PostgreSQL escapes an embedded double quote by doubling it. Without this the
    structural PL/pgSQL scan reads a quoted identifier as executable syntax: a
    column aliased `"RAISE"` made an IF branch look like it aborted, which is a
    guard the deny path never actually performs.
    """
    n = len(sql)
    j = i + 1
    while j < n:
        if sql[j] == '"':
            if sql.startswith('""', j):
                _blank(out, j, j + 2)
                j += 2
                continue
            return j + 1
        if sql[j] != "\n":
            out[j] = " "
        j += 1
    raise MaskError("unterminated quoted identifier")


def _mask_nested_dollar(sql: str, out: list[str], i: int, tag: str) -> int:
    """Mask the CONTENT of a dollar-quoted literal nested inside a function
    body ($$text$$ / $tag$text$tag$), keeping its delimiters."""
    body = i + len(tag)
    end = sql.find(tag, body)
    if end == -1:
        raise MaskError(f"unterminated nested dollar-quoted literal {tag}")
    _blank(out, body, end)
    return end + len(tag)


def _preceded_by_keyword(text, i: int, keyword: str) -> bool:
    """Whether the token immediately before offset i is keyword.

    Round 21: both walks use the file's PostgreSQL primitives. `str.isspace()`
    would step over U+00A0 and its 18 siblings, which PostgreSQL reads as
    identifier characters, and `str.isalnum() or "_"` would stop at the `$` in
    `col$grant` - either way a keyword-shaped SUFFIX of one identifier was
    reported as the preceding keyword.
    """
    j = i - 1
    while j >= 0 and text[j] in _PLPGSQL_WS:
        j -= 1
    end = j + 1
    while j >= 0 and _continues_identifier(text, j):
        j -= 1
    return "".join(text[j + 1:end]).lower() == keyword.lower()


def _statement_starts_with_do(text, i: int) -> bool:
    """True when the current top-level statement prefix starts with DO."""
    prefix = "".join(text[:i])
    start = prefix.rfind(";") + 1
    return re.match(
        f"{_WS0}DO" + _KW_RIGHT, prefix[start:], re.IGNORECASE
    ) is not None


def mask_sql_checked(sql: str) -> tuple[str, list[str]]:
    """Blank comments and literal CONTENT, preserving every offset.

    The scan below attributes each SECURITY DEFINER occurrence to the last
    CREATE FUNCTION before it, so positions must not shift. Without this mask a
    comment decides the verdict in both directions: a header comment that merely
    mentions "SECURITY DEFINER" is blamed on the previous (possibly INVOKER)
    function, and a guard named only in prose counts as a real assertion.

    Dollar-quoted function bodies stay visible - that is where the guards live -
    but everything non-executable INSIDE them is masked too: line comments,
    block comments (including nested ones), single-quoted literals (including
    doubled quotes and E'' backslash escapes), "quoted identifiers" and nested
    dollar-quoted literals.
    Before this, an unguarded SECURITY DEFINER body passed the scanner merely by
    naming the guard in `PERFORM 'wardah_assert_org_member';` or in a
    `/* wardah_assert_org_member */` comment.

    Returns the masked text plus a list of fail-closed problems. A construct the
    masker cannot follow (an unterminated comment, literal or dollar quote) is
    reported rather than silently treated as executable or as safe.
    """
    out = list(sql)
    problems: list[str] = []
    n = len(sql)
    i = 0
    outer_tag: str | None = None   # set while inside a function body

    try:
        while i < n:
            if sql.startswith("--", i):
                i = _mask_line_comment(sql, out, i)
                continue
            if sql.startswith("/*", i):
                i = _mask_block_comment(sql, out, i)
                continue
            if sql[i] == "'":
                i = _mask_quoted(sql, out, i)
                continue
            if sql[i] == '"':
                i = _mask_quoted_identifier(sql, out, i)
                continue
            if sql[i] == "$":
                if outer_tag is not None and sql.startswith(outer_tag, i):
                    i += len(outer_tag)
                    outer_tag = None
                    continue
                tag = _dollar_tag_at(sql, i)
                if tag is not None:
                    if outer_tag is None:
                        if (
                            _preceded_by_keyword(out, i, "as")
                            or _statement_starts_with_do(out, i)
                        ):
                            outer_tag = tag
                            i += len(tag)
                        else:
                            i = _mask_nested_dollar(sql, out, i, tag)
                    else:
                        i = _mask_nested_dollar(sql, out, i, tag)
                    continue
            i += 1
    except MaskError as exc:
        problems.append(str(exc))
        return "".join(out), problems

    if outer_tag is not None:
        problems.append(f"unterminated dollar-quoted function body {outer_tag}")

    return "".join(out), problems


def get_cutoff() -> int:
    if BASELINE_FILE is None:
        return 0
    m = re.search(r"migration_cutoff:\s*(\d+)", BASELINE_FILE.read_text(encoding="utf-8"))
    return int(m.group(1)) if m else 0


# ---------------------------------------------------------------------------
# Statement model: identities, definitions, ALTERs and the privilege ledger
# ---------------------------------------------------------------------------
# Attribution used to be positional: find `SECURITY DEFINER`, walk backwards to
# the nearest `CREATE ... FUNCTION`, take 4000 characters as the body, and
# accept any `REVOKE ... FROM PUBLIC` that happened to sit before the next
# `CREATE`. Four different false greens came out of that one shortcut:
#
#   * a definition with no dollar-quoted body (`LANGUAGE internal AS 'boolin'`)
#     borrowed the NEXT function's body, and therefore the next function's
#     guard;
#   * `ALTER FUNCTION ... SECURITY DEFINER` was blamed on whichever function was
#     defined before it - or, with none before it, silently ignored;
#   * a quoted identity (`CREATE FUNCTION public."f"(...)`) matched no CREATE at
#     all, so the DEFINER occurrence was attributed to an earlier function or
#     dropped;
#   * a REVOKE naming a DIFFERENT function, or a different overload, exempted
#     the unguarded one - and a later `GRANT ... TO PUBLIC` re-opened what the
#     REVOKE had closed, invisibly.
#
# So statements are modelled once, by identity, and every later rule reads that
# model instead of re-deriving position.


class _UnresolvedArgs:
    """The third argument-list state: PRESENT in the statement, but not
    resolvable to a type list by this scanner.

    It exists because `None` used to carry two incompatible meanings at once -
    "no argument list was written" and "an argument list was written and could
    not be parsed" - and `same_function()` answers TRUE for the first. Any
    signature this scanner could not read therefore became a WILDCARD that
    matched every overload of the same name, so a REVOKE on `f(text)` exempted
    an unguarded `f(uuid)`. A comment inside the argument list was enough to
    trigger it, and so was any PostgreSQL type syntax the tokenizer does not
    model.

    An unresolved list matches NOTHING, including another unresolved list: two
    signatures nobody could read are not evidence that they are the same
    function.
    """

    __slots__ = ()

    def __repr__(self) -> str:
        return "<unresolved argument list>"


UNRESOLVED_ARGS = _UnresolvedArgs()


class Identity:
    """A schema-qualified function identity, with its argument TYPE list.

    `args` is None when the statement carried NO argument list at all, a tuple
    of normalized type texts when it carried one this scanner resolved, and
    UNRESOLVED_ARGS when it carried one that could not be resolved. Those three
    states are deliberately distinct; see _UnresolvedArgs. Quoted identifiers
    keep their case (PostgreSQL folds only unquoted ones), so
    `"HAS_PERMISSION"` is a different function from `has_permission` and cannot
    inherit its exemption.
    """

    __slots__ = ("schema", "name", "quoted", "args")

    def __init__(self, schema, name, quoted, args):
        self.schema = schema
        self.name = name
        self.quoted = quoted
        self.args = args

    @property
    def qualified(self) -> str:
        base = f"{self.schema}.{self.name}" if self.schema else self.name
        if self.args is None:
            return base
        if self.args is UNRESOLVED_ARGS:
            return f"{base}(<unresolved argument list>)"
        return f"{base}({','.join(str(a) for a in self.args)})"

    def same_function(self, other: "Identity") -> bool:
        """Name match, plus argument-list match when BOTH sides carry one.

        PostgreSQL identifies an overload by its argument types, so a REVOKE on
        `f(text)` says nothing about `f(uuid)`. When either side OMITS the list
        the name match is all that is available. A list that is PRESENT but
        unresolved is a different state entirely and matches nothing at all -
        collapsing it into the omitted case turned every signature this scanner
        could not read into a wildcard.
        """
        if not self._names_can_match(other):
            return False
        if self.args is UNRESOLVED_ARGS or other.args is UNRESOLVED_ARGS:
            return False
        if self.args is None or other.args is None:
            return True
        return self.args == other.args

    def _names_can_match(self, other: "Identity") -> bool:
        """The name/schema half of identity, shared by BOTH relations so they
        cannot drift apart.

        When one side omits the schema, PostgreSQL resolves it through
        search_path - that is NOT a wildcard - and every migration here runs
        with `public` first. So an unqualified name resolves to `public` and
        says nothing about a function in another schema. Treating it as a match
        let a REVOKE with no schema exempt `other_schema.f`.
        """
        if self.name != other.name:
            return False
        if self.schema and other.schema:
            return self.schema == other.schema
        if self.schema or other.schema:
            return (self.schema or other.schema) == "public"
        return True

    def may_be_same_function(self, other: "Identity") -> bool:
        """Could PostgreSQL resolve these two to the SAME routine?

        This is deliberately NOT same_function(). Exact identity answers "are
        these provably the same overload" and an unresolved argument list can
        never prove that, so it matches nothing there - that is what stopped a
        signature this scanner cannot read from acting as a wildcard REVOKE.

        But "not provably the same" was then replayed as "definitely unrelated",
        and for a GRANT that is the wrong default. `public.review_probe(
        public.review_marker.note%TYPE)` is a PostgreSQL-valid way to name an
        existing routine; PostgreSQL resolves the `%TYPE` and reopens client
        EXECUTE, while the scanner silently ignored the statement and still
        reported the function closed.

        So closure asks this question instead for GRANTs: it uses every scrap of
        identity that IS known - schema and routine name - and only concedes the
        argument list. An unresolved GRANT on a DIFFERENT name, or in a provably
        different schema, still cannot touch this routine, so one unreadable
        grant does not reopen every function in the file.
        """
        if not self._names_can_match(other):
            return False
        if self.args is UNRESOLVED_ARGS or other.args is UNRESOLVED_ARGS:
            return True
        if self.args is None or other.args is None:
            return True
        # NOT `==`. Exact identity is what a REVOKE must earn; a GRANT only has
        # to be POSSIBLE. Round 10 (Astra): the two were one equality operator,
        # so `character varying` and `varchar` - one routine in PostgreSQL -
        # read as unrelated and an applicable GRANT was dropped from the replay
        # while the scanner still reported the surface closed.
        if len(self.args) != len(other.args):
            return False
        return all(_may_be_same_type(a, b) for a, b in zip(self.args, other.args))


# PostgreSQL's multi-word built-in type phrases, as lead word -> the words that
# may CONTINUE the type after it. A flat set of lead words was not enough in
# either direction:
#
#   * it was INCOMPLETE. `char varying` is the built-in varchar in PostgreSQL 17,
#     but `char` was not a lead word, so the scanner dropped it as an optional
#     parameter NAME and the type identity became `varying` - the same identity a
#     quoted custom type `"varying"` normalizes to. Two distinct PostgreSQL
#     overloads collapsed into one, so a REVOKE naming either closed the other on
#     paper while PostgreSQL still let clients execute the unguarded definer.
#   * it was also too BROAD. `DOUBLE` is an unreserved keyword, so
#     `CREATE FUNCTION f(double text)` is valid and declares a parameter NAMED
#     `double` of type `text`; a flat lead-word set kept `double` and read the
#     type as `double text`. Every other lead word here is a col_name_keyword and
#     cannot be a bare parameter name at all (`char text`, `time text`,
#     `interval text` are all syntax errors), but the continuation test settles
#     all of them uniformly instead of relying on that.
#
# The decision is therefore "do the first TWO tokens open a type phrase", taken
# BEFORE any optional-name removal. Equivalent PostgreSQL spellings that this
# leaves distinct (`char varying` vs `character varying` vs `varchar`) only cost
# a conservative non-match; the collapse of distinct identities is the unsafe
# direction and is what this closes.
_TYPE_LEAD_CONTINUATIONS = {
    "character": frozenset({"varying"}),
    "char": frozenset({"varying"}),
    "nchar": frozenset({"varying"}),
    "national": frozenset({"character", "char"}),
    "bit": frozenset({"varying"}),
    "double": frozenset({"precision"}),
    "time": frozenset({"with", "without"}),
    "timestamp": frozenset({"with", "without"}),
    "interval": frozenset(
        {"year", "month", "day", "hour", "minute", "second"}
    ),
}
_ARG_MODES = frozenset({"in", "out", "inout", "variadic"})
_UNQUOTED_IDENT_RE = re.compile(f"[{_IDENT_START}][{_IDENT_CONT}]*")
# The same alphabet, anchored: "is this whole token one bare identifier".
_PLAIN_IDENT_RE = re.compile(f"\\A[{_IDENT_START}][{_IDENT_CONT}]*\\Z")
# One parameter is tokenized ONCE, quote-aware and qualification-aware, and
# every later decision is taken on those tokens. The three heuristics this
# replaces each ran on their own slice of the text and each lost:
#
#   * `DEFAULT`/`=` were found by a regex over the UNPARSED parameter, so
#     `"Type DEFAULT A" []` was truncated INSIDE a quoted identifier and two
#     distinct types both normalized to the fragment `"type`;
#   * whitespace splitting knew nothing about qualification, so
#     `"Schema A" . "T" []` looked like the name `"Schema A"` followed by the
#     type `. "T" []`, and `"Schema A"` and `"Schema B"` collapsed together;
#   * neither knew about `U&"..."`.
#
# Each case merged two distinct PostgreSQL overloads into one scanner identity,
# so a REVOKE naming one of them closed the other on paper while PostgreSQL
# still let clients execute the unguarded definer.
_PARAM_PUNCT = frozenset(".,()[]")
_NUMBER_RE = re.compile(r"\d+")


def _tokenize_parameter(masked: str, raw: str):
    """[(kind, value, quoted)] for one parameter, or None when unresolvable.

    STRUCTURE is read from `masked` and identifier CONTENT from `raw` at the
    same offsets. That split is the whole point: the masker has already turned
    comments into whitespace and blanked literal and delimited-identifier
    content, so `uuid /* why */` is structurally `uuid` here without this
    function knowing that comments exist, while `"Type A"` still yields its real
    name. Scanning raw bytes instead made every commented parameter
    unparseable - which, before UNRESOLVED_ARGS, silently became a wildcard.

    kind is 'ident', 'num' or 'punct'. An identifier's value is already
    RESOLVED to PostgreSQL identity - folded when bare, verbatim when
    delimited - so no later step has to know how it was spelled. Reading stops
    at a top-level `DEFAULT` or `=`, which is where the parameter's TYPE ends;
    because that decision is made here, inside the tokenizer, text that merely
    looks like a separator inside a delimited identifier cannot end it.

    Anything else - `%TYPE`, `%ROWTYPE`, or any other valid PostgreSQL type
    syntax this tokenizer does not model - returns None. The caller turns that
    into UNRESOLVED_ARGS, which matches no overload; it must never degrade into
    "no argument list was written".
    """
    tokens, i, depth, n = [], 0, 0, len(masked)
    while i < n:
        ch = masked[i]
        if ch in _PLPGSQL_WS:
            i += 1
            continue
        if ch == "=" and depth == 0:
            break
        if ch in _PARAM_PUNCT:
            if ch in "([":
                depth += 1
            elif ch in ")]":
                depth -= 1
            tokens.append(("punct", ch, False))
            i += 1
            continue
        number = _NUMBER_RE.match(masked, i)
        if number:
            tokens.append(("num", number.group(0), False))
            i = number.end()
            continue
        if masked[i:i + 1] == '"' or _UAMP_PREFIX_RE.match(masked, i):
            delimited = _read_delimited_identifier(raw, i, masked)
            if delimited is None:
                # A delimited identifier that could not be resolved. Fail closed.
                return None
            tokens.append(("ident", delimited[0], True))
            i = delimited[1]
            continue
        bare = _UNQUOTED_IDENT_RE.match(masked, i)
        if bare is None:
            return None
        if depth == 0 and bare.group(0).lower() == "default":
            break
        tokens.append(("ident", _pg_identifier(bare.group(0)), False))
        i = bare.end()
    return tokens



# ---------------------------------------------------------------------------
# Round 10 (Astra): PostgreSQL type identity for routine signatures.
#
# Every entry below was classified against a disposable PostgreSQL 17.11 using
# `::regtype`/`::regprocedure` catalog identity, not intuition. Two spellings
# appear in the same family ONLY where the oracle resolved them to one type OID
# and, for the routine cases, to one pg_proc row.
#
# The two tables are NOT interchangeable, and that is the whole finding behind
# `"char"` vs `char`. PostgreSQL reaches a type by two different routes:
#
#   * a BARE, unqualified spelling goes through the grammar's type keywords
#     first, so `char` is rewritten to bpchar (OID 1042);
#   * a QUOTED or SCHEMA-QUALIFIED spelling is a catalog lookup on
#     pg_type.typname, so `"char"` and `pg_catalog.char` are both the internal
#     one-byte type (OID 18).
#
# They are two different types and two coexisting overloads, so a REVOKE naming
# one may not close the other. Quoting is therefore neither always cosmetic nor
# always significant: the oracle also shows `"varchar"`, `"text"`, `"numeric"`,
# `"bool"`, `"timestamp"`, `"time"` and `"uuid"` DO resolve to their bare
# counterparts, while `"int"`, `"integer"`, `"boolean"`, `"decimal"`,
# `"character"`, `"real"`, `"bigint"` and `"smallint"` do not exist at all.

# pg_type.typname -> canonical format_type() spelling. Used for QUOTED and for
# SCHEMA-QUALIFIED references, which both bypass the keyword grammar.
_TYPNAME_CANONICAL = {
    "varchar": "character varying",
    "bpchar": "character",
    "char": '"char"',
    "text": "text",
    "name": "name",
    "numeric": "numeric",
    "int4": "integer",
    "int2": "smallint",
    "int8": "bigint",
    "float4": "real",
    "float8": "double precision",
    "bool": "boolean",
    "timestamp": "timestamp without time zone",
    "timestamptz": "timestamp with time zone",
    "time": "time without time zone",
    "timetz": "time with time zone",
    "bit": "bit",
    "varbit": "bit varying",
    "date": "date",
    "interval": "interval",
    "uuid": "uuid",
    "json": "json",
    "jsonb": "jsonb",
    "bytea": "bytea",
    "oid": "oid",
    "money": "money",
    "inet": "inet",
    "cidr": "cidr",
    "macaddr": "macaddr",
    "xml": "xml",
}

# The grammar's type KEYWORD phrases -> the same canonical spellings. Used only
# for a BARE, unqualified reference. A bare spelling that is not a keyword falls
# through to _TYPNAME_CANONICAL, which is how `bpchar`, `int4` and `jsonb`
# resolve.
_TYPE_KEYWORD_CANONICAL = {
    "varchar": "character varying",
    "character varying": "character varying",
    "char varying": "character varying",
    "nchar varying": "character varying",
    "national character varying": "character varying",
    "national char varying": "character varying",
    "character": "character",
    "char": "character",
    "nchar": "character",
    "national character": "character",
    "national char": "character",
    "text": "text",
    "numeric": "numeric",
    "decimal": "numeric",
    "dec": "numeric",
    "int": "integer",
    "integer": "integer",
    "smallint": "smallint",
    "bigint": "bigint",
    "real": "real",
    "float": "double precision",
    "double precision": "double precision",
    "boolean": "boolean",
    "timestamp": "timestamp without time zone",
    "timestamp with time zone": "timestamp with time zone",
    "timestamp without time zone": "timestamp without time zone",
    "timetz": "time with time zone",
    "timestamptz": "timestamp with time zone",
    "time": "time without time zone",
    "time with time zone": "time with time zone",
    "time without time zone": "time without time zone",
    "bit": "bit",
    "bit varying": "bit varying",
    "varbit": "bit varying",
}


class _TypeRef:
    """One resolved argument TYPE, carrying the two DIFFERENT questions the ACL
    replay asks about it - which is the Round 10 cross-cutting requirement.

    `exact` is the canonical identity and answers "are these provably the SAME
    routine argument type": it is what a REVOKE must match before it earns
    closure credit.

    `candidates` answers "could PostgreSQL resolve these to the same type": it
    is what a GRANT is tested against, so a spelling this scanner cannot pin
    down is never assumed harmless. For everything the oracle settled the two
    agree and `candidates` is just `{exact}`; they diverge only where static
    parsing genuinely cannot decide - a QUOTED custom type, where quoting may or
    may not be cosmetic depending on a catalog this scanner does not have.

    Comparing equal to a plain `str` keeps _normalize_arg_type() usable as the
    textual canonicalizer it has always been.
    """

    __slots__ = ("exact", "candidates")

    def __init__(self, exact: str, candidates=None):
        self.exact = exact
        self.candidates = frozenset(candidates) if candidates else frozenset((exact,))

    def __eq__(self, other):
        if isinstance(other, _TypeRef):
            return self.exact == other.exact
        if isinstance(other, str):
            return self.exact == other
        return NotImplemented

    def __hash__(self):
        return hash(self.exact)

    def __str__(self) -> str:
        return self.exact

    def __repr__(self) -> str:
        return self.exact

    def may_be(self, other: "_TypeRef") -> bool:
        return bool(self.candidates & other.candidates)


def _may_be_same_type(a, b) -> bool:
    """Could these two argument types be the same one? Tolerates a plain string
    on either side, so an Identity built with literal type texts - as the
    relation tests and any direct caller do - still compares as it always did.
    """
    if isinstance(a, _TypeRef) and isinstance(b, _TypeRef):
        return a.may_be(b)
    return a == b


def _split_array_suffix(tokens):
    """(base_tokens, is_array).

    PostgreSQL ignores array BOUNDS and DIMENSIONALITY when it resolves a
    routine signature: the oracle confirms `int[]`, `int[][]` and
    `int ARRAY[3]` all name one and the same argument type.
    """
    i, is_array = len(tokens), False
    while i > 0 and tokens[i - 1][0] == "punct" and tokens[i - 1][1] == "]":
        k = i - 1
        while k > 0 and tokens[k - 1][0] == "num":
            k -= 1
        if k > 0 and tokens[k - 1][0] == "punct" and tokens[k - 1][1] == "[":
            i, is_array = k - 1, True
            continue
        break
    if i > 0 and tokens[i - 1][0] == "ident" and not tokens[i - 1][2] \
            and tokens[i - 1][1] == "array":
        i, is_array = i - 1, True
    return tokens[:i], is_array


def _split_type_modifier(tokens):
    """(base_tokens, saw_modifier). A type modifier is not part of a routine's
    argument type: the oracle confirms `varchar(10)` is `varchar`,
    `numeric(10,2)` is `numeric` and `time(3) with time zone` is `timetz`, so
    the group is dropped wherever it appears - including mid-phrase."""
    out, saw, depth = [], False, 0
    for token in tokens:
        if token[0] == "punct" and token[1] == "(":
            depth += 1
            saw = True
            continue
        if token[0] == "punct" and token[1] == ")":
            depth = max(0, depth - 1)
            continue
        if depth:
            continue
        out.append(token)
    return out, saw


def _canonical_typname(name: str) -> str | None:
    """Canonical spelling for a pg_type.typname, or None when unknown here.

    PostgreSQL names an array type by prefixing the element typname with `_`,
    and the oracle confirms `_int4` resolves to `integer[]`, so that form is
    folded through the element rather than left as an unrelated identity a
    GRANT could not reach.
    """
    canonical = _TYPNAME_CANONICAL.get(name)
    if canonical is not None:
        return canonical
    if name.startswith("_"):
        element = _TYPNAME_CANONICAL.get(name[1:])
        if element is not None:
            return element + "[]"
    return None


def _canonical_type(tokens) -> "_TypeRef | None":
    """The canonical identity of one resolved type expression.

    Returns None when the spelling cannot be resolved SAFELY, which the caller
    turns into UNRESOLVED_ARGS - a state that earns no REVOKE credit and never
    silences a GRANT.
    """
    base, is_array = _split_array_suffix(tokens)
    base, saw_modifier = _split_type_modifier(base)
    if not base:
        return None
    suffix = "[]" if is_array else ""

    dots = [i for i, t in enumerate(base) if t[0] == "punct" and t[1] == "."]
    if dots:
        # Exactly `<schema> . <name>`; anything else is a shape this scanner
        # does not model.
        if len(dots) != 1 or dots[0] != 1 or len(base) != 3:
            return None
        schema, name = base[0], base[2]
        if schema[0] != "ident" or name[0] != "ident":
            return None
        if schema[1] == "pg_catalog":
            # Qualification bypasses the keyword grammar exactly as quoting
            # does, so `pg_catalog.char` is the internal type, not bpchar.
            canonical = _canonical_typname(name[1])
            if canonical is not None:
                return _TypeRef(canonical + suffix)
        return _custom_type_ref(base, suffix)

    if any(t[0] != "ident" for t in base):
        return None

    if len(base) == 1 and base[0][2]:
        # A single DELIMITED identifier: catalog lookup only, never a keyword.
        canonical = _canonical_typname(base[0][1])
        if canonical is not None:
            return _TypeRef(canonical + suffix)
        return _custom_type_ref(base, suffix)

    if all(not t[2] for t in base):
        phrase = " ".join(t[1] for t in base)
        # INTERVAL field qualifiers are a typmod, not a distinct type: the
        # oracle confirms `interval year to month` and `interval` are one.
        if base[0][1] == "interval":
            return _TypeRef("interval" + suffix)
        canonical = _TYPE_KEYWORD_CANONICAL.get(phrase)
        if canonical is not None:
            # `float(p)` is the ONE modifier PostgreSQL does not ignore: it
            # selects real for p <= 24 and double precision for p >= 25. Rather
            # than guess a precision, fail closed.
            if phrase == "float" and saw_modifier:
                return None
            return _TypeRef(canonical + suffix)
        if len(base) == 1:
            canonical = _canonical_typname(base[0][1])
            if canonical is not None:
                return _TypeRef(canonical + suffix)
            return _custom_type_ref(base, suffix)
        # A multi-word spelling that is not a known keyword phrase.
        return None

    # A mix of quoted and bare words cannot be a keyword phrase.
    return None


# The schemas an UNQUALIFIED type name may resolve through. Every migration
# here runs with `public` first and `pg_catalog` is always implicitly on the
# search path, so a bare `mood` may be `public.mood` and a bare `regclass` may
# be `pg_catalog.regclass`. Anything else is a schema PostgreSQL would have to
# be told about, so it stays a distinct identity.
_SEARCH_PATH_SCHEMAS = ("public", "pg_catalog")


def _custom_type_ref(tokens, suffix: str) -> "_TypeRef":
    """A type this scanner cannot resolve through the catalog - a user-defined
    one, or a quoted spelling with no built-in meaning.

    Its EXACT identity keeps quoting, so two distinct types never collapse and a
    REVOKE earns credit only for the spelling it provably names. Its CANDIDATE
    set also carries the quote-folded form, because whether quoting matters here
    depends on a catalog this scanner does not have - so a GRANT is never
    dismissed on an equivalence that was merely unproven.

    Round 13 (Fable, F7): the candidate set also carries the SEARCH-PATH
    equivalent spellings. `public.mood` and a bare `mood` are one PostgreSQL
    type, and so are `regclass` and `pg_catalog.regclass` - verified on
    PostgreSQL 17.11, where a GRANT written either way reached the same
    routine. Because the two spellings shared no candidate, an applicable
    GRANT was dropped from the replay while the scanner still reported the
    surface closed.

    Only the MAY-MATCH direction widens. `exact` is untouched, so a REVOKE
    still earns closure only for the spelling it provably names, and a type in
    some other schema (`archive.mood`) shares no candidate with a bare `mood`
    and does not collapse into it.
    """
    exact = _render_type_tokens(tokens, preserve_quoting=True) + suffix
    folded = _render_type_tokens(tokens, preserve_quoting=False) + suffix
    candidates = {exact, folded}
    dots = [i for i, tok in enumerate(tokens) if tok[0] == "punct" and tok[1] == "."]
    if len(dots) == 1 and dots[0] == 1 and len(tokens) == 3:
        if tokens[0][0] == "ident" and tokens[0][1] in _SEARCH_PATH_SCHEMAS:
            bare = (tokens[2],)
            candidates.add(_render_type_tokens(bare, preserve_quoting=True) + suffix)
            candidates.add(_render_type_tokens(bare, preserve_quoting=False) + suffix)
    elif not dots and len(tokens) == 1 and tokens[0][0] == "ident":
        for schema in _SEARCH_PATH_SCHEMAS:
            qualified = (("ident", schema, False), ("punct", ".", False), tokens[0])
            candidates.add(
                _render_type_tokens(qualified, preserve_quoting=True) + suffix
            )
            candidates.add(
                _render_type_tokens(qualified, preserve_quoting=False) + suffix
            )
    return _TypeRef(exact, candidates)


def _is_array_suffix_only(tokens) -> bool:
    """True when every remaining token belongs to the PRECEDING type's array
    bounds - PostgreSQL's `arrayBounds`, an optional ARRAY keyword followed by
    any number of `[ <optional integer> ]` - which means no parameter name was
    written at all. `uuid []` is one unnamed parameter, not `uuid` named `[]`.
    """
    if not tokens:
        return False
    for index, (kind, value, quoted) in enumerate(tokens):
        if kind == "punct" and value in "[]":
            continue
        if kind == "num":
            continue
        if index == 0 and kind == "ident" and not quoted and value == "array":
            continue
        return False
    return True


def _render_type_tokens(tokens, preserve_quoting: bool = False) -> str:
    """Canonical text for a resolved type expression.

    An identifier is written bare when its resolved name is exactly what the
    bare spelling would produce, and delimited otherwise - so `"uuid"` and
    `uuid` render alike (PostgreSQL resolves them to the same identifier) while
    `"UUID"` stays distinct. Whitespace only ever separates two word-like
    tokens, so spacing around `.`, `[` and `,` cannot change an identity.
    """
    out, separates = [], False
    for kind, value, quoted in tokens:
        word = kind in ("ident", "num")
        if out and word and separates:
            out.append(" ")
        if kind == "ident" and (
            (preserve_quoting and quoted)
            or not (_PLAIN_IDENT_RE.match(value) and _fold_unquoted(value) == value)
        ):
            out.append('"' + value.replace('"', '""') + '"')
        else:
            out.append(value)
        # A word after a word, and a word after a closing `)`, need a
        # separator (`time(3) with time zone`); nothing else does, so spacing
        # around `.`, `[` and `,` cannot change an identity.
        separates = word or (kind == "punct" and value == ")")
    return "".join(out)


def _opens_type_phrase(first, second) -> bool:
    """True when these two identifier tokens begin a multi-word built-in TYPE,
    so the first one is part of the type and not an optional parameter name.

    Both must be written BARE: PostgreSQL reaches a built-in type phrase through
    keywords, and a delimited `"char"` is the ordinary type of that name, never
    the first half of `char varying`.
    """
    if first[2] or second[2]:
        return False
    return second[1] in _TYPE_LEAD_CONTINUATIONS.get(first[1], ())


def _normalize_arg_type(param: str, raw_param: str | None = None) -> "_TypeRef | None":
    """The declared TYPE of one parameter, canonicalized for comparison.

    Returns a _TypeRef, which compares equal to its canonical TEXT, so this is
    still the textual canonicalizer it has always been - but the canonical form
    is now PostgreSQL's, not the spelling the migration happened to use.

    `param` is the MASKED parameter text and `raw_param` the same span unmasked
    (defaulting to `param` for callers that hold only one form). Accepts both
    the CREATE form (`p_org uuid`, `OUT v numeric`,
    `p_x jsonb DEFAULT '{}'::jsonb`) and the privilege-statement form (`uuid`),
    because PostgreSQL allows argument names in GRANT/REVOKE too. Returns None
    when the parameter cannot be resolved; callers must render that as
    UNRESOLVED_ARGS, never as an omitted list.
    """
    tokens = _tokenize_parameter(param, param if raw_param is None else raw_param)
    if not tokens:
        return None
    if (
        len(tokens) > 1
        and tokens[0][0] == "ident"
        and not tokens[0][2]
        and tokens[0][1] in _ARG_MODES
    ):
        tokens = tokens[1:]
    # An optional argument NAME is one identifier followed by the START of a
    # type name - another identifier. Anything else after it (`.` continuing a
    # qualified name, `(` opening a modifier, `[` opening array bounds) means
    # the first token was the type itself, not a name.
    #
    # Whether the first two tokens open a multi-word TYPE PHRASE is decided
    # FIRST, and on both of them: a lead word alone is not a type phrase
    # (`double text` is a parameter named `double`), and dropping a real type's
    # leading word is what collapsed `char varying` into `varying`.
    if (
        len(tokens) > 1
        and tokens[0][0] == "ident"
        and tokens[1][0] == "ident"
        and not _opens_type_phrase(tokens[0], tokens[1])
        and not _is_array_suffix_only(tokens[1:])
    ):
        tokens = tokens[1:]
    return _canonical_type(tokens)


def _split_top_level_commas(text: str) -> list[str]:
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(text):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    return parts


def _parse_arg_list(inner: str, raw_inner: str | None = None):
    """Normalized argument types. `inner` is masked (used for structure only);
    `raw_inner` is the same span unmasked and supplies each parameter's text."""
    if raw_inner is None:
        raw_inner = inner
    if not inner.strip():
        return ()
    args = []
    offset = 0
    for part in _split_top_level_commas(inner):
        raw_part = raw_inner[offset: offset + len(part)]
        offset += len(part) + 1
        if not part.strip():
            continue
        # STRUCTURE from the masked span - where a comment is already
        # non-semantic whitespace - and identifier CONTENT from raw at the same
        # offsets. Feeding raw comment bytes to the tokenizer made every
        # commented parameter unparseable.
        mode_tokens = _tokenize_parameter(part, raw_part)
        if mode_tokens is None:
            return UNRESOLVED_ARGS
        # OUT-only parameters are not part of PostgreSQL callable identity.
        # INOUT and VARIADIC remain input identity components.
        if (
            mode_tokens
            and mode_tokens[0][0] == "ident"
            and not mode_tokens[0][2]
            and mode_tokens[0][1] == "out"
        ):
            continue
        normalized = _normalize_arg_type(part, raw_part)
        if normalized is None:
            return UNRESOLVED_ARGS
        args.append(normalized)
    return tuple(args)


def _skip_ws(masked: str, i: int) -> int:
    """Step over PostgreSQL whitespace - not `str.isspace()`, which also steps
    over the 19 Unicode spaces PostgreSQL reads as identifier characters and so
    could split one identifier into two while resolving a routine's identity."""
    while i < len(masked) and masked[i] in _PLPGSQL_WS:
        i += 1
    return i


def _parse_identity(raw: str, masked: str, i: int):
    """Parse a possibly quoted, possibly schema-qualified name at `i`.

    Read from the UNMASKED text: the masker blanks quoted-identifier content by
    design, so `public."f_quoted"` carries no name in the masked source. Offsets
    are identical between the two, so the masked text still decides whitespace.
    """
    parts, quoted_any = [], False
    n = len(raw)
    while True:
        i = _skip_ws(masked, i)
        if i >= n:
            return None, i
        if raw[i] == '"' or _UAMP_PREFIX_RE.match(raw, i):
            # The SAME delimited-identifier reader the type and condition paths
            # use, rather than a second transcription of PostgreSQL's rules
            # that could drift from it - and it is what makes a `U&"..."`
            # routine or schema name resolve here too.
            delimited = _read_delimited_identifier(raw, i, masked)
            if delimited is None:
                return None, i
            parts.append(delimited[0])
            quoted_any = True
            i = delimited[1]
        else:
            m = _UNQUOTED_IDENT_RE.match(raw, i)
            if m is None:
                return None, i
            parts.append(_pg_identifier(m.group(0)))
            i = m.end()
        nxt = _skip_ws(masked, i)
        if nxt < n and raw[nxt] == ".":
            i = nxt + 1
            continue
        return (parts, quoted_any), nxt


def _balanced_parens(masked: str, i: int):
    """(inner_text, index_after_close) for the parenthesis group opening at i."""
    if i >= len(masked) or masked[i] != "(":
        return None, i
    depth = 0
    for j in range(i, len(masked)):
        if masked[j] == "(":
            depth += 1
        elif masked[j] == ")":
            depth -= 1
            if depth == 0:
                return masked[i + 1: j], j + 1
    return None, i


def _identity_at(raw: str, masked: str, i: int):
    """Identity plus the index just past its optional argument list."""
    parsed, after = _parse_identity(raw, masked, i)
    if parsed is None:
        return None, after
    parts, quoted = parsed
    after = _skip_ws(masked, after)
    args = None
    if after < len(masked) and masked[after] == "(":
        open_paren = after
        inner, after = _balanced_parens(masked, open_paren)
        if inner is None:
            return None, after
        # Structure is decided on MASKED text (so a comma inside a literal or a
        # comment cannot split a parameter), but each parameter's TEXT is taken
        # from RAW at the same offsets, because masking blanks quoted-identifier
        # content and a quoted type name is part of the identity.
        args = _parse_arg_list(inner, raw[open_paren + 1: after - 1])
    schema = parts[-2] if len(parts) > 1 else None
    return Identity(schema, parts[-1], quoted, args), after


def _scan_statement(masked: str, i: int):
    """(end_of_statement, dollar_body_span) starting at `i`.

    Walks the masked text honouring parentheses, single-quoted literals, quoted
    identifiers and dollar-quoted bodies, and stops at the first `;` outside all
    of them. The dollar-quoted body, when present, is reported separately so a
    definition can never borrow the next one's.
    """
    n, depth, j = len(masked), 0, i
    body = None
    while j < n:
        ch = masked[j]
        if ch == "'":
            k = masked.find("'", j + 1)
            j = n if k == -1 else k + 1
            continue
        if ch == '"':
            k = masked.find('"', j + 1)
            j = n if k == -1 else k + 1
            continue
        if ch == "$":
            tag = _dollar_tag_at(masked, j)
            if tag is not None:
                close = masked.find(tag, j + len(tag))
                if close == -1:
                    return n, body
                if body is None and _preceded_by_keyword(masked, j, "as"):
                    body = (j + len(tag), close)
                j = close + len(tag)
                continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif ch == ";" and depth == 0:
            return j + 1, body
        j += 1
    return n, body


_CREATE_ROUTINE_RE = re.compile(
    _KW_LEFT + f"CREATE{_WS1}(?P<or_replace>OR{_WS1}REPLACE{_WS1})?"
    f"(?:FUNCTION|PROCEDURE){_WS1}",
    re.IGNORECASE,
)
_ALTER_ROUTINE_RE = re.compile(
    _KW_LEFT + f"ALTER{_WS1}(?:FUNCTION|PROCEDURE|ROUTINE){_WS1}",
    re.IGNORECASE,
)
_SECURITY_DEFINER_RE = re.compile(_pg_kw(f"SECURITY{_WS1}DEFINER"), re.IGNORECASE)
# `REVOKE GRANT OPTION FOR EXECUTE ... FROM authenticated` withdraws only the
# right to RE-GRANT execute. The role keeps EXECUTE itself and can still call the
# function. The optional clause was already matched here - so the statement
# parsed and its privilege list read `EXECUTE` - but it collapsed into a plain
# revoke, and the ACL replay then closed the executable surface on the strength
# of a statement that closes nothing. It is captured as its own group so
# revoke_closes_client_surface() can leave EXECUTE state alone.
#
# The privilege list itself is read over MASKED text with PostgreSQL's own
# whitespace set, not a literal ASCII space. `[A-Za-z, ]` accepted
# `GRANT ALL PRIVILEGES` but not `GRANT ALL\nPRIVILEGES`, which PostgreSQL
# accepts and which grants EXECUTE: the statement matched no head at all, so it
# vanished from the ACL replay and a reopened function still looked closed. The
# class stays tightly bounded - it admits letters, commas and whitespace and
# nothing else, so it cannot reach past a `;` into another statement, and
# comments are already whitespace in the masked text it runs on.
_REVOKE_HEAD_RE = re.compile(
    _KW_LEFT + r"REVOKE[" + _PG_WS + r"]+"
    r"(?P<grant_option>GRANT[" + _PG_WS + r"]+OPTION[" + _PG_WS + r"]+FOR["
    + _PG_WS + r"]+)?"
    r"(?P<privs>[A-Za-z," + _PG_WS + r"]*?)[" + _PG_WS + r"]*" + _KW_LEFT
    + r"ON[" + _PG_WS + r"]+",
    re.IGNORECASE,
)
# `GRANT OPTION FOR` never begins a GRANT statement - it is the clause above,
# inside a REVOKE. Without the lookahead the same bytes were ALSO parsed as
# `GRANT OPTION FOR EXECUTE ON FUNCTION f(...)`, a statement that does not
# exist. It opened nothing in practice, because a REVOKE has no `TO` and the
# phantom's grantee list came out empty, but it put a statement in the ledger
# that the file never contained.
_GRANT_HEAD_RE = re.compile(
    _KW_LEFT + r"GRANT[" + _PG_WS + r"]+(?!OPTION[" + _PG_WS + r"]+FOR"
    + _KW_RIGHT + r")"
    r"(?P<privs>[A-Za-z," + _PG_WS + r"]*?)[" + _PG_WS + r"]*" + _KW_LEFT
    + r"ON[" + _PG_WS + r"]+",
    re.IGNORECASE,
)
# Round 20, Category A - the one keyword matcher in this file that keeps
# Python's `\b`, because its INPUT cannot contain an identifier-continuation
# character. It is only ever run over the `privs` capture group of the two
# heads above, whose class is `[A-Za-z,` + PostgreSQL whitespace and nothing
# else: no `$`, no digit, no non-ASCII code point can reach it, so `\b` and
# the PostgreSQL boundary agree on every string it can see.
_EXECUTE_PRIV_RE = re.compile(_pg_kw("EXECUTE|ALL"), re.IGNORECASE)
_ON_ROUTINE_RE = re.compile(
    f"\\A(?:FUNCTION|PROCEDURE|ROUTINE){_WS1}", re.IGNORECASE
)
_ON_ALL_ROUTINES_RE = re.compile(
    f"\\AALL{_WS1}(?:FUNCTIONS|PROCEDURES|ROUTINES){_WS1}IN{_WS1}SCHEMA"
    + _KW_RIGHT,
    re.IGNORECASE,
)


class Definition:
    __slots__ = ("identity", "start", "end", "body_span", "is_definer", "final_definer",
                 "promoted_by", "or_replace")

    def __init__(self, identity, start, end, body_span, is_definer,
                 or_replace: bool = False):
        self.identity = identity
        self.start = start
        self.end = end
        self.body_span = body_span
        # True for `CREATE OR REPLACE`. PostgreSQL PRESERVES the replaced
        # routine's owner and permissions, so the ACL this migration ends with
        # may include a grant made BEFORE this statement. A plain CREATE
        # cannot: the routine did not exist, so there was no ACL to preserve.
        self.or_replace = or_replace
        # The mode this statement DECLARES.
        self.is_definer = is_definer
        # The mode the function ends the migration in, after every later ALTER
        # in this file has been applied. resolve_security_state() sets it.
        self.final_definer = is_definer
        self.promoted_by = None


def parse_definitions(raw: str, masked: str) -> list[Definition]:
    """Every CREATE [OR REPLACE] FUNCTION/PROCEDURE statement in the file."""
    out = []
    for m in _CREATE_ROUTINE_RE.finditer(masked):
        identity, after = _identity_at(raw, masked, m.end())
        if identity is None:
            continue
        end, body_span = _scan_statement(masked, after)
        header = masked[m.start(): body_span[0]] if body_span else masked[m.start(): end]
        trailer = masked[body_span[1]: end] if body_span else ""
        definer = bool(
            _SECURITY_DEFINER_RE.search(header) or _SECURITY_DEFINER_RE.search(trailer)
        )
        out.append(
            Definition(
                identity, m.start(), end, body_span, definer,
                or_replace=bool(m.group("or_replace")),
            )
        )
    return out


_SECURITY_INVOKER_RE = re.compile(_pg_kw(f"SECURITY{_WS1}INVOKER"), re.IGNORECASE)


class AlterSecurity:
    __slots__ = ("identity", "start", "end", "sets_definer")

    def __init__(self, identity, start, end, sets_definer):
        self.identity = identity
        self.start = start
        self.end = end
        self.sets_definer = sets_definer


def parse_alter_security(raw: str, masked: str) -> list[AlterSecurity]:
    """Every `ALTER FUNCTION/PROCEDURE ... SECURITY {DEFINER|INVOKER}` statement.

    Both directions are collected, because the security mode of a function is a
    STATE, not a property of the statement that created it: PostgreSQL lets a
    later ALTER change it without restating a line of the body. Reading only the
    DEFINER direction gets the state wrong in both directions - it misses a
    promotion and it keeps flagging a demotion.
    """
    # Round 13 (Fable, F2): this swept the WHOLE masked file, so text that
    # PostgreSQL never executes at CREATE time moved the model's security
    # state. Creating a routine does not run its body, and a DO body is
    # procedural code whose branches this scanner does not evaluate, so
    #
    #   CREATE FUNCTION public.maintenance_later() ... AS $m$
    #   BEGIN ALTER FUNCTION public.victim(uuid) SECURITY INVOKER; END $m$;
    #
    # and the same statement under `IF false THEN` inside a DO both demoted
    # the victim to INVOKER here while the live catalog kept prosecdef = true
    # (verified on PostgreSQL 17.11). The scanner then stopped reviewing an
    # unguarded SECURITY DEFINER function.
    #
    # Ownership is the SAME structural concept the privilege replay already
    # uses - routine_body_spans() plus do_body_spans() - not a new lexer and
    # not a blacklist of the word ALTER. A DO that MAY demote earns no proven
    # demotion either: an unproven effect must never be replayed as a fact.
    bodies = routine_body_spans(masked) + do_body_spans(masked, raw)
    out = []
    for m in _ALTER_ROUTINE_RE.finditer(masked):
        if any(start <= m.start() < stop for start, stop in bodies):
            continue
        identity, after = _identity_at(raw, masked, m.end())
        if identity is None:
            continue
        end, _ = _scan_statement(masked, after)
        clause = masked[after:end]
        if _SECURITY_DEFINER_RE.search(clause):
            out.append(AlterSecurity(identity, m.start(), end, True))
        elif _SECURITY_INVOKER_RE.search(clause):
            out.append(AlterSecurity(identity, m.start(), end, False))
    return out


# ---------------------------------------------------------------------------
# Round 13 (F6): routine IDENTITY mutation
# ---------------------------------------------------------------------------
# Scanner v1 models a routine's SECURITY mode as state, but modelled its
# IDENTITY as fixed. PostgreSQL does not: `ALTER FUNCTION ... RENAME TO` and
# `ALTER FUNCTION ... SET SCHEMA` move the SAME routine - same oid, same
# prosecdef, same body - to a new name, and a GRANT on the new identity
# reaches it. Verified on PostgreSQL 17.11: a fully revoked SECURITY DEFINER
# function, renamed and then granted under its new name, is executable by
# `authenticated` again.
#
# A full identity-state machine is not what this round buys. Nothing here
# rewrites identities; a mutation that touches anything the verdict rests on
# simply stops the scanner from claiming proof, which is the conservative half
# of the same asymmetry the ACL replay already uses. Renaming some other
# routine INTO a recognized helper name is the mirror case: the guard this
# file reads would not be the guard the database runs, exactly what
# redefined_guard_names() already refuses for a CREATE.
_ALTER_RENAME_RE = re.compile(
    f"\\ARENAME{_WS1}TO{_WS1}", re.IGNORECASE
)
_ALTER_SET_SCHEMA_RE = re.compile(
    f"\\ASET{_WS1}SCHEMA{_WS1}", re.IGNORECASE
)


class AlterIdentity:
    __slots__ = ("identity", "start", "end", "kind", "new_name")

    def __init__(self, identity, start, end, kind, new_name):
        self.identity = identity
        self.start = start
        self.end = end
        # "RENAME" or "SET SCHEMA".
        self.kind = kind
        # The new ROUTINE name for a RENAME; None for SET SCHEMA (which moves
        # the routine without renaming it) and when the operand is unreadable.
        self.new_name = new_name


def parse_alter_identity(raw: str, masked: str) -> list[AlterIdentity]:
    """Top-level `ALTER ROUTINE ... RENAME TO` / `... SET SCHEMA` statements.

    Body ownership is the same as parse_alter_security(): the text must be a
    statement the migration executes, not prose inside a routine or DO body.
    """
    bodies = routine_body_spans(masked) + do_body_spans(masked, raw)
    out = []
    for m in _ALTER_ROUTINE_RE.finditer(masked):
        if any(start <= m.start() < stop for start, stop in bodies):
            continue
        identity, after = _identity_at(raw, masked, m.end())
        if identity is None:
            continue
        end, _ = _scan_statement(masked, after)
        offset = _skip_ws(masked, after)
        tail = masked[offset:end]
        rename = _ALTER_RENAME_RE.match(tail)
        if rename:
            # `RENAME TO` takes a bare routine name, resolved by the SAME
            # identifier reader as every other name in this module so a quoted
            # or `U&"..."` spelling cannot slip past the comparison below.
            parsed, _ = _parse_identity(raw, masked, offset + rename.end())
            new_name = parsed[0][-1] if parsed else None
            out.append(
                AlterIdentity(identity, m.start(), end, "RENAME", new_name)
            )
            continue
        if _ALTER_SET_SCHEMA_RE.match(tail):
            out.append(
                AlterIdentity(identity, m.start(), end, "SET SCHEMA", None)
            )
    return out


def parse_alter_security_definer(raw: str, masked: str) -> list[AlterSecurity]:
    """Only the statements that make a function SECURITY DEFINER."""
    return [a for a in parse_alter_security(raw, masked) if a.sets_definer]


def resolve_security_state(definitions, alters):
    """Apply every ALTER to the definitions it names, in file order.

    Returns the ALTERs that matched no definition in this file - those promote a
    function defined elsewhere, so this migration restates no body for them and
    they have to be judged on their own.

    A definition's FINAL mode is what matters. Judging the declared mode alone
    was wrong twice over: a function created SECURITY INVOKER and promoted by a
    later ALTER in the same file was never guard-checked at all (the CREATE was
    skipped as unprivileged and the ALTER was skipped as "already covered by its
    CREATE"), and a function created SECURITY DEFINER and demoted in the same
    file was still reported.
    """
    external = []
    for alter in sorted(alters, key=lambda a: a.start):
        matched = [
            d for d in definitions
            if d.start < alter.start and alter.identity.same_function(d.identity)
        ]
        if not matched:
            if alter.sets_definer:
                external.append(alter)
            continue
        for definition in matched:
            definition.final_definer = alter.sets_definer
            definition.promoted_by = alter if alter.sets_definer else None
    return external


# The client roles a SECURITY DEFINER function must not be reachable from when
# it carries no guard. PUBLIC is implicit: PostgreSQL grants EXECUTE to PUBLIC
# on every new function, and anon/authenticated inherit it from there.
CLIENT_ROLES = ("public", "anon", "authenticated")

# Grantees are read from the RAW source. The masker blanks quoted-identifier
# content, so `GRANT ... TO "authenticated"` had no grantee at all in the masked
# text: the re-open was invisible and the closure still looked intact. A quoted
# role name is the SAME role when its content matches - PostgreSQL folds the
# unquoted form to lower case - so both spellings resolve here, and a quoted
# form that differs in case (`"Authenticated"`) is a different role and does not.
_GRANTEE_NOISE = frozenset({"group", "current_user", "session_user", "current_role"})
# A grantee this scanner could not resolve. A REVOKE naming it credits no
# closure (it is not a client role), and a GRANT naming it must be replayed as
# reaching EVERY client role - PostgreSQL may well resolve it to one of them.
UNRESOLVED_GRANTEE = "\x00unresolved-grantee"


def _grantee_names(raw_region: str) -> set[str]:
    """Role names named in a GRANT/REVOKE grantee list.

    Structure comes from the masked region, so a comment cannot invent a
    grantee, and each identifier is resolved by the SHARED delimited-identifier
    reader - the same one routine names, schema names and parameter types use.
    A second, private quote regex lived here until it was found to miss exactly
    what that reader exists to resolve: `U&"authenticate\0064"` is the role
    `authenticated` to PostgreSQL, so a GRANT spelled that way reopens a closed
    function, while the old reader recorded the bare token `u` plus a role
    literally named `authenticate\0064` and saw no reopen at all.
    """
    masked_region, problems = mask_sql_checked(raw_region)
    if problems:
        raise MaskError("; ".join(problems))
    names, i, n = set(), 0, len(masked_region)
    while i < n:
        if masked_region[i] == '"' or _UAMP_PREFIX_RE.match(masked_region, i):
            read = _read_delimited_identifier(raw_region, i, masked_region)
            if read is not None:
                names.add(read[0])
                i = read[1]
                continue
            # Unresolvable delimited grantee: fail closed and skip its span so
            # the `U&` prefix cannot be re-read as a bare role named `u`.
            names.add(UNRESOLVED_GRANTEE)
            quote = masked_region.find('"', i)
            close = masked_region.find('"', quote + 1) if quote != -1 else -1
            i = (close + 1) if close != -1 else n
            continue
        bare = _UNQUOTED_IDENT_RE.match(masked_region, i)
        if bare is None:
            i += 1
            continue
        resolved = _pg_identifier(raw_region[bare.start():bare.end()])
        if resolved not in _GRANTEE_NOISE:
            names.add(resolved)
        i = bare.end()
    return names


class PrivilegeStatement:
    __slots__ = ("start", "end", "is_revoke", "targets", "all_in_schema", "grantees",
                 "grant_option_only")

    def __init__(self, start, end, is_revoke, targets, all_in_schema, grantees,
                 grant_option_only=False):
        self.start = start
        self.end = end
        self.is_revoke = is_revoke
        self.targets = targets
        self.all_in_schema = all_in_schema
        self.grantees = grantees
        # `REVOKE GRANT OPTION FOR ...`: withdraws delegation, not the privilege.
        self.grant_option_only = grant_option_only


def _dollar_spans(masked: str, start: int, end: int) -> list[tuple[int, int]]:
    """Every dollar-quoted CONTENT span between `start` and `end`.

    Walks the same way _scan_statement() does - honouring single quotes and
    quoted identifiers - but reports ALL of them rather than only the first, so
    a CREATE FUNCTION carrying more than one dollar-quoted literal cannot leave
    one of them outside the exclusion below.
    """
    spans, j = [], start
    while j < end:
        ch = masked[j]
        if ch == "'":
            k = masked.find("'", j + 1)
            j = end if k == -1 else k + 1
            continue
        if ch == '"':
            k = masked.find('"', j + 1)
            j = end if k == -1 else k + 1
            continue
        if ch == "$":
            tag = _dollar_tag_at(masked, j)
            if tag is not None:
                close = masked.find(tag, j + len(tag))
                if close == -1:
                    return spans
                spans.append((j + len(tag), close))
                j = close + len(tag)
                continue
        j += 1
    return spans


def routine_body_spans(masked: str) -> list[tuple[int, int]]:
    """The dollar-quoted spans owned by a CREATE FUNCTION/PROCEDURE statement.

    Round 10 (Codex). A routine BODY is deliberately left executable in the
    masked text - that is where has_recognized_guard() looks - so privilege
    text written inside one was indistinguishable from a real statement to a
    regex sweeping the whole file. Creating a routine does NOT execute its
    body, so a `REVOKE EXECUTE ON FUNCTION victim() FROM PUBLIC` sitting in
    another routine's body closed nothing in PostgreSQL while closing the
    scanner's replayed ACL completely, and an unguarded SECURITY DEFINER
    function passed.

    The exclusion is STRUCTURAL - statement ownership, not a blacklist of the
    word REVOKE - so it holds for a body of any language, any dollar tag, any
    nesting, either security mode, and a routine created before or after the
    function under review. Offsets are untouched: spans are reported, never
    stripped, so every other consumer still sees the same text at the same
    place.

    Only CREATE routine statements are excluded here. A `DO $$ ... $$;` block
    DOES execute at migration time, but Round 11 does not replay privilege
    text from inside one either: a DO is a procedural runtime whose final ACL
    effect cannot be proven statically. Those blocks are owned separately by
    parse_do_blocks() and may emit PROCEDURAL_ACL_UNKNOWN rather than forged
    GRANT/REVOKE events.
    """
    spans = []
    for m in _CREATE_ROUTINE_RE.finditer(masked):
        end, _ = _scan_statement(masked, m.end())
        spans.extend(_dollar_spans(masked, m.end(), end))
    return spans


# ---------------------------------------------------------------------------
# Round 11: procedural ACL uncertainty
# ---------------------------------------------------------------------------
# Three concepts stay separate:
#   1. a migration TOP-LEVEL privilege statement, which ACL replay may apply;
#   2. a routine BODY, which is not executed at CREATE time;
#   3. a DO block, which IS executed at migration time, but whose internal
#      GRANT/REVOKE/EXECUTE effect cannot be proven without a PL/pgSQL
#      interpreter (IF, LOOP, EXCEPTION, format(), concatenation, variables).
#
# The scanner does not become that interpreter. A DO that might change routine
# EXECUTE is a PROCEDURAL_ACL_UNKNOWN event. UNKNOWN is not closure. A later
# provably exact top-level privilege statement can restore proof.
_DO_KW_RE = re.compile(_pg_kw("DO"), re.IGNORECASE)
_LANGUAGE_KW_RE = re.compile(_pg_kw("LANGUAGE"), re.IGNORECASE)
_ON_WORD_RE = re.compile(_pg_kw("ON"), re.IGNORECASE)
_EXECUTE_WORD_RE = re.compile(_pg_kw("EXECUTE"), re.IGNORECASE)
_PROCEDURAL_CALL_RE = re.compile(
    _pg_kw("PERFORM|CALL") + r"[^;]*\(", re.IGNORECASE | re.DOTALL
)
# Round 13 (Fable, F4): keying migration-time execution to three keyword
# spellings was too narrow. PostgreSQL 17.11 runs a same-file function - and
# with it any `GRANT EXECUTE` its body performs - from every statement class
# below; each was verified to move `authenticated` from false to true on a
# fully revoked victim. The keyword only LOCATES a candidate region; whether
# the region is flagged is decided by _region_calls_defined_routine(), so
# `ON UPDATE CASCADE` and a `DELETE` that calls nothing are not affected.
_TOP_LEVEL_RUNTIME_KW_RE = re.compile(
    _pg_kw("CALL|SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|VALUES"),
    re.IGNORECASE,
)

# Migration-time statements inside a DO body that may change who can execute a
# routine. Round 13 (Fable, F10): do_is_acl_uncertain() recognized only
# GRANT/REVOKE of routine EXECUTE, so a DO that granted ROLE MEMBERSHIP
# (`GRANT stock_ops TO authenticated WITH INHERIT TRUE`) or set
# `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO authenticated`
# was read as harmless - while on PostgreSQL 17.11 both made the victim
# executable by `authenticated`. The top-level parsers already model these two
# classes; the DO path simply has to notice them. Branch reachability is
# deliberately NOT evaluated: presence alone makes the DO unknown.
#
# The match runs on MASKED body text, so the keyword must be executable: a
# GRANT named in a comment or a string literal inside the DO is already blank.
# Both boundaries on every keyword. `\bGRANT` alone also matched the COLUMN
# names `grantee` and `grantor`, which every read-only `aclexplode()` /
# `information_schema.role_table_grants` postflight block uses - so migrations
# 171 and 191, whose DO blocks only VERIFY the ACL they were given, were
# reported as changing it.
_DO_ACL_KEYWORD_RE = re.compile(
    _pg_kw(
        r"GRANT|REVOKE"
        r"|ALTER[" + _PG_WS + r"]+DEFAULT[" + _PG_WS + r"]+PRIVILEGES"
        r"|ALTER[" + _PG_WS + r"]+(?:ROLE|GROUP|USER)"
    ),
    re.IGNORECASE,
)

ACL_OPEN = "open"
ACL_CLOSED = "closed"
ACL_UNKNOWN = "unknown"


class DoBlock:
    __slots__ = ("start", "end", "body_span", "readable")

    def __init__(self, start, end, body_span, readable):
        self.start = start
        self.end = end
        # Dollar-quoted CONTENT span, or None when the body could not be owned.
        self.body_span = body_span
        # False when the body is not dollar-quoted: mask_sql_checked() blanks
        # single-quoted content, so the scanner cannot prove the DO is harmless.
        self.readable = readable


# A string constant's optional PREFIX. PostgreSQL accepts `E'...'` (escape
# string) and `U&'...'` (Unicode string) wherever a plain `'...'` is accepted,
# including as the code body of a DO statement - verified on PostgreSQL 17.11,
# where `DO E'BEGIN EXECUTE \'GRANT ...\'; END'` and the U& spelling both ran
# and reopened `authenticated` EXECUTE on a fully revoked function.
#
# Round 13 (Fable, F3): this reader knew only `$tag$` and a bare `'`, so
# parse_do_blocks() did not recognize those statements as DO statements at
# all. They did not become PROCEDURAL_ACL_UNKNOWN - they vanished, and the
# revoke before them still read as proven closure. Recognizing the prefix here
# rather than at the call site keeps ONE literal reader, which is what the
# SQLSTATE and identifier paths already share.
_STRING_PREFIX_RE = re.compile(r"(?:U&|E)(?=')", re.IGNORECASE)


def _read_string_literal_at(masked: str, i: int):
    """(content_start, content_end, after, is_dollar) for a literal at `i`.

    A `$tag$` literal is reported as readable (is_dollar True); a
    single-quoted one is not, because mask_sql_checked() blanks its content, so
    the caller cannot prove what it contains. An `E''`/`U&''` prefix is owned
    the same way a bare `''` is: the span is found, and the body is flagged
    unreadable rather than silently dropped.
    """
    n = len(masked)
    if i >= n:
        return None
    if masked[i] == "$":
        tag = _dollar_tag_at(masked, i)
        if tag is None:
            return None
        close = masked.find(tag, i + len(tag))
        if close == -1:
            return None
        return (i + len(tag), close, close + len(tag), True)
    prefix = _STRING_PREFIX_RE.match(masked, i)
    if prefix:
        i = prefix.end()
    if masked[i:i + 1] == "'":
        close = masked.find("'", i + 1)
        if close == -1:
            return None
        return (i + 1, close, close + 1, False)
    return None


def parse_do_blocks(masked: str, raw: str | None = None) -> list[DoBlock]:
    """Top-level DO statements, owned by structural dollar/string spans.

    Offsets are not stripped. CREATE FUNCTION/PROCEDURE bodies are skipped so a
    routine that happens to mention `DO` or `EXECUTE` is not a migration-time
    DO. Nested matches inside an already-owned DO body are skipped the same way.
    """
    if raw is None:
        raw = masked
    routine = routine_body_spans(masked)
    out: list[DoBlock] = []
    n = len(masked)
    for m in _DO_KW_RE.finditer(masked):
        if m.start() > 0 and masked[m.start() - 1] == "$":
            continue
        if any(start <= m.start() < stop for start, stop in routine):
            continue
        if any(
            d.body_span is not None and d.body_span[0] <= m.start() < d.body_span[1]
            for d in out
        ):
            continue
        i = _skip_ws(masked, m.end())
        lang = _LANGUAGE_KW_RE.match(masked, i)
        if lang:
            i = _skip_ws(masked, lang.end())
            if i < n and (
                masked[i] == '"' or _UAMP_PREFIX_RE.match(masked, i)
            ):
                delimited = _read_delimited_identifier(raw, i, masked)
                i = n if delimited is None else delimited[1]
            elif i < n and masked[i] == "'":
                lit = _read_string_literal_at(masked, i)
                i = n if lit is None else lit[2]
            else:
                ident = _UNQUOTED_IDENT_RE.match(masked, i)
                if ident:
                    i = ident.end()
            i = _skip_ws(masked, i)
        lit = _read_string_literal_at(masked, i)
        if lit is None:
            # Not a DO statement. `ON CONFLICT ... DO NOTHING` / `DO UPDATE`
            # use the same keyword and must not become ACL-unknown events.
            continue
        body_start, body_end, after, is_dollar = lit
        end, _ = _scan_statement(masked, after)
        out.append(DoBlock(m.start(), end, (body_start, body_end), is_dollar))
    return out


def do_body_spans(
    masked: str, raw: str | None = None
) -> list[tuple[int, int]]:
    """Spans whose GRANT/REVOKE text must not be replayed as top-level ACL."""
    spans = []
    for block in parse_do_blocks(masked, raw):
        if block.body_span is not None:
            spans.append(block.body_span)
        else:
            spans.append((block.start, block.end))
    return spans


def _has_procedural_execute(masked_body: str) -> bool:
    """True when the body contains PL/pgSQL EXECUTE, not GRANT/REVOKE EXECUTE.

    `GRANT EXECUTE ON FUNCTION` and `REVOKE EXECUTE ON FUNCTION` use EXECUTE as
    a privilege name; the next token is ON. PL/pgSQL EXECUTE is followed by an
    expression (`'...'`, format(), a variable, concatenation). Reachability is
    deliberately not evaluated: any such statement can run arbitrary SQL.
    """
    for m in _EXECUTE_WORD_RE.finditer(masked_body):
        nxt = _skip_ws(masked_body, m.end())
        if nxt < len(masked_body) and _ON_WORD_RE.match(masked_body, nxt):
            continue
        return True
    return False


def _body_has_routine_privilege_text(
    raw: str, masked: str, start: int, end: int
) -> bool:
    """Static GRANT/REVOKE of routine EXECUTE inside a span, not replayed."""
    del raw
    region = masked[start:end]
    for head_re in (_REVOKE_HEAD_RE, _GRANT_HEAD_RE):
        for m in head_re.finditer(region):
            if not _EXECUTE_PRIV_RE.search(m.group("privs") or ""):
                continue
            rest = masked[start + m.end(): end]
            if _ON_ALL_ROUTINES_RE.match(rest) or _ON_ROUTINE_RE.match(rest):
                return True
    return False


def do_is_acl_uncertain(
    block: DoBlock, raw: str, masked: str, strict: bool = False,
    definitions=None,
) -> bool:
    """True when this DO's effect on routine EXECUTE cannot be proven."""
    if not block.readable or block.body_span is None:
        return True
    start, end = block.body_span
    if _has_procedural_execute(masked[start:end]):
        return True
    if strict and _PROCEDURAL_CALL_RE.search(masked[start:end]):
        return True
    # Round 13 (F4): a same-file routine can be executed from a DO body
    # without PERFORM or CALL - an assignment (`ok := public.reopen();`) and an
    # IF condition both run it, and both were verified to reopen client
    # EXECUTE on PostgreSQL 17.11. The call detector is the shared,
    # identifier-aware one, so the U& spelling is covered here too.
    if strict and definitions and _region_calls_defined_routine(
        raw[start:end], masked[start:end], definitions
    ):
        return True
    # Round 13 (F10): role membership and default privileges change effective
    # routine execution rights just as a direct GRANT does.
    if _DO_ACL_KEYWORD_RE.search(masked[start:end]):
        return True
    return _body_has_routine_privilege_text(raw, masked, start, end)


def _called_routine_names(raw_region: str, masked_region: str) -> set[str]:
    """Every routine NAME that appears in a call shape `<identifier> (` here.

    Round 13 (Codex, F4): the previous detector matched each definition's name
    with a regex over masked text plus a second regex for the RENDERED
    `"name"` spelling. PostgreSQL has a third spelling - the Unicode delimited
    identifier - so

        SELECT public.U&"reo\\0070en"();

    resolved to the same-file helper `reopen()` in the catalog (verified on
    PostgreSQL 17.11) while matching neither pattern, and the helper's runtime
    `GRANT EXECUTE ... TO authenticated` stayed invisible.
    Names are therefore resolved by the SHARED identifier machinery -
    _read_delimited_identifier() for `"..."` / `U&"..."` (with its UESCAPE
    handling) and _pg_identifier() for the unquoted form - rather than by a
    second ad-hoc decoder, which is the shape that left the gap.

    STRUCTURE comes from the masked region, so a name inside a comment, a
    string literal or a dollar-quoted literal is not a call. Only a name
    directly followed by `(` counts, so a mere mention is not a call either.
    """
    if len(masked_region) != len(raw_region):
        return set()
    names: set[str] = set()
    i, n = 0, len(masked_region)
    while i < n:
        ch = masked_region[i]
        if ch == "'":
            close = masked_region.find("'", i + 1)
            i = n if close == -1 else close + 1
            continue
        if ch == "$":
            tag = _dollar_tag_at(masked_region, i)
            if tag is not None:
                close = masked_region.find(tag, i + len(tag))
                i = n if close == -1 else close + len(tag)
                continue
            i += 1
            continue
        if ch == '"' or _UAMP_PREFIX_RE.match(masked_region, i):
            read = _read_delimited_identifier(raw_region, i, masked_region)
            if read is None:
                # An identifier this scanner cannot resolve may BE the helper.
                # Reported as a call so the caller fails closed.
                names.add(UNRESOLVED_GRANTEE)
                i += 1
                continue
            name, after = read
            nxt = _skip_ws(masked_region, after)
            if masked_region[nxt:nxt + 1] == "(":
                names.add(name)
            i = max(after, i + 1)
            continue
        m = _UNQUOTED_IDENT_RE.match(masked_region, i)
        if m is not None:
            nxt = _skip_ws(masked_region, m.end())
            if masked_region[nxt:nxt + 1] == "(":
                names.add(_pg_identifier(m.group(0)))
            i = m.end()
            continue
        i += 1
    return names


def _region_calls_defined_routine(
    raw_region: str, masked_region: str, definitions
) -> bool:
    """Conservative same-file call detector for a migration-time region."""
    called = _called_routine_names(raw_region, masked_region)
    if UNRESOLVED_GRANTEE in called:
        return True
    return any(d.identity.name in called for d in definitions)


def _top_level_runtime_call_unknowns(
    raw: str, masked: str, definitions, do_blocks
) -> list[int]:
    """Migration-time CALLs and same-file SELECT/WITH calls are ACL UNKNOWN."""
    excluded = [(d.start, d.end) for d in definitions]
    excluded.extend((b.start, b.end) for b in do_blocks)
    out = []
    for match in _TOP_LEVEL_RUNTIME_KW_RE.finditer(masked):
        if any(start <= match.start() < stop for start, stop in excluded):
            continue
        end, _ = _scan_statement(masked, match.end())
        keyword = match.group(0).lower()
        if keyword == "call" or _region_calls_defined_routine(
            raw[match.start():end], masked[match.start():end], definitions
        ):
            out.append(match.start())
    return out


def parse_procedural_security_unknown(raw: str, masked: str) -> list[int]:
    """DO blocks whose body may change a routine's SECURITY mode.

    Round 13 (F2). parse_alter_security() now refuses to read a DO body as a
    security-state change, which is correct - the effect is not provable - but
    "not provable" must not silently become "did not happen" either. A DO that
    may promote some routine to SECURITY DEFINER, or demote the very function
    under review, is reported so the migration fails closed instead.
    """
    out = []
    for block in parse_do_blocks(masked, raw):
        if block.body_span is None:
            continue
        start, end = block.body_span
        if not block.readable:
            # An unreadable body is already PROCEDURAL_ACL_UNKNOWN; its
            # security effect cannot be read either, and reporting it twice
            # would only duplicate the finding.
            continue
        for m in _ALTER_ROUTINE_RE.finditer(masked, start, end):
            clause_end, _ = _scan_statement(masked, m.end())
            clause = masked[m.end():min(clause_end, end)]
            if _SECURITY_DEFINER_RE.search(clause) or _SECURITY_INVOKER_RE.search(
                clause
            ):
                out.append(block.start)
                break
    return sorted(set(out))


def parse_procedural_acl_unknown(
    raw: str, masked: str, definitions=None, strict: bool = False
) -> list[int]:
    """File offsets of migration-time effects Scanner v1 cannot prove."""
    if definitions is None:
        definitions = parse_definitions(raw, masked)
    blocks = parse_do_blocks(masked, raw)
    out = [
        block.start
        for block in blocks
        if do_is_acl_uncertain(
            block, raw, masked, strict=strict, definitions=definitions
        )
    ]
    if strict:
        out.extend(_top_level_runtime_call_unknowns(raw, masked, definitions, blocks))
    return sorted(set(out))


def parse_privilege_statements(raw: str, masked: str) -> list[PrivilegeStatement]:
    """REVOKE/GRANT statements that carry EXECUTE (or ALL) on routines."""
    out = []
    # ACL replay may consume only statements the migration actually EXECUTES at
    # SQL top level. Text inside a routine body never moves migration-time ACL
    # state, in either direction: it neither credits a closure nor reopens one.
    # Text inside a DO body is also not replayed: Round 11 treats that DO as
    # PROCEDURAL_ACL_UNKNOWN instead of pretending each lexical GRANT/REVOKE ran.
    bodies = routine_body_spans(masked) + do_body_spans(masked, raw)
    for head_re, is_revoke in ((_REVOKE_HEAD_RE, True), (_GRANT_HEAD_RE, False)):
        for m in head_re.finditer(masked):
            if not _EXECUTE_PRIV_RE.search(m.group("privs") or ""):
                continue
            if any(start <= m.start() < stop for start, stop in bodies):
                continue
            end, _ = _scan_statement(masked, m.end())
            rest = masked[m.end(): end]
            all_in_schema = bool(_ON_ALL_ROUTINES_RE.match(rest))
            targets = []
            if not all_in_schema:
                on_routine = _ON_ROUTINE_RE.match(rest)
                if on_routine is None:
                    continue
                pos = m.end() + on_routine.end()
                while True:
                    identity, after = _identity_at(raw, masked, pos)
                    if identity is None:
                        break
                    targets.append(identity)
                    nxt = _skip_ws(masked, after)
                    if nxt < end and masked[nxt] == ",":
                        pos = nxt + 1
                        continue
                    break
                if not targets:
                    continue
            keyword = "FROM" if is_revoke else "TO"
            km = re.compile(_pg_kw(keyword), re.IGNORECASE).search(
                masked, m.end(), end
            )
            grantees = _grantee_names(raw[km.end(): end]) if km else set()
            out.append(
                PrivilegeStatement(
                    m.start(), end, is_revoke, targets, all_in_schema, grantees,
                    bool(m.groupdict().get("grant_option")),
                )
            )
    return out


_DEFAULT_PRIVILEGES_RE = re.compile(
    _pg_kw(f"ALTER{_WS1}DEFAULT{_WS1}PRIVILEGES"), re.IGNORECASE
)
_ON_DEFAULT_ROUTINES_RE = re.compile(
    r"\A(?:FUNCTIONS|ROUTINES)" + _KW_RIGHT, re.IGNORECASE
)
_GRANT_WORD_RE = re.compile(_pg_kw("GRANT"), re.IGNORECASE)
_TO_WORD_RE = re.compile(_pg_kw("TO"), re.IGNORECASE)
_ON_ANY_WORD_RE = re.compile(_pg_kw("ON"), re.IGNORECASE)


def parse_default_privilege_unknowns(raw: str, masked: str):
    """Default EXECUTE grants that may affect routines created later."""
    bodies = routine_body_spans(masked) + do_body_spans(masked, raw)
    out = []
    # Round 13 (F10): `ALTER DEFAULT PRIVILEGES` inside a DO body runs at
    # migration time and applies to every routine CREATEd after it - verified
    # on PostgreSQL 17.11, where a DO setting default EXECUTE for
    # `authenticated` left a later function executable by it despite a
    # PUBLIC-only revoke. Such a DO is already PROCEDURAL_ACL_UNKNOWN, but
    # that event is keyed to a file offset BEFORE the definition and the ACL
    # replay only reads events after it. Default privileges are exactly the
    # class that reaches backwards across that boundary, so the DO is recorded
    # here as well, with an unresolved grantee: which roles the body finally
    # names is not something this scanner can prove.
    for block in parse_do_blocks(masked, raw):
        if block.body_span is None:
            continue
        body_start, body_end = block.body_span
        if not block.readable:
            out.append((block.start, {UNRESOLVED_GRANTEE}))
            continue
        if _DEFAULT_PRIVILEGES_RE.search(masked, body_start, body_end):
            out.append((block.start, {UNRESOLVED_GRANTEE}))
    for match in _DEFAULT_PRIVILEGES_RE.finditer(masked):
        if any(start <= match.start() < stop for start, stop in bodies):
            continue
        end, _ = _scan_statement(masked, match.end())
        region = masked[match.start():end]
        grant = _GRANT_HEAD_RE.search(region)
        if grant is None or not _EXECUTE_PRIV_RE.search(grant.group("privs") or ""):
            continue
        rest = region[grant.end():]
        if _ON_DEFAULT_ROUTINES_RE.match(rest) is None:
            continue
        to_match = _TO_WORD_RE.search(region, grant.end())
        if to_match is None:
            continue
        roles = _grantee_names(raw[match.start() + to_match.end():end])
        out.append((match.start(), roles))
    return out


# PostgreSQL keeps two LEGACY spellings for the same membership change, and
# `ALTER GROUP <g> ADD USER <r>` is documented as an alias for GRANT. Verified
# on PostgreSQL 17.11: it moved `authenticated` from false to true on a
# function reachable only through `stock_ops`, exactly as
# `GRANT stock_ops TO authenticated` does. `ALTER ROLE`/`ALTER USER ... ADD
# USER` and `ALTER GROUP ... ADD ROLE` are syntax ERRORS there, so only the
# confirmed spelling is recognized here - a mutant PostgreSQL rejects is not a
# reachable class and modelling it would be guesswork.
#
# `ALTER ROLE <r> INHERIT` is the other half: it does not change membership,
# it changes whether the role's existing memberships confer their privileges
# automatically, which moves the same effective execution right.
_ALTER_GROUP_MEMBER_RE = re.compile(
    _pg_kw(r"ALTER[" + _PG_WS + r"]+GROUP"), re.IGNORECASE
)
_GROUP_MEMBER_VERB_RE = re.compile(
    _KW_LEFT + r"(?:ADD|DROP)[" + _PG_WS + r"]+USER[" + _PG_WS + r"]+",
    re.IGNORECASE,
)
_ALTER_ROLE_INHERIT_RE = re.compile(
    _pg_kw(r"ALTER[" + _PG_WS + r"]+(?:ROLE|USER)"), re.IGNORECASE
)
_INHERIT_OPTION_RE = re.compile(_pg_kw("NOINHERIT|INHERIT"), re.IGNORECASE)


def parse_role_membership_unknown_roles(raw: str, masked: str) -> set[str]:
    """Client roles whose inherited privileges changed in this migration."""
    bodies = routine_body_spans(masked) + do_body_spans(masked, raw)

    def owned(pos: int) -> bool:
        return any(start <= pos < stop for start, stop in bodies)

    unknown: set[str] = set()
    for match in _GRANT_WORD_RE.finditer(masked):
        if owned(match.start()):
            continue
        end, _ = _scan_statement(masked, match.end())
        region = masked[match.start():end]
        to_match = _TO_WORD_RE.search(region)
        if to_match is None:
            continue
        if _ON_ANY_WORD_RE.search(region, 0, to_match.start()) is not None:
            continue
        roles = _grantee_names(raw[match.start() + to_match.end():end])
        unknown.update(role for role in CLIENT_ROLES if role in roles)
    for match in _ALTER_GROUP_MEMBER_RE.finditer(masked):
        if owned(match.start()):
            continue
        end, _ = _scan_statement(masked, match.end())
        verb = _GROUP_MEMBER_VERB_RE.search(masked, match.end(), end)
        if verb is None:
            continue
        # The MEMBER list is what gains or loses the group's privileges; the
        # group named before the verb is not itself the changed role.
        roles = _grantee_names(raw[verb.end():end])
        unknown.update(role for role in CLIENT_ROLES if role in roles)
    for match in _ALTER_ROLE_INHERIT_RE.finditer(masked):
        if owned(match.start()):
            continue
        end, _ = _scan_statement(masked, match.end())
        if _INHERIT_OPTION_RE.search(masked, match.end(), end) is None:
            continue
        roles = _grantee_names(raw[match.end():end])
        unknown.update(role for role in CLIENT_ROLES if role in roles)
    return unknown


def revoke_closes_client_surface(
    identity: Identity,
    after: int,
    privileges: list[PrivilegeStatement],
    strict: bool = False,
    procedural_unknowns: list[int] | None = None,
    default_privilege_unknowns=None,
    membership_unknown_roles: set[str] | None = None,
    preserves_prior_acl: bool = False,
) -> bool:
    """True when the migration leaves THIS function unreachable by every client.

    The old test was a blanket `REVOKE ... FROM PUBLIC` regex anywhere before the
    next CREATE. It neither checked that the statement named this function nor
    that the closure survived - so a REVOKE on a different function, or on a
    different overload, exempted an unguarded one, and a later
    `GRANT ... TO PUBLIC` re-opened what it had closed.

    The replacement replays the file's own privilege statements against this
    identity and asks what the ACL looks like when the migration finishes.
    PostgreSQL grants EXECUTE to PUBLIC on a new function, so the surface starts
    open and only an explicit REVOKE closes it; anon and authenticated reach the
    function through PUBLIC unless they hold an explicit grant of their own.
    Under the STRICT contract, closing PUBLIC while granting `authenticated` is
    not a closure at all - that is precisely the cross-tenant surface this
    scanner exists to find, and the project contract has always read "revoke
    EXECUTE from PUBLIC *and the clients*". Migrations at or below the cutoff
    are immutable historical inputs, and three of them (123, 175, 186) do exactly
    that while carrying their own reviewed authorization, so for them the
    historical PUBLIC-only test is preserved. The cutoff is a migration NUMBER;
    no function is exempted by name.

    Round 11 adds a third state, PROCEDURAL_ACL_UNKNOWN. A DO block that might
    change routine EXECUTE is not replayed as a definite GRANT or REVOKE; it
    makes every client-role cell UNKNOWN. UNKNOWN is not closure. A later
    provably applicable top-level privilege statement restores proof for the
    roles it names; roles it does not name stay UNKNOWN. Ordering matters.

    Round 13 (Fable, F5) adds `preserves_prior_acl`, set for a
    `CREATE OR REPLACE`. PostgreSQL does not reset a replaced routine's
    permissions, so

        GRANT EXECUTE ON FUNCTION public.victim(uuid) TO authenticated;
        CREATE OR REPLACE FUNCTION public.victim(uuid) ... SECURITY DEFINER ...;
        REVOKE EXECUTE ON FUNCTION public.victim(uuid) FROM PUBLIC;

    leaves `authenticated` able to execute it - verified on PostgreSQL 17.11 -
    while this replay dropped every event before `after` and reported the
    surface closed. Only GRANTs are carried across that boundary, and the
    asymmetry is the point: a GRANT before the replace MAY still apply, so it
    is replayed, while an earlier REVOKE earns no closure credit for an
    identity whose pre-existing ACL this scanner never saw. File order still
    decides the outcome, so a later REVOKE naming the role closes it again.
    """
    public_state = ACL_OPEN
    explicit = {role: ACL_CLOSED for role in CLIENT_ROLES if role != "public"}

    for pos, roles in default_privilege_unknowns or ():
        if pos >= after:
            continue
        opens_everything = UNRESOLVED_GRANTEE in roles
        for role in CLIENT_ROLES:
            if role not in roles and not opens_everything:
                continue
            if role == "public":
                public_state = ACL_UNKNOWN
            else:
                explicit[role] = ACL_UNKNOWN

    events: list[tuple[int, int, object]] = []
    for stmt in privileges:
        events.append((stmt.start, 0, stmt))
    for pos in procedural_unknowns or ():
        events.append((pos, 1, None))
    events.sort(key=lambda item: (item[0], item[1]))

    for start, _kind, stmt in events:
        if start < after and not (
            preserves_prior_acl
            and stmt is not None
            and not stmt.is_revoke
            and not stmt.grant_option_only
        ):
            continue
        if stmt is None:
            public_state = ACL_UNKNOWN
            explicit = {role: ACL_UNKNOWN for role in explicit}
            continue
        if stmt.all_in_schema:
            if stmt.is_revoke:
                continue
            opens_everything = UNRESOLVED_GRANTEE in stmt.grantees
            for role in CLIENT_ROLES:
                if role not in stmt.grantees and not opens_everything:
                    continue
                if role == "public":
                    public_state = ACL_OPEN
                else:
                    explicit[role] = ACL_OPEN
            continue
        # `REVOKE GRANT OPTION FOR EXECUTE` takes away the right to pass EXECUTE
        # on. The grantee's own EXECUTE is untouched, so this statement moves no
        # part of the executable surface and must not be replayed as a closure.
        if stmt.grant_option_only:
            continue
        # A REVOKE only credits closure for the overload it PROVABLY names; a
        # GRANT is replayed whenever it MIGHT reach this one. The asymmetry is
        # the point: an unreadable signature must never close a surface, and
        # must never be assumed harmless either.
        relation = (
            Identity.same_function if stmt.is_revoke else Identity.may_be_same_function
        )
        if not any(relation(identity, t) for t in stmt.targets):
            continue
        # A GRANT to a grantee nobody could resolve may well reach a client
        # role, so it is replayed as reaching all of them. The same token in a
        # REVOKE credits no closure: it is simply not one of these roles.
        opens_everything = (
            not stmt.is_revoke and UNRESOLVED_GRANTEE in stmt.grantees
        )
        next_state = ACL_CLOSED if stmt.is_revoke else ACL_OPEN
        for role in CLIENT_ROLES:
            if role not in stmt.grantees and not opens_everything:
                continue
            if role == "public":
                public_state = next_state
            else:
                explicit[role] = next_state
    if public_state != ACL_CLOSED:
        return False
    if any(state == ACL_UNKNOWN for state in explicit.values()):
        return False
    if membership_unknown_roles and any(
        role in membership_unknown_roles for role in CLIENT_ROLES
    ):
        return False
    return not strict or all(state == ACL_CLOSED for state in explicit.values())


# ---------------------------------------------------------------------------
# Recognized-guard integrity
# ---------------------------------------------------------------------------
# The canonical arity of every recognized helper. A call with a different
# argument count cannot be the reviewed function, whatever it is named: an
# overload is a DIFFERENT function in PostgreSQL, and a locally declared
# `wardah_assert_org_member(text)` that does nothing would otherwise satisfy the
# gate through the same call-shape match as the real one.
GUARD_ARITY = {
    "wardah_assert_org_member": 1,
    "wardah_assert_org_admin": 1,
    "wardah_178_assert_permission": 2,
    "wardah_is_org_member": 1,
}

_GUARD_NAME_RE = re.compile(
    f"(?:public{_WS0}[.]{_WS0})?(" + "|".join(GUARD_NAMES + BOOLEAN_PREDICATES)
    + f"){_WS0}[(]",
    re.IGNORECASE,
)


def _call_arity(body: str, open_paren: int) -> int | None:
    """Top-level argument count of the call whose `(` is at `open_paren`."""
    inner, _ = _balanced_parens(body, open_paren)
    if inner is None:
        return None
    if not inner.strip():
        return 0
    return len(_split_top_level_commas(inner))


def guard_call_has_canonical_arity(body: str, match) -> bool:
    """True when a matched guard call passes the helper's declared arity."""
    name_m = _GUARD_NAME_RE.match(body, match.start())
    if name_m is None:
        return False
    expected = GUARD_ARITY.get(name_m.group(1).lower())
    if expected is None:
        return False
    return _call_arity(body, match.end() - 1) == expected


def redefined_guard_names(definitions) -> list[str]:
    """Recognized helper names this file itself defines or replaces.

    A migration that redefines the very helper it leans on is not something a
    per-file scanner can adjudicate: the guard it reads and the guard the
    database will run are then two different bodies. Under the strict contract
    that is a hard stop, not a judgement call.
    """
    # Identity.name is already resolved through _pg_identifier(); re-folding it
    # here with str.lower() would be a second, divergent identity model.
    recognized = {n.lower() for n in GUARD_NAMES + BOOLEAN_PREDICATES}
    return sorted({d.identity.name for d in definitions if d.identity.name in recognized})


def _identity_mutation_errors(path, raw: str, masked: str, definitions,
                              privileges) -> list[str]:
    """Round 13 (F6): refuse to claim proof across a routine identity change.

    A mutation is reported when it touches something the verdict rests on:
      * a SECURITY DEFINER routine this migration defines, whose closure or
        guard was judged under the OLD name;
      * a routine named by one of this file's own privilege statements, whose
        replayed ACL is keyed to that identity;
      * a recognized authorization helper, on either side of the rename - the
        guard this scanner READ would not be the guard the database RUNS.
    Anything else (renaming an unrelated legacy routine) is untouched, so this
    adds no blanket suspicion of ALTER.
    """
    recognized = {n.lower() for n in GUARD_NAMES + BOOLEAN_PREDICATES}
    definer_identities = [d.identity for d in definitions if d.final_definer]
    acl_identities = [t for stmt in privileges for t in stmt.targets]
    errors = []
    for alter in parse_alter_identity(raw, masked):
        reason = None
        if alter.identity.name in recognized:
            reason = "is a recognized authorization helper"
        elif alter.new_name is not None and alter.new_name in recognized:
            reason = (
                f"gives it the recognized authorization helper name "
                f"'{alter.new_name}'"
            )
        elif any(
            alter.identity.may_be_same_function(i) for i in definer_identities
        ):
            reason = "is a SECURITY DEFINER routine this migration defines"
        elif any(
            alter.identity.may_be_same_function(i) for i in acl_identities
        ):
            reason = "is named by this migration's own privilege statements"
        if reason is None:
            continue
        errors.append(
            f"  ❌ {path.name}: 'ALTER ROUTINE {alter.identity.qualified} "
            f"{alter.kind}' changes the identity of a routine that {reason}; "
            f"this scanner does not model identity mutation, so it cannot "
            f"prove the guard or the closure still holds"
        )
    return errors


def check_file(path: pathlib.Path) -> list[str]:
    errors = []
    number = migration_number(path)
    strict = number is not None and number >= MIGRATION_STRICT_CUTOFF
    raw_sql = path.read_text(encoding="utf-8")
    sql, mask_problems = mask_sql_checked(raw_sql)

    # Fail closed. A body the masker could not follow may hide a guard name in
    # unmasked non-executable text, which is exactly the false green this
    # scanner exists to prevent.
    for problem in mask_problems:
        errors.append(
            f"  ❌ {path.name}: cannot be scanned safely ({problem}); "
            f"fix the construct or split it out"
        )
    if mask_problems:
        return errors

    definitions = parse_definitions(raw_sql, sql)
    privileges = parse_privilege_statements(raw_sql, sql)
    procedural_unknowns = parse_procedural_acl_unknown(
        raw_sql, sql, definitions, strict=strict
    )
    default_privilege_unknowns = parse_default_privilege_unknowns(raw_sql, sql)
    membership_unknown_roles = parse_role_membership_unknown_roles(raw_sql, sql)
    # Security mode is a STATE. Resolve every CREATE against the ALTERs that
    # follow it before judging anything, so a promotion cannot slip between the
    # two statements and a demotion cannot be reported.
    external_promotions = resolve_security_state(
        definitions, parse_alter_security(raw_sql, sql)
    )

    if strict:
        for name in redefined_guard_names(definitions):
            errors.append(
                f"  ❌ {path.name}: redefines the recognized authorization "
                f"helper '{name}'; a migration may not both replace a guard and "
                f"be validated by it"
            )
        # Round 13 (F2): a DO body that may change a SECURITY mode is not
        # replayed as a state change, so it must be reported instead.
        for pos in parse_procedural_security_unknown(raw_sql, sql):
            errors.append(
                f"  ❌ {path.name}: a DO block at offset {pos} may change a "
                f"routine's SECURITY mode; this scanner cannot prove its "
                f"effect, so move the ALTER to SQL top level"
            )
        errors.extend(
            _identity_mutation_errors(path, raw_sql, sql, definitions, privileges)
        )

    for definition in definitions:
        if not definition.final_definer:
            continue

        identity = definition.identity
        # KNOWN_EXEMPT is a HISTORICAL ledger. It is keyed by bare name, so
        # under the strict contract it would exempt a brand-new overload, and a
        # quoted `"HAS_PERMISSION"` that folds to an exempt name is not that
        # function at all. From the cutoff on, no name-based exemption applies.
        if (
            not strict
            and not identity.quoted
            and identity.schema in (None, "public")
            and identity.name in KNOWN_EXEMPT
        ):
            continue

        if revoke_closes_client_surface(
            identity, definition.end, privileges, strict=strict,
            procedural_unknowns=procedural_unknowns,
            default_privilege_unknowns=default_privilege_unknowns,
            membership_unknown_roles=membership_unknown_roles,
            preserves_prior_acl=definition.or_replace,
        ):
            continue

        if definition.body_span is None:
            errors.append(
                f"  ❌ {path.name}: function '{identity.qualified}' is "
                f"SECURITY DEFINER with no dollar-quoted body this scanner can "
                f"read; revoke EXECUTE from PUBLIC in this migration or give it "
                f"a readable body"
            )
            continue

        body_start, body_end = definition.start, definition.body_span[1]
        body = sql[body_start:body_end]
        raw_body = raw_sql[body_start:body_end]

        if not has_recognized_guard(body, strict=strict, raw_body=raw_body):
            how = (
                "is SECURITY DEFINER"
                if definition.promoted_by is None
                else "is made SECURITY DEFINER by a later ALTER in this migration"
            )
            errors.append(
                f"  ❌ {path.name}: function '{identity.qualified}' {how} "
                f"but has no recognized tenant/authorization assertion"
            )

    # A promotion of a function this migration does NOT define restates no body,
    # so there is nothing to prove a guard from. (A promotion of one it DOES
    # define was folded into that definition's final state above and judged there
    # against its real body - which is the case that used to be skipped on the
    # false reasoning that "its CREATE was checked", when the CREATE had been an
    # unprivileged INVOKER nobody checks.) It is accepted only when the migration
    # closes it to every client role.
    for alter in external_promotions:
        if revoke_closes_client_surface(
            alter.identity, alter.end, privileges, strict=strict,
            procedural_unknowns=procedural_unknowns,
            default_privilege_unknowns=default_privilege_unknowns,
            membership_unknown_roles=membership_unknown_roles,
        ):
            continue
        errors.append(
            f"  ❌ {path.name}: 'ALTER ROUTINE {alter.identity.qualified} "
            f"SECURITY DEFINER' makes an existing function run as its owner "
            f"without restating a guard; define it with its assertion in this "
            f"migration or revoke EXECUTE from PUBLIC"
        )

    return errors


def main() -> int:
    cutoff = get_cutoff()
    print(f"🔍 فحص دوال SECURITY DEFINER في migrations > {cutoff} …")

    new_migrations = []
    for p in MIGRATIONS_DIR.iterdir():
        parts = p.stem.split("_")
        if parts[0].isdigit() and int(parts[0]) > cutoff and p.suffix == ".sql":
            new_migrations.append(p)

    if not new_migrations:
        print(f"✅ لا migrations جديدة بعد cutoff {cutoff} — لا شيء يفحص")
        return 0

    all_errors: list[str] = []
    for mig in sorted(new_migrations):
        all_errors.extend(check_file(mig))

    if all_errors:
        print("\n".join(all_errors), file=sys.stderr)
        print(
            "\nأضف tenant/authorization assertion معترفاً بها، أو اسحب EXECUTE/ALL "
            "من PUBLIC فور تعريف الدالة، أو وثّق تفويضاً آمناً في KNOWN_EXEMPT.",
            file=sys.stderr,
        )
        return 1

    print(f"✅ {len(new_migrations)} migration(s) — لا دوال DEFINER بلا حارس")
    return 0


if __name__ == "__main__":
    sys.exit(main())
