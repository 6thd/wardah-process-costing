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
_QUOTED_CONDITION_RE = re.compile(
    r"""\A(?:U&)?"[^"]*"(?:\s*UESCAPE\s*'[^']*')?\Z""", re.IGNORECASE
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
_DOLQ_START = "A-Za-z_\x80-\U0010FFFF"
_DOLQ_CONT = "A-Za-z0-9_\x80-\U0010FFFF"
_DOLLAR_TAG_RE = re.compile(f"\\$(?:[{_DOLQ_START}][{_DOLQ_CONT}]*)?\\$")
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
_UESCAPE_CLAUSE_RE = re.compile(r"\s*UESCAPE\s*'(.)'", re.IGNORECASE)
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


def _read_delimited_identifier(raw: str, pos: int):
    """(resolved name, index just past it) for a `"..."` or `U&"..."`
    identifier at `pos`, or None when there is none or it cannot be resolved.

    `raw` must be UNMASKED text: masking blanks quoted-identifier content by
    design, so the identity only exists in the raw source.
    """
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
    clause = _UESCAPE_CLAUSE_RE.match(raw, j)
    if clause:
        escape = clause.group(1)
        if escape in _BAD_UESCAPE_CHARS or escape.isspace():
            return None
        j = clause.end()
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
    read = _read_delimited_identifier(raw, start)
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

    This deliberately shares ONE compiled boundary rule with the SQLSTATE
    literal reader. They were two separate transcriptions of the same grammar
    before, and they disagreed: a tag this masker refused to recognize left the
    literal's content exposed as executable text. A single reader cannot drift.
    """
    if i >= len(sql) or sql[i] != "$":
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
                        outer_tag = tag       # enter an executable body
                        i += len(tag)
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
        return f"{base}({','.join(self.args)})"

    def same_function(self, other: "Identity") -> bool:
        """Name match, plus argument-list match when BOTH sides carry one.

        PostgreSQL identifies an overload by its argument types, so a REVOKE on
        `f(text)` says nothing about `f(uuid)`. When either side OMITS the list
        the name match is all that is available. A list that is PRESENT but
        unresolved is a different state entirely and matches nothing at all -
        collapsing it into the omitted case turned every signature this scanner
        could not read into a wildcard.
        """
        if self.name != other.name:
            return False
        if self.schema and other.schema:
            if self.schema != other.schema:
                return False
        elif self.schema or other.schema:
            # One side omitted the schema. PostgreSQL resolves that through
            # search_path - it is NOT a wildcard - and every migration here runs
            # with `public` first. So an unqualified name resolves to `public`
            # and says nothing about a function in another schema. Treating it as
            # a match let a REVOKE with no schema exempt `other_schema.f`.
            named = self.schema or other.schema
            if named != "public":
                return False
        if self.args is UNRESOLVED_ARGS or other.args is UNRESOLVED_ARGS:
            return False
        if self.args is None or other.args is None:
            return True
        return self.args == other.args


# The only built-in types whose FIRST word is part of the type rather than a
# parameter name. Everything else that leads a two-token parameter is a name.
_TYPE_LEAD_WORDS = frozenset(
    {"character", "double", "bit", "national", "time", "timestamp", "interval"}
)
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
            delimited = _read_delimited_identifier(raw, i)
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


def _render_type_tokens(tokens) -> str:
    """Canonical text for a resolved type expression.

    An identifier is written bare when its resolved name is exactly what the
    bare spelling would produce, and delimited otherwise - so `"uuid"` and
    `uuid` render alike (PostgreSQL resolves them to the same identifier) while
    `"UUID"` stays distinct. Whitespace only ever separates two word-like
    tokens, so spacing around `.`, `[` and `,` cannot change an identity.
    """
    out, separates = [], False
    for kind, value, _quoted in tokens:
        word = kind in ("ident", "num")
        if out and word and separates:
            out.append(" ")
        if kind == "ident" and not (
            _PLAIN_IDENT_RE.match(value) and _fold_unquoted(value) == value
        ):
            out.append('"' + value.replace('"', '""') + '"')
        else:
            out.append(value)
        # A word after a word, and a word after a closing `)`, need a
        # separator (`time(3) with time zone`); nothing else does, so spacing
        # around `.`, `[` and `,` cannot change an identity.
        separates = word or (kind == "punct" and value == ")")
    return "".join(out)


def _normalize_arg_type(param: str, raw_param: str | None = None) -> str | None:
    """The declared TYPE of one parameter, normalized for comparison.

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
    if (
        len(tokens) > 1
        and tokens[0][0] == "ident"
        and tokens[1][0] == "ident"
        and not (not tokens[0][2] and tokens[0][1] in _TYPE_LEAD_WORDS)
        and not _is_array_suffix_only(tokens[1:])
    ):
        tokens = tokens[1:]
    return _render_type_tokens(tokens) or None


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
            delimited = _read_delimited_identifier(raw, i)
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
                if body is None:
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
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+", re.IGNORECASE
)
_ALTER_ROUTINE_RE = re.compile(r"\bALTER\s+(?:FUNCTION|PROCEDURE)\s+", re.IGNORECASE)
_SECURITY_DEFINER_RE = re.compile(r"\bSECURITY\s+DEFINER\b", re.IGNORECASE)
# `REVOKE GRANT OPTION FOR EXECUTE ... FROM authenticated` withdraws only the
# right to RE-GRANT execute. The role keeps EXECUTE itself and can still call the
# function. The optional clause was already matched here - so the statement
# parsed and its privilege list read `EXECUTE` - but it collapsed into a plain
# revoke, and the ACL replay then closed the executable surface on the strength
# of a statement that closes nothing. It is captured as its own group so
# revoke_closes_client_surface() can leave EXECUTE state alone.
_REVOKE_HEAD_RE = re.compile(
    r"\bREVOKE\s+(?P<grant_option>GRANT\s+OPTION\s+FOR\s+)?"
    r"(?P<privs>[A-Za-z, ]*?)\s*\bON\s+",
    re.IGNORECASE,
)
# `GRANT OPTION FOR` never begins a GRANT statement - it is the clause above,
# inside a REVOKE. Without the lookahead the same bytes were ALSO parsed as
# `GRANT OPTION FOR EXECUTE ON FUNCTION f(...)`, a statement that does not
# exist. It opened nothing in practice, because a REVOKE has no `TO` and the
# phantom's grantee list came out empty, but it put a statement in the ledger
# that the file never contained.
_GRANT_HEAD_RE = re.compile(
    r"\bGRANT\s+(?!OPTION\s+FOR\b)(?P<privs>[A-Za-z, ]*?)\s*\bON\s+", re.IGNORECASE
)
_EXECUTE_PRIV_RE = re.compile(r"\b(EXECUTE|ALL)\b", re.IGNORECASE)
_ON_ROUTINE_RE = re.compile(r"\A(?:FUNCTION|PROCEDURE|ROUTINE)\s+", re.IGNORECASE)
_ON_ALL_ROUTINES_RE = re.compile(
    r"\AALL\s+(?:FUNCTIONS|PROCEDURES|ROUTINES)\s+IN\s+SCHEMA\b", re.IGNORECASE
)


