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
    r"(?<![\w$\".])(?:public\s*\.\s*)?(?:"
    + "|".join(GUARD_NAMES)
    + r")\s*\("
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
    r"\bNOT\s+(?:public\s*\.\s*)?(?:" + "|".join(BOOLEAN_PREDICATES) + r")\s*\(",
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
_TOP_LEVEL_OR_RE = re.compile(r"\bOR\b", re.IGNORECASE)


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
            if m and (i == 0 or not (condition[i - 1].isalnum() or condition[i - 1] == "_")):
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


_TRAILING_IDENT_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_$]*)\s*$")


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
    r"\b(END\s+IF|END\s+LOOP|END\s+CASE|ELSIF|ELSE|EXCEPTION|BEGIN|IF|THEN|LOOP|CASE|END|RAISE)\b",
    re.IGNORECASE,
)
_NON_ABORTING_RAISE_RE = re.compile(
    r"\bRAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)\b", re.IGNORECASE
)
_RAISE_BEFORE_RE = re.compile(r"\bRAISE\s*$", re.IGNORECASE)

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
_STATEMENT_OPENER_KEYWORDS = frozenset(
    {"then", "else", "begin", "loop", "declare"}
)

# PostgreSQL's whitespace characters as THEMSELVES, not as a regex class.
# `_PG_WS` above is a raw string spelling the same set for use inside an `[]`
# class, so it holds backslash-t rather than a tab and cannot be used for a
# membership test. This is the twin that can.
_PLPGSQL_WS = " \t\n\r\f\v"


def _previous_word(body: str, pos: int) -> tuple[str, int]:
    """The identifier word ending just before `pos`, folded, with its start.

    Whitespace is skipped, and a COMMENT is already whitespace in the masked
    body every caller passes - which is what makes the decision below
    independent of spacing. Returns ("", pos) when the preceding token is not
    an identifier word at all.
    """
    j = pos - 1
    while j >= 0 and body[j] in _PLPGSQL_WS:
        j -= 1
    end = j + 1
    while j >= 0 and (body[j].isalnum() or body[j] == "_"):
        j -= 1
    return body[j + 1:end].lower(), j + 1


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
_HANDLER_WHEN_RE = re.compile(r"\bWHEN\b", re.IGNORECASE)
_HANDLER_THEN_RE = re.compile(r"\bTHEN\b", re.IGNORECASE)
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
    r"""\A(?:U&)?"[^"]*"(?:\s*UESCAPE\s*[Ee]?'[^']*')?\Z""", re.IGNORECASE
)
# The masker blanks literal CONTENT, so `WHEN SQLSTATE 'P0001'` reads as
# `WHEN SQLSTATE '     '` in the masked body. Rather than unmasking literals
# globally - which would hand guard detection back every string it was hardened
# against - the SQLSTATE value alone is recovered from the unmasked text at the
# same offsets, and only inside a handler condition. Locating the keyword and
# the quotes on MASKED text is also what makes `WHEN SQLSTATE /* why */ 'P0001'`
# resolve: the comment is whitespace by then, so no separator regex has to
# anticipate it.
_SQLSTATE_KEYWORD_RE = re.compile(r"\bSQLSTATE\b", re.IGNORECASE)

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
# PostgreSQL's own whitespace set, as a regex character class. Python's `\s` is
# NOT it: `\s` also matches U+00A0 and other Unicode spaces that PostgreSQL's
# scanner rejects (`GRANT ALL\u00a0PRIVILEGES` is a syntax error there), so a
# grammar written against `\s` would parse text PostgreSQL never accepts.
_PG_WS = r" \t\n\r\f\v"