class Definition:
    __slots__ = ("identity", "start", "end", "body_span", "is_definer", "final_definer",
                 "promoted_by")

    def __init__(self, identity, start, end, body_span, is_definer):
        self.identity = identity
        self.start = start
        self.end = end
        self.body_span = body_span
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
        out.append(Definition(identity, m.start(), end, body_span, definer))
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
    out = []
    for m in _ALTER_ROUTINE_RE.finditer(masked):
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
            read = _read_delimited_identifier(raw_region, i)
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


def parse_privilege_statements(raw: str, masked: str) -> list[PrivilegeStatement]:
    """REVOKE/GRANT statements that carry EXECUTE (or ALL) on routines."""
    out = []
    for head_re, is_revoke in ((_REVOKE_HEAD_RE, True), (_GRANT_HEAD_RE, False)):
        for m in head_re.finditer(masked):
            if not _EXECUTE_PRIV_RE.search(m.group("privs") or ""):
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


def revoke_closes_client_surface(
    identity: Identity,
    after: int,
    privileges: list[PrivilegeStatement],
    strict: bool = False,
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
    """
    public_open = True
    explicit = {role: False for role in CLIENT_ROLES if role != "public"}
    for stmt in sorted(privileges, key=lambda s: s.start):
        if stmt.start < after or stmt.all_in_schema:
            continue
        # `REVOKE GRANT OPTION FOR EXECUTE` takes away the right to pass EXECUTE
        # on. The grantee's own EXECUTE is untouched, so this statement moves no
        # part of the executable surface and must not be replayed as a closure.
        if stmt.grant_option_only:
            continue
        if not any(identity.same_function(t) for t in stmt.targets):
            continue
        # A GRANT to a grantee nobody could resolve may well reach a client
        # role, so it is replayed as reaching all of them. The same token in a
        # REVOKE credits no closure: it is simply not one of these roles.
        opens_everything = (
            not stmt.is_revoke and UNRESOLVED_GRANTEE in stmt.grantees
        )
        for role in CLIENT_ROLES:
            if role not in stmt.grantees and not opens_everything:
                continue
            if role == "public":
                public_open = not stmt.is_revoke
            else:
                explicit[role] = not stmt.is_revoke
    if public_open:
        return False
    return not strict or not any(explicit.values())


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
            identity, definition.end, privileges, strict=strict
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
            alter.identity, alter.end, privileges, strict=strict
        ):
            continue
        errors.append(
            f"  ❌ {path.name}: 'ALTER FUNCTION {alter.identity.qualified} "
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