_DOLQ_START = "A-Za-z_\x80-\U0010FFFF"
_DOLQ_CONT = "A-Za-z0-9_\x80-\U0010FFFF"
_DOLLAR_TAG_RE = re.compile(f"\\$(?:[{_DOLQ_START}][{_DOLQ_CONT}]*)?\\$")
# One character of PostgreSQL's unquoted-identifier continuation class
# (scan.l ident_cont), used by _dollar_tag_at() to refuse a tag that would
# start inside an identifier. `$` is deliberately included: it continues an
# identifier there, and `_IDENT_CONT` further down spells the same class for
# the statement model.
_IDENT_CONT_RE = re.compile("[A-Za-z0-9_$\x80-\U0010FFFF]")
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
_UESCAPE_KEYWORD_RE = re.compile(f"[{_PG_WS}]*UESCAPE\\b", re.IGNORECASE)
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
        if escape in _BAD_UESCAPE_CHARS or escape.isspace():
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
            if m and (i == 0 or not (condition[i - 1].isalnum() or condition[i - 1] == "_")):
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
_DECLARE_KW_RE = re.compile(r"DECLARE\b", re.IGNORECASE)
_BEGIN_KW_RE = re.compile(r"BEGIN\b", re.IGNORECASE)
_LOOP_KW_RE = re.compile(r"LOOP\b", re.IGNORECASE)
_LOOP_HEAD_RE = re.compile(r"(?:LOOP|WHILE|FOR|FOREACH)\b", re.IGNORECASE)


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
        # A declaration section runs to the BEGIN that opens the block. Nothing
        # in it can spell BEGIN: comments and every literal form are already
        # blanked in the masked text this reads.
        opener = _BEGIN_KW_RE.search(body, declare.end())
        return opener.start() if opener else None
    if _LOOP_HEAD_RE.match(body, i):
        # WHILE/FOR/FOREACH open their frame at the LOOP keyword that ends the
        # loop header, which is where parse_blocks() pushes the frame.
        opener = _LOOP_KW_RE.search(body, i)
        return opener.start() if opener else None
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
    """
    if raw_body is None:
        raw_body = body
    labels: dict[int, str] = {}
    for m in _LABEL_OPEN_RE.finditer(body):
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


def parse_blocks(body: str, raw_body: str | None = None):
    """Model BEGIN / IF / LOOP / CASE nesting and EXCEPTION sections.

    LOOP covers WHILE, FOR and FOREACH, which all open with LOOP and close with
    END LOOP. A bare END closes the innermost BEGIN or CASE, so a CASE
    expression cannot silently close an enclosing block.

    `raw_body` is the SAME span of the unmasked source. It is consulted only for
    block-label text, which masking necessarily hides for a quoted label.
    """
    labels = _block_labels(body, raw_body)
    stack, frames = [], []

    def pop(kinds, at):
        for i in range(len(stack) - 1, -1, -1):
            if stack[i].kind in kinds:
                fr = stack.pop(i)
                fr.end = at
                frames.append(fr)
                return

    for m in _BLOCK_TOKEN_RE.finditer(body):
        token = " ".join(m.group(1).upper().split())
        if token in ("BEGIN", "IF", "LOOP", "CASE"):
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
        elif token == "RAISE":  # nosec B105 - parsed PL/pgSQL keyword, not a credential
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

    # Unclosed frames stay out of `frames`, so nothing depending on them is
    # recognized. That fails closed rather than guessing at the structure.
    return frames


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
_TERMINATING_RETURN_RE = re.compile(r"\bRETURN\b(?!\s+(?:NEXT|QUERY)\b)", re.IGNORECASE)


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
    r"\bRAISE\b(?!\s+(?:NOTICE|WARNING|INFO|LOG|DEBUG)\b)", re.IGNORECASE
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
_EXIT_KW_RE = re.compile(r"\bEXIT\b", re.IGNORECASE)
_WHEN_KW_RE = re.compile(r"WHEN\b", re.IGNORECASE)

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
_PERFORM_HEAD_RE = re.compile(r"\bPERFORM\s*$", re.IGNORECASE)


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
    """True when the quote at i opens an E'' escape-string literal."""
    if i == 0 or sql[i - 1] not in "Ee":
        return False
    k = i - 2
    return k < 0 or not (sql[k].isalnum() or sql[k] == "_")


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
    """Whether the token immediately before offset i is keyword."""
    j = i - 1
    while j >= 0 and str(text[j]).isspace():
        j -= 1
    end = j + 1
    while j >= 0 and (str(text[j]).isalnum() or text[j] == "_"):
        j -= 1
    return "".join(text[j + 1:end]).lower() == keyword.lower()


def _statement_starts_with_do(text, i: int) -> bool:
    """True when the current top-level statement prefix starts with DO."""
    prefix = "".join(text[:i])
    start = prefix.rfind(";") + 1
    return re.match(r"\s*DO\b", prefix[start:], re.IGNORECASE) is not None


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
# ONE unquoted-identifier alphabet, matching PostgreSQL's ident_start /
# ident_cont: an ASCII letter or underscore, or ANY non-ASCII character, then
# the same plus digits and `$`. PostgreSQL's scanner accepts every high-bit
# byte, so the range runs to U+10FFFF - it previously stopped at U+FFFF, which
# made an identifier containing a 4-byte UTF-8 character unparseable and, for a
# block label, invisible: no label was recorded and the labelled-EXIT bypass
# reopened.
_IDENT_START = "A-Za-z_\x80-\U0010FFFF"
_IDENT_CONT = "A-Za-z0-9_$\x80-\U0010FFFF"
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
        if ch.isspace():
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
    while i < len(masked) and masked[i].isspace():
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
    r"\bCREATE\s+(?P<or_replace>OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+",
    re.IGNORECASE,
)
_ALTER_ROUTINE_RE = re.compile(
    r"\bALTER\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+", re.IGNORECASE
)
_SECURITY_DEFINER_RE = re.compile(r"\bSECURITY\s+DEFINER\b", re.IGNORECASE)
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
    r"\bREVOKE[" + _PG_WS + r"]+"
    r"(?P<grant_option>GRANT[" + _PG_WS + r"]+OPTION[" + _PG_WS + r"]+FOR["
    + _PG_WS + r"]+)?"
    r"(?P<privs>[A-Za-z," + _PG_WS + r"]*?)[" + _PG_WS + r"]*\bON[" + _PG_WS + r"]+",
    re.IGNORECASE,
)
# `GRANT OPTION FOR` never begins a GRANT statement - it is the clause above,
# inside a REVOKE. Without the lookahead the same bytes were ALSO parsed as
# `GRANT OPTION FOR EXECUTE ON FUNCTION f(...)`, a statement that does not
# exist. It opened nothing in practice, because a REVOKE has no `TO` and the
# phantom's grantee list came out empty, but it put a statement in the ledger
# that the file never contained.
_GRANT_HEAD_RE = re.compile(
    r"\bGRANT[" + _PG_WS + r"]+(?!OPTION[" + _PG_WS + r"]+FOR\b)"
    r"(?P<privs>[A-Za-z," + _PG_WS + r"]*?)[" + _PG_WS + r"]*\bON[" + _PG_WS + r"]+",
    re.IGNORECASE,
)
_EXECUTE_PRIV_RE = re.compile(r"\b(EXECUTE|ALL)\b", re.IGNORECASE)
_ON_ROUTINE_RE = re.compile(r"\A(?:FUNCTION|PROCEDURE|ROUTINE)\s+", re.IGNORECASE)
_ON_ALL_ROUTINES_RE = re.compile(
    r"\AALL\s+(?:FUNCTIONS|PROCEDURES|ROUTINES)\s+IN\s+SCHEMA\b", re.IGNORECASE
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


_SECURITY_INVOKER_RE = re.compile(r"\bSECURITY\s+INVOKER\b", re.IGNORECASE)


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
    r"\ARENAME[" + _PG_WS + r"]+TO[" + _PG_WS + r"]+", re.IGNORECASE
)
_ALTER_SET_SCHEMA_RE = re.compile(
    r"\ASET[" + _PG_WS + r"]+SCHEMA[" + _PG_WS + r"]+", re.IGNORECASE
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
_DO_KW_RE = re.compile(r"\bDO\b", re.IGNORECASE)
_LANGUAGE_KW_RE = re.compile(r"LANGUAGE\b", re.IGNORECASE)
_ON_WORD_RE = re.compile(r"\bON\b", re.IGNORECASE)
_EXECUTE_WORD_RE = re.compile(r"\bEXECUTE\b", re.IGNORECASE)
_PROCEDURAL_CALL_RE = re.compile(
    r"\b(?:PERFORM|CALL)\b[^;]*\(", re.IGNORECASE | re.DOTALL
)
# Round 13 (Fable, F4): keying migration-time execution to three keyword
# spellings was too narrow. PostgreSQL 17.11 runs a same-file function - and
# with it any `GRANT EXECUTE` its body performs - from every statement class
# below; each was verified to move `authenticated` from false to true on a
# fully revoked victim. The keyword only LOCATES a candidate region; whether
# the region is flagged is decided by _region_calls_defined_routine(), so
# `ON UPDATE CASCADE` and a `DELETE` that calls nothing are not affected.
_TOP_LEVEL_RUNTIME_KW_RE = re.compile(
    r"\b(?:CALL|SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|VALUES)\b",
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
    r"(?:\bGRANT\b|\bREVOKE\b"
    r"|\bALTER[" + _PG_WS + r"]+DEFAULT[" + _PG_WS + r"]+PRIVILEGES\b"
    r"|\bALTER[" + _PG_WS + r"]+(?:ROLE|GROUP|USER)\b"
    r")",
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
            km = re.compile(r"\b" + keyword + r"\b", re.IGNORECASE).search(
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
    r"\bALTER\s+DEFAULT\s+PRIVILEGES\b", re.IGNORECASE
)
_ON_DEFAULT_ROUTINES_RE = re.compile(
    r"\A(?:FUNCTIONS|ROUTINES)\b", re.IGNORECASE
)
_GRANT_WORD_RE = re.compile(r"\bGRANT\b", re.IGNORECASE)
_TO_WORD_RE = re.compile(r"\bTO\b", re.IGNORECASE)
_ON_ANY_WORD_RE = re.compile(r"\bON\b", re.IGNORECASE)


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
    r"\bALTER[" + _PG_WS + r"]+GROUP\b", re.IGNORECASE
)
_GROUP_MEMBER_VERB_RE = re.compile(
    r"\b(?:ADD|DROP)[" + _PG_WS + r"]+USER[" + _PG_WS + r"]+", re.IGNORECASE
)
_ALTER_ROLE_INHERIT_RE = re.compile(
    r"\bALTER[" + _PG_WS + r"]+(?:ROLE|USER)\b", re.IGNORECASE
)
_INHERIT_OPTION_RE = re.compile(r"\b(?:NOINHERIT|INHERIT)\b", re.IGNORECASE)


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
    r"(?:public\s*\.\s*)?(" + "|".join(GUARD_NAMES + BOOLEAN_PREDICATES) + r")\s*\(",
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
