#!/usr/bin/env python3
"""Scanner v2 Slice 4: guard-evidence producer.

Consumes the original SQL source, the accepted Slice 2 binding/runtime
evidence, and a PostgreSQL-backed guard-contract oracle, and emits exactly one
guard record per accepted binding for the accepted Slice 3 policy core.

``PROVEN`` is never derived from a helper name alone. It requires a
structurally valid, all-path reachable, correctly ordered authorization
boundary at the routine's outer statement level, in the routine's own readable
body, resolving to the exact oracle overload identity, under a binding whose
whole identity matches the analysed statement -- plus trusted oracle evidence
that the helper identities and P0001/P0000 semantics are unchanged.

This producer does not query PostgreSQL, does not replay ACL state, and is not
a PL/pgSQL interpreter. Anything it cannot prove is ``UNKNOWN``.

Known scope limits, deliberate for this slice:
- only ``LANGUAGE plpgsql`` bodies delimited by a dollar-quoted literal are
  analysed; every other routine is ``UNKNOWN``;
- statement splitting understands ``BEGIN ATOMIC ... END`` only well enough to
  keep such a routine in one statement;
- effectlessness is a conservative syntactic test, not purity analysis.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

GUARD_SCANNER = "wardah-scanner-v2-guard-evidence-v1"
BINDING_SCANNER = "wardah-scanner-v2-discovery-binding"
CONTRACT_SCANNER = "wardah-scanner-v2-guard-contract-oracle-v1"

ERROR_MARKER = "SCANNER_V2_GUARD_EVIDENCE_ERROR"

EXPECTED_HELPERS = {
    "public.wardah_assert_org_member(uuid)": "RAISING_ASSERTION",
    "public.wardah_assert_org_admin(uuid)": "RAISING_ASSERTION",
    "public.wardah_178_assert_permission(uuid,text)": "RAISING_ASSERTION",
    "public.wardah_is_org_member(uuid)": "BOOLEAN_DENY",
}

EXPECTED_EXCEPTION_SEMANTICS = {
    "raise_exception_sqlstate": "P0001",
    "raise_exception_class_sqlstate": "P0000",
    "unique_violation_catches_raise_exception": False,
}

BINDING_DOC_KEYS = {
    "scanner",
    "status",
    "candidate_count",
    "binding_count",
    "bindings",
}

CONTRACT_DOC_KEYS = {
    "scanner",
    "status",
    "helper_count",
    "helpers",
    "exception_semantics",
}

PROOF_RAISING = "raising-assertion-v1"
PROOF_BOOLEAN = "negated-boolean-deny-v1"

NAMEDATALEN_LIMIT = 63

# PostgreSQL scan.l `space`, which on 17 includes the vertical tab.
SPACE_CHARS = " \t\r\n\x0b\f"

ASCII_LETTERS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = set("0123456789")


class EvidenceError(Exception):
    """A fail-closed defect in the inputs this producer cannot work around."""


# ---------------------------------------------------------------------------
# Lexical layer: masking, literal chains, dollar tags
# ---------------------------------------------------------------------------


def _dolq_start(ch: str) -> bool:
    """scan.l dolq_start is [A-Za-z\\200-\\377_]: any non-ASCII byte."""
    return ch in ASCII_LETTERS or ch == "_" or ord(ch) >= 0x80


def _dolq_cont(ch: str) -> bool:
    return _dolq_start(ch) or ch in DIGITS


def _read_dollar_tag(text: str, i: int) -> tuple[str, int] | None:
    """Read a dollar-quote tag at ``i``; return (tag, index after it)."""
    if i >= len(text) or text[i] != "$":
        return None
    j = i + 1
    if j < len(text) and text[j] == "$":
        return "$$", j + 1
    if j >= len(text) or not _dolq_start(text[j]):
        return None
    k = j
    while k < len(text) and _dolq_cont(text[k]):
        k += 1
    if k < len(text) and text[k] == "$":
        return text[i : k + 1], k + 1
    return None


def _literal_prefix(text: str, i: int) -> tuple[int, str] | None:
    """If a string literal starts at ``i``, return (quote index, kind)."""
    ch = text[i]
    if ch == "'":
        return i, "ordinary"
    if ch in "Ee" and i + 1 < len(text) and text[i + 1] == "'":
        return i + 1, "escape"
    if (
        ch in "Uu"
        and text[i : i + 2].lower() == "u&"
        and i + 2 < len(text)
        and text[i + 2] == "'"
    ):
        return i + 2, "unicode"
    return None


def _scan_quoted_segment(
    text: str, quote: int, escape: bool
) -> tuple[int, str]:
    """Scan one ``'...'`` segment; return (index after closing quote, body)."""
    out: list[str] = []
    i = quote + 1
    while i < len(text):
        ch = text[i]
        if escape and ch == "\\":
            # A backslash escape consumes the next character whatever it is,
            # so \' does NOT close the literal.
            out.append(ch)
            if i + 1 < len(text):
                out.append(text[i + 1])
            i += 2
            continue
        if ch == "'":
            if i + 1 < len(text) and text[i + 1] == "'":
                out.append("'")
                i += 2
                continue
            return i + 1, "".join(out)
        out.append(ch)
        i += 1
    raise EvidenceError("unterminated string literal")


class Literal:
    """One string-literal chain, with everything decoding needs."""

    def __init__(
        self,
        start: int,
        end: int,
        value: str,
        decodable: bool,
    ) -> None:
        self.start = start
        self.end = end
        self.value = value
        self.decodable = decodable


def _scan_literal_chain(text: str, i: int) -> Literal:
    """Scan a literal and every continuation segment joined to it.

    PostgreSQL concatenates adjacent string constants when the whitespace
    between them contains a newline; a vertical tab is ordinary whitespace on
    either side of that newline but is never itself the newline. A
    continuation segment carries no prefix of its own and inherits the
    chain's escape mode.
    """
    head = _literal_prefix(text, i)
    if head is None:  # pragma: no cover - callers check first
        raise EvidenceError("not a string literal")
    quote, kind = head
    escape = kind == "escape"
    decodable = kind != "unicode"
    parts: list[str] = []
    pos = quote
    end = i
    while True:
        end, body = _scan_quoted_segment(text, pos, escape)
        if "\\" in body:
            decodable = False
        parts.append(body)
        j = end
        saw_newline = False
        while j < len(text) and text[j] in SPACE_CHARS:
            if text[j] == "\n":
                saw_newline = True
            j += 1
        nxt = _literal_prefix(text, j) if j < len(text) else None
        if not (saw_newline and nxt is not None):
            break
        if nxt[1] != "ordinary":
            # PostgreSQL rejects a prefixed continuation segment outright, so
            # the text cannot be attributed to a compilable statement.
            decodable = False
        pos = nxt[0]
    return Literal(i, end, "".join(parts), decodable)


class Masked:
    """A masked view of SQL text, offset-for-offset with the original."""

    def __init__(self, raw: str) -> None:
        self.raw = raw
        self.text = ""
        self.literals: dict[int, Literal] = {}
        self.comments: dict[int, int] = {}
        self.dollar_bodies: dict[int, tuple[int, int]] = {}
        self._mask()

    def _blank(self, start: int, end: int) -> str:
        return "".join(
            "\n" if ch == "\n" else " " for ch in self.raw[start:end]
        )

    def _mask(self) -> None:
        raw = self.raw
        out: list[str] = []
        i = 0
        n = len(raw)
        while i < n:
            ch = raw[i]
            if ch == "-" and raw.startswith("--", i):
                j = raw.find("\n", i)
                j = n if j < 0 else j
                self.comments[i] = j
                out.append(self._blank(i, j))
                i = j
                continue
            if ch == "/" and raw.startswith("/*", i):
                depth = 1
                j = i + 2
                while j < n and depth:
                    if raw.startswith("/*", j):
                        depth += 1
                        j += 2
                    elif raw.startswith("*/", j):
                        depth -= 1
                        j += 2
                    else:
                        j += 1
                if depth:
                    raise EvidenceError("unterminated block comment")
                self.comments[i] = j
                out.append(self._blank(i, j))
                i = j
                continue
            if ch == '"':
                j = i + 1
                while j < n:
                    if raw[j] == '"':
                        if j + 1 < n and raw[j + 1] == '"':
                            j += 2
                            continue
                        break
                    j += 1
                if j >= n:
                    raise EvidenceError("unterminated quoted identifier")
                # Keep the delimiters so the token survives; blank the content
                # so a column aliased "RAISE" is not executable syntax.
                out.append('"')
                out.append(self._blank(i + 1, j))
                out.append('"')
                i = j + 1
                continue
            if ch == "$":
                tag = _read_dollar_tag(raw, i)
                if tag is not None:
                    name, after = tag
                    close = raw.find(name, after)
                    if close < 0:
                        raise EvidenceError("unterminated dollar string")
                    self.dollar_bodies[i] = (after, close)
                    end = close + len(name)
                    out.append(self._blank(i, end))
                    i = end
                    continue
            prefix = _literal_prefix(raw, i)
            if prefix is not None and not self._in_identifier(i):
                literal = _scan_literal_chain(raw, i)
                self.literals[i] = literal
                out.append(self._blank(literal.start, literal.end))
                i = literal.end
                continue
            out.append(ch)
            i += 1
        self.text = "".join(out)

    def _in_identifier(self, i: int) -> bool:
        """``E`` / ``U`` only introduce a literal at a token boundary."""
        if self.raw[i] == "'":
            return False
        if i == 0:
            return False
        prev = self.raw[i - 1]
        return prev in ASCII_LETTERS or prev in DIGITS or prev == "_"

    def skip_gap(self, i: int) -> int:
        """Skip whitespace and comments from ``i`` in the raw text."""
        while i < len(self.raw):
            if self.raw[i] in SPACE_CHARS:
                i += 1
                continue
            if i in self.comments:
                i = self.comments[i]
                continue
            break
        return i


# ---------------------------------------------------------------------------
# Token layer
# ---------------------------------------------------------------------------

_WORD_START = r"A-Za-z_\u0080-\U0010ffff"
_WORD_CONT = r"A-Za-z_0-9$\u0080-\U0010ffff"
TOKEN_RE = re.compile(
    r'(?P<word>[' + _WORD_START + r'][' + _WORD_CONT + r']*)'
    r'|(?P<qident>"(?:[^"]|"")*")'
    r"|(?P<num>\d+)"
    r"|(?P<op><<|>>|:=|::|\.\.|.)",
    re.S,
)


class Token:
    __slots__ = ("kind", "text", "start", "end")

    def __init__(self, kind: str, text: str, start: int, end: int) -> None:
        self.kind = kind
        self.text = text
        self.start = start
        self.end = end

    @property
    def upper(self) -> str:
        return self.text.upper()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Token({self.kind},{self.text!r},{self.start})"


def tokenize(
    masked: str, start: int = 0, end: int | None = None
) -> list[Token]:
    end = len(masked) if end is None else end
    tokens: list[Token] = []
    for match in TOKEN_RE.finditer(masked, start, end):
        kind = match.lastgroup
        text = match.group()
        if kind == "op" and text.strip() == "":
            continue
        tokens.append(Token(kind, text, match.start(), match.end()))
    return tokens


BLOCK_START_WORDS = {"IF", "CASE"}
EFFECT_WORDS = {
    "UPDATE",
    "INSERT",
    "DELETE",
    "MERGE",
    "TRUNCATE",
    "EXECUTE",
    "CALL",
    "COPY",
    "CREATE",
    "DROP",
    "ALTER",
    "GRANT",
    "REVOKE",
    "SELECT",
    "REFRESH",
    "LOCK",
    "COMMIT",
    "ROLLBACK",
}

NON_CALL_WORDS = {
    "IF",
    "ELSIF",
    "ELSE",
    "THEN",
    "END",
    "BEGIN",
    "DECLARE",
    "EXCEPTION",
    "WHEN",
    "LOOP",
    "WHILE",
    "FOR",
    "FOREACH",
    "IN",
    "EXIT",
    "CONTINUE",
    "RETURN",
    "RAISE",
    "PERFORM",
    "NOT",
    "AND",
    "OR",
    "IS",
    "NULL",
    "TRUE",
    "FALSE",
    "CASE",
    "USING",
    "ERRCODE",
    "MESSAGE",
    "HINT",
    "DETAIL",
    "SQLSTATE",
    "VALUES",
    "SET",
    "INTO",
    "STRICT",
    "FROM",
    "WHERE",
    "AS",
    "ON",
    "BY",
    "DEFAULT",
    "NOTICE",
    "WARNING",
    "DEBUG",
    "LOG",
    "INFO",
    "ATOMIC",
    "LANGUAGE",
    "RETURNS",
    "VOID",
    "SECURITY",
    "DEFINER",
    "INVOKER",
    "REPLACE",
    "FUNCTION",
    "PROCEDURE",
    "OR",
    "ARRAY",
    "ROW",
}
NON_CALL_WORDS |= EFFECT_WORDS


def has_call(tokens: list[Token]) -> bool:
    """True when any non-keyword identifier is applied to an argument list."""
    for index, token in enumerate(tokens):
        if token.kind != "word":
            continue
        if token.upper in NON_CALL_WORDS:
            continue
        nxt = tokens[index + 1] if index + 1 < len(tokens) else None
        if nxt is not None and nxt.text == "(":
            return True
    return False


# Punctuation that carries no computation of its own. Every OTHER operator
# is backed by a function -- a user-defined operator explicitly, a cast
# between custom types potentially -- so none of them is proven effectless.
SAFE_OPERATORS = {";", ",", ".", "(", ")", ":=", "<<", ">>"}


def is_effectless(tokens: list[Token]) -> bool:
    """Proven effectless, not merely free of ``name(...)``.

    An allowlist: an effect keyword, a call, or any operator beyond plain
    punctuation leaves the span unproven. A VOLATILE function reached through
    an operator or a cast runs just as surely as one reached through a call.
    """
    for index, token in enumerate(tokens):
        if token.kind in ("num", "qident"):
            continue
        if token.kind == "word":
            if token.upper in EFFECT_WORDS:
                return False
            nxt = tokens[index + 1] if index + 1 < len(tokens) else None
            if (
                nxt is not None
                and nxt.text == "("
                and token.upper not in NON_CALL_WORDS
            ):
                return False
            continue
        if token.text in SAFE_OPERATORS:
            continue
        return False
    return True


# ---------------------------------------------------------------------------
# PostgreSQL identifier identity (block labels only, in this slice)
# ---------------------------------------------------------------------------


def _ascii_lower(text: str) -> str:
    return "".join(ch.lower() if "A" <= ch <= "Z" else ch for ch in text)


def _clip_namedatalen(text: str) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= NAMEDATALEN_LIMIT:
        return text
    clipped = encoded[:NAMEDATALEN_LIMIT]
    while clipped:
        try:
            return clipped.decode("utf-8")
        except UnicodeDecodeError:
            clipped = clipped[:-1]
    return ""


def canonical_label(raw_token: str) -> str:
    """PostgreSQL identity for a block label: fold ASCII only, then clip."""
    if raw_token.startswith('"') and raw_token.endswith('"'):
        return _clip_namedatalen(raw_token[1:-1].replace('""', '"'))
    return _clip_namedatalen(_ascii_lower(raw_token))


def _read_label(masked: Masked, token: Token) -> str | None:
    if token.kind == "word":
        return canonical_label(token.text)
    if token.kind == "qident":
        return canonical_label(masked.raw[token.start : token.end])
    return None


# ---------------------------------------------------------------------------
# Statement and block structure
# ---------------------------------------------------------------------------


class Statement:
    def __init__(self, index: int, start: int, end: int) -> None:
        self.index = index
        self.start = start
        self.end = end


_ATOMIC_RE = re.compile(r"\bBEGIN\s+ATOMIC\b", re.IGNORECASE)


def split_statements(masked: Masked) -> list[Statement]:
    """Split on top-level semicolons, keeping a BEGIN ATOMIC body together."""
    text = masked.text
    fragments: list[tuple[int, int]] = []
    start = 0
    for index, ch in enumerate(text):
        if ch == ";":
            fragments.append((start, index + 1))
            start = index + 1
    if text[start:].strip():
        fragments.append((start, len(text)))

    statements: list[Statement] = []
    pending: tuple[int, int] | None = None
    for span in fragments:
        if pending is None:
            if not text[span[0] : span[1]].strip():
                continue
            pending = span
        else:
            pending = (pending[0], span[1])
        body = text[pending[0] : pending[1]]
        if _ATOMIC_RE.search(body) and not re.search(
            r"\bEND\b\s*;?\s*$", body, re.IGNORECASE
        ):
            continue
        statements.append(Statement(len(statements) + 1, *pending))
        pending = None
    if pending is not None:
        statements.append(Statement(len(statements) + 1, *pending))
    return statements


CREATE_RE = re.compile(
    r"\bCREATE\b(?:\s+OR\s+REPLACE)?\s+(?P<kind>FUNCTION|PROCEDURE)\s+"
    r"(?P<name>(?:\"(?:[^\"]|\"\")*\"|[^\s(\"]+)(?:\.(?:\"(?:[^\"]|\"\")*\"|[^\s(\"]+))*)"
    r"\s*\(",
    re.IGNORECASE,
)
LANGUAGE_RE = re.compile(
    r"\bLANGUAGE\s+([A-Za-z_][A-Za-z_0-9]*)", re.IGNORECASE
)


class Routine:
    def __init__(self) -> None:
        self.schema = ""
        self.name = ""
        self.arguments = ""
        self.kind = "FUNCTION"
        self.language = ""
        self.body_span: tuple[int, int] | None = None


def parse_routine(masked: Masked, statement: Statement) -> Routine | None:
    text = masked.text
    match = CREATE_RE.search(text, statement.start, statement.end)
    if match is None:
        return None
    routine = Routine()
    routine.kind = match.group("kind").upper()
    qualified = match.group("name")
    parts = _split_qualified(qualified)
    routine.name = parts[-1]
    routine.schema = parts[-2] if len(parts) > 1 else ""

    open_paren = match.end() - 1
    depth = 0
    close = open_paren
    for index in range(open_paren, statement.end):
        if text[index] == "(":
            depth += 1
        elif text[index] == ")":
            depth -= 1
            if depth == 0:
                close = index
                break
    routine.arguments = masked.raw[open_paren + 1 : close]

    language = LANGUAGE_RE.search(text, close, statement.end)
    routine.language = language.group(1).lower() if language else ""
    routine.body_span = _definition_span(masked, statement, close)
    return routine


def _definition_span(
    masked: Masked, statement: Statement, close: int
) -> tuple[int, int] | None:
    """The dollar-quoted body introduced by this statement's own ``AS``.

    CREATE FUNCTION takes its options in any order and an option value may
    itself be a string constant, so a dollar-quoted literal can legally
    precede AS. Taking the first one after the parameter list would read that
    option as the routine's body. More than one top-level AS, or a definition
    that is not dollar-quoted, is not an attribution this producer can prove.
    """
    depth = 0
    positions: list[int] = []
    for token in tokenize(masked.text, close + 1, statement.end):
        if token.text == "(":
            depth += 1
        elif token.text == ")":
            depth -= 1
        elif token.kind == "word" and token.upper == "AS" and depth == 0:
            positions.append(token.end)
    if len(positions) != 1:
        return None
    return masked.dollar_bodies.get(masked.skip_gap(positions[0]))


def _split_qualified(text: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    in_quote = False
    index = 0
    while index < len(text):
        ch = text[index]
        if ch == '"':
            in_quote = not in_quote
            current.append(ch)
        elif ch == "." and not in_quote:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
        index += 1
    parts.append("".join(current))
    return parts


def _fold_identifier(text: str) -> str:
    text = text.strip()
    if text.startswith('"') and text.endswith('"') and len(text) >= 2:
        return text[1:-1].replace('""', '"')
    return _ascii_lower(text)


def _normalize_arguments(text: str) -> str:
    return _ascii_lower(" ".join(text.split()))


class Block:
    """One PL/pgSQL block: its label, declarations, statements, handlers."""

    def __init__(self) -> None:
        self.label: str | None = None
        self.declarations: list[Token] = []
        self.statements: list[list[Token]] = []
        self.handler_conditions: list[list[Token]] = []


def parse_block(masked: Masked, tokens: list[Token]) -> Block:
    """Parse ``[<<label>>] [DECLARE ...] BEGIN ... [EXCEPTION ...] END``."""
    block = Block()
    index = 0
    if index < len(tokens) and tokens[index].text == "<<":
        label_token = tokens[index + 1] if index + 1 < len(tokens) else None
        if label_token is not None:
            block.label = _read_label(masked, label_token)
        while index < len(tokens) and tokens[index].text != ">>":
            index += 1
        index += 1
    if index < len(tokens) and tokens[index].upper == "DECLARE":
        start = index + 1
        while index < len(tokens) and tokens[index].upper != "BEGIN":
            index += 1
        block.declarations = tokens[start:index]
    while index < len(tokens) and tokens[index].upper != "BEGIN":
        index += 1
    index += 1

    depth = 0
    paren = 0
    at_start = True
    in_handlers = False
    current: list[Token] = []
    while index < len(tokens):
        token = tokens[index]
        upper = token.upper
        if token.text == "(":
            paren += 1
        elif token.text == ")":
            paren -= 1

        if token.kind == "word" and paren == 0:
            if upper == "END":
                nxt = tokens[index + 1] if index + 1 < len(tokens) else None
                if nxt is not None and nxt.upper in ("IF", "LOOP", "CASE"):
                    current.append(token)
                    current.append(nxt)
                    depth -= 1
                    index += 2
                    at_start = False
                    continue
                if depth == 0:
                    break
                depth -= 1
            elif upper == "BEGIN":
                depth += 1
            elif upper in BLOCK_START_WORDS and at_start:
                depth += 1
            elif upper == "LOOP":
                depth += 1
            elif upper == "EXCEPTION" and depth == 0 and at_start:
                in_handlers = True
                if current and any(t.kind != "op" for t in current):
                    block.statements.append(current)
                current = []
                index += 1
                at_start = True
                continue

        if token.text == ";" and depth == 0 and paren == 0:
            if in_handlers:
                if current:
                    block.handler_conditions.append(current)
                current = []
            else:
                if any(t.kind != "op" or t.text != ";" for t in current):
                    block.statements.append(current)
                current = []
            at_start = True
            index += 1
            continue

        current.append(token)
        at_start = token.text in (";",) or (
            token.kind == "word" and upper in ("THEN", "ELSE", "LOOP", "BEGIN")
        )
        index += 1

    if not in_handlers and current and any(t.kind != "op" for t in current):
        block.statements.append(current)

    block.handler_conditions = [
        _handler_condition(clause) for clause in block.handler_conditions
    ]
    block.handler_conditions = [c for c in block.handler_conditions if c]
    return block


def _handler_condition(clause: list[Token]) -> list[Token]:
    """The condition of one ``WHEN <condition> THEN ...`` clause."""
    out: list[Token] = []
    started = False
    for token in clause:
        if token.kind == "word" and token.upper == "WHEN" and not started:
            started = True
            continue
        if token.kind == "word" and token.upper == "THEN":
            break
        if started:
            out.append(token)
    return out


# ---------------------------------------------------------------------------
# Exception-handler analysis
# ---------------------------------------------------------------------------

NON_CATCHING_CONDITIONS = {
    "unique_violation",
    "foreign_key_violation",
    "check_violation",
    "not_null_violation",
    "exclusion_violation",
    "division_by_zero",
    "no_data_found",
    "too_many_rows",
}

CATCHING_CONDITIONS = {"others", "raise_exception", "plpgsql_error"}


def _sqlstate_catches(code: str) -> bool:
    return code.upper() in ("P0001", "P0000")


def handler_can_catch(masked: Masked, condition: list[Token]) -> bool:
    """True when this WHEN condition can catch a P0001 authorization failure.

    Anything this reader cannot resolve is reported as catching: an identity
    it cannot prove must never be reported as non-catching.
    """
    index = 0
    while index < len(condition):
        token = condition[index]
        if token.kind == "word" and token.upper == "OR":
            index += 1
            continue
        if token.kind == "word" and token.upper == "SQLSTATE":
            literal_start = masked.skip_gap(token.end)
            literal = masked.literals.get(literal_start)
            if literal is not None:
                if not literal.decodable:
                    return True
                if _sqlstate_catches(literal.value):
                    return True
                index += 1
                continue
            tag = _read_dollar_tag(masked.raw, literal_start)
            if tag is not None and literal_start in masked.dollar_bodies:
                body = masked.dollar_bodies[literal_start]
                value = masked.raw[body[0] : body[1]]
                if _sqlstate_catches(value):
                    return True
                index += 1
                continue
            return True
        if token.kind == "word":
            name = _ascii_lower(token.text)
            if name in CATCHING_CONDITIONS:
                return True
            if name not in NON_CATCHING_CONDITIONS:
                return True
            index += 1
            continue
        if token.kind == "qident":
            body = masked.raw[token.start + 1 : token.end - 1]
            name = body.replace('""', '"')
            if name in CATCHING_CONDITIONS:
                return True
            if name not in NON_CATCHING_CONDITIONS:
                # A quoted identifier keeps its case, so a wrong-case spelling
                # resolves to no condition at all: fail closed.
                return True
            index += 1
            continue
        index += 1
    return False


# ---------------------------------------------------------------------------
# Guard candidates
# ---------------------------------------------------------------------------


class Candidate:
    def __init__(
        self,
        bare: str,
        schema: str | None,
        kind: str,
        name_token: Token,
        args: list[tuple[int, int]],
        call_start: int,
        call_end: int,
    ) -> None:
        self.bare = bare
        self.schema = schema
        self.kind = kind
        self.name_token = name_token
        self.args = args
        self.call_start = call_start
        self.call_end = call_end


class Helper:
    def __init__(self, identity: str, kind: str) -> None:
        schema_name, _, rest = identity.partition("(")
        self.schema, _, self.name = schema_name.rpartition(".")
        self.arg_types = tuple(
            part.strip()
            for part in rest.rstrip(")").split(",")
            if part.strip()
        )
        self.kind = kind
        self.mechanism = f"{self.schema}.{self.name}"


def _match_parens(tokens: list[Token], open_index: int) -> int:
    depth = 0
    for index in range(open_index, len(tokens)):
        if tokens[index].text == "(":
            depth += 1
        elif tokens[index].text == ")":
            depth -= 1
            if depth == 0:
                return index
    return -1


def find_candidates(
    tokens: list[Token], helpers: dict[str, Helper]
) -> list[Candidate]:
    """Recognized helper NAMES applied to an argument list, at any depth."""
    candidates: list[Candidate] = []
    for index, token in enumerate(tokens):
        if token.kind != "word":
            continue
        bare = _ascii_lower(token.text)
        if bare not in helpers:
            continue
        nxt = tokens[index + 1] if index + 1 < len(tokens) else None
        if nxt is None or nxt.text != "(":
            continue
        schema: str | None = None
        if index >= 2 and tokens[index - 1].text == ".":
            qualifier = tokens[index - 2]
            if qualifier.kind == "word":
                schema = _ascii_lower(qualifier.text)
            elif qualifier.kind == "qident":
                schema = qualifier.text[1:-1]
        close = _match_parens(tokens, index + 1)
        if close < 0:
            continue
        args: list[tuple[int, int]] = []
        depth = 0
        arg_start = tokens[index + 1].end
        for inner in range(index + 1, close + 1):
            item = tokens[inner]
            if item.text == "(":
                depth += 1
                continue
            if item.text == ")":
                depth -= 1
                if depth == 0:
                    if masked_has_content(arg_start, item.start):
                        args.append((arg_start, item.start))
                continue
            if item.text == "," and depth == 1:
                args.append((arg_start, item.start))
                arg_start = item.end
        call_start = (
            tokens[index - 2].start
            if schema is not None and index >= 2
            else token.start
        )
        candidates.append(
            Candidate(
                bare,
                schema,
                helpers[bare].kind,
                token,
                args,
                call_start,
                tokens[close].end,
            )
        )
    return candidates


def masked_has_content(start: int, end: int) -> bool:
    return end > start


STR_RE = re.compile(r"^\s*(?:[EeUu]&?)?'.*'\s*$", re.S)


def infer_argument_type(
    masked: Masked,
    span: tuple[int, int],
    scope: dict[str, str],
) -> str | None:
    """The argument's type, and only for a form that is proven effectless.

    A bare parameter or variable reference and a literal are the only shapes
    whose evaluation cannot reach a function. Anything else -- a cast, an
    operator, a CASE, a call -- may run code before the helper is entered, so
    it is on the wrong side of the authorization boundary and is refused
    here whatever type it would carry.
    """
    raw = masked.raw[span[0] : span[1]].strip()
    tokens = tokenize(masked.text, span[0], span[1])
    if not tokens:
        # The whole argument was masked away, so it was a literal.
        if STR_RE.match(raw):
            # An untyped literal is `unknown`, which PostgreSQL resolves to
            # text in preference to anything else.
            return "text"
        return None
    if len(tokens) != 1:
        return None
    token = tokens[0]
    if token.kind == "num":
        return "integer"
    if token.kind == "word":
        return scope.get(_ascii_lower(token.text))
    return None


def parse_parameters(arguments: str) -> dict[str, str]:
    scope: dict[str, str] = {}
    for part in arguments.split(","):
        words = part.split()
        if len(words) >= 2:
            scope[_ascii_lower(words[0])] = _fold_identifier(words[-1])
    return scope


def parse_declarations(masked: Masked, tokens: list[Token]) -> dict[str, str]:
    scope: dict[str, str] = {}
    current: list[Token] = []
    for token in tokens:
        if token.text == ";":
            _record_declaration(current, scope)
            current = []
            continue
        current.append(token)
    _record_declaration(current, scope)
    return scope


def _record_declaration(tokens: list[Token], scope: dict[str, str]) -> None:
    words = [t for t in tokens if t.kind == "word"]
    if len(words) >= 2:
        scope[_ascii_lower(words[0].text)] = _fold_identifier(words[1].text)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

RAISE_BARE = ("RAISE", "EXCEPTION")


def _statement_words(tokens: list[Token]) -> list[str]:
    return [t.upper for t in tokens if t.kind == "word"]


def _is_bare_raise_exception(tokens: list[Token]) -> bool:
    """Only ``RAISE EXCEPTION '<message>';`` proves a denial."""
    words = _statement_words(tokens)
    if words != list(RAISE_BARE):
        return False
    return all(t.kind == "word" or t.text.strip() == "" for t in tokens)


def _contains_return(tokens: list[Token]) -> bool:
    return any(t.kind == "word" and t.upper == "RETURN" for t in tokens)


def _exits_label(
    masked: Masked, tokens: list[Token], label: str | None
) -> bool:
    if label is None:
        return False
    for index, token in enumerate(tokens):
        if token.kind != "word" or token.upper != "EXIT":
            continue
        nxt = tokens[index + 1] if index + 1 < len(tokens) else None
        if nxt is None:
            continue
        target = _read_label(masked, nxt)
        if target is not None and target == label:
            return True
    return False


def _head_word(tokens: list[Token]) -> str:
    for token in tokens:
        if token.kind == "word":
            return token.upper
    return ""


def _split_top_level_or(tokens: list[Token]) -> list[list[Token]]:
    disjuncts: list[list[Token]] = []
    current: list[Token] = []
    depth = 0
    for token in tokens:
        if token.text == "(":
            depth += 1
        elif token.text == ")":
            depth -= 1
        if depth == 0 and token.kind == "word" and token.upper == "OR":
            disjuncts.append(current)
            current = []
            continue
        current.append(token)
    disjuncts.append(current)
    return disjuncts


def _strip_parens(tokens: list[Token]) -> list[Token]:
    while (
        len(tokens) >= 2
        and tokens[0].text == "("
        and tokens[-1].text == ")"
        and _match_parens(tokens, 0) == len(tokens) - 1
    ):
        tokens = tokens[1:-1]
    return tokens


def _condition_tokens(tokens: list[Token]) -> list[Token]:
    """The condition of an ``IF <condition> THEN`` statement."""
    out: list[Token] = []
    for token in tokens[1:]:
        if token.kind == "word" and token.upper == "THEN":
            break
        out.append(token)
    return out


def _then_branch(tokens: list[Token]) -> list[list[Token]]:
    """Statements of the THEN branch, stopping at ELSIF/ELSE/END IF."""
    index = 0
    while index < len(tokens):
        if tokens[index].kind == "word" and tokens[index].upper == "THEN":
            index += 1
            break
        index += 1
    statements: list[list[Token]] = []
    current: list[Token] = []
    depth = 0
    paren = 0
    at_start = True
    while index < len(tokens):
        token = tokens[index]
        upper = token.upper
        if token.text == "(":
            paren += 1
        elif token.text == ")":
            paren -= 1
        if token.kind == "word" and paren == 0:
            if upper == "END":
                nxt = tokens[index + 1] if index + 1 < len(tokens) else None
                if nxt is not None and nxt.upper in ("IF", "LOOP", "CASE"):
                    if depth == 0:
                        break
                    current.extend((token, nxt))
                    depth -= 1
                    index += 2
                    continue
                if depth == 0:
                    break
                depth -= 1
            elif upper in ("ELSIF", "ELSE") and depth == 0:
                break
            elif upper == "BEGIN":
                depth += 1
            elif upper in BLOCK_START_WORDS and at_start:
                depth += 1
            elif upper == "LOOP":
                depth += 1
        if token.text == ";" and depth == 0 and paren == 0:
            if any(t.kind != "op" for t in current):
                statements.append(current)
            current = []
            at_start = True
            index += 1
            continue
        current.append(token)
        at_start = token.kind == "word" and upper in (
            "THEN",
            "ELSE",
            "LOOP",
            "BEGIN",
        )
        index += 1
    if any(t.kind != "op" for t in current):
        statements.append(current)
    return statements


class Analysis:
    def __init__(self) -> None:
        self.status = "ABSENT"
        self.mechanism: str | None = None
        self.proof_class: str | None = None
        self.offset: int | None = None


def analyse_body(
    masked: Masked,
    helpers: dict[str, Helper],
    parameters: dict[str, str],
) -> Analysis:
    result = Analysis()
    tokens = tokenize(masked.text)
    all_candidates = find_candidates(tokens, helpers)
    if not all_candidates:
        return result

    block = parse_block(masked, tokens)
    scope = dict(parameters)
    scope.update(parse_declarations(masked, block.declarations))

    handlers_catch = any(
        handler_can_catch(masked, condition)
        for condition in block.handler_conditions
    )
    declarations_clean = is_effectless(block.declarations)

    ambiguous = any(
        candidate.schema is None for candidate in all_candidates
    )

    for position, statement in enumerate(block.statements):
        proof = _prove_statement(
            masked, statement, helpers, scope, block, position, handlers_catch
        )
        if proof is None:
            continue
        if not declarations_clean:
            continue
        result.status = "PROVEN"
        result.mechanism, result.proof_class, result.offset = proof
        return result

    result.status = "AMBIGUOUS" if ambiguous else "UNKNOWN"
    return result


def _prove_statement(
    masked: Masked,
    statement: list[Token],
    helpers: dict[str, Helper],
    scope: dict[str, str],
    block: Block,
    position: int,
    handlers_catch: bool,
) -> tuple[str, str, int] | None:
    candidates = find_candidates(statement, helpers)
    if not candidates:
        return None
    if handlers_catch:
        return None
    if not _reachable(masked, block, position):
        return None

    head = _head_word(statement)
    if head == "PERFORM":
        return _prove_raising(masked, statement, candidates, helpers, scope)
    if head == "IF":
        return _prove_boolean(masked, statement, candidates, helpers, scope)
    return None


def _reachable(masked: Masked, block: Block, position: int) -> bool:
    """Every earlier outer-level statement must leave the guard reachable."""
    for earlier in block.statements[:position]:
        if _contains_return(earlier):
            return False
        if _head_word(earlier) == "RAISE":
            return False
        if _exits_label(masked, earlier, block.label):
            return False
        if not is_effectless(earlier):
            return False
    return True


def _resolves_to_helper(
    masked: Masked,
    candidate: Candidate,
    helper: Helper,
    scope: dict[str, str],
) -> bool:
    if candidate.schema != helper.schema:
        return False
    if len(candidate.args) != len(helper.arg_types):
        return False
    for span, expected in zip(candidate.args, helper.arg_types):
        if infer_argument_type(masked, span, scope) != expected:
            return False
    return True


def _prove_raising(
    masked: Masked,
    statement: list[Token],
    candidates: list[Candidate],
    helpers: dict[str, Helper],
    scope: dict[str, str],
) -> tuple[str, str, int] | None:
    for candidate in candidates:
        helper = helpers[candidate.bare]
        if helper.kind != "RAISING_ASSERTION":
            continue
        if not _is_standalone_perform(masked, statement, candidate):
            continue
        if not _resolves_to_helper(masked, candidate, helper, scope):
            continue
        return helper.mechanism, PROOF_RAISING, candidate.name_token.start
    return None


def _is_standalone_perform(
    masked: Masked, statement: list[Token], candidate: Candidate
) -> bool:
    """``PERFORM <call>`` and nothing else: the call must BE the statement."""
    words = [t for t in statement if t.kind == "word"]
    if not words or words[0].upper != "PERFORM":
        return False
    if statement[0] is not words[0]:
        return False
    leading = masked.text[statement[0].end : candidate.call_start]
    if leading.strip():
        return False
    trailing = masked.text[candidate.call_end : statement[-1].end]
    return not trailing.strip(";").strip()


def _prove_boolean(
    masked: Masked,
    statement: list[Token],
    candidates: list[Candidate],
    helpers: dict[str, Helper],
    scope: dict[str, str],
) -> tuple[str, str, int] | None:
    condition = _condition_tokens(statement)
    if not condition:
        return None
    disjuncts = _split_top_level_or(condition)
    negated: Candidate | None = None
    for disjunct in disjuncts:
        stripped = _strip_parens(disjunct)
        inner = find_candidates(stripped, helpers)
        if not inner:
            # Another term of the same condition is evaluated around the
            # membership boundary, and SQL does not guarantee which operand
            # of an OR runs first.
            if not is_effectless(stripped):
                return None
            continue
        if len(inner) != 1:
            return None
        candidate = inner[0]
        helper = helpers[candidate.bare]
        if helper.kind != "BOOLEAN_DENY":
            return None
        words = [t for t in stripped if t.kind == "word"]
        if not words or words[0].upper != "NOT":
            return None
        leading = masked.text[stripped[0].end : candidate.call_start]
        if stripped[0].upper != "NOT" or leading.strip():
            return None
        trailing = masked.text[candidate.call_end : stripped[-1].end]
        if trailing.strip():
            return None
        if negated is not None:
            return None
        negated = candidate
    if negated is None:
        return None

    helper = helpers[negated.bare]
    if not _resolves_to_helper(masked, negated, helper, scope):
        return None

    branch = _then_branch(statement)
    if not branch or not _is_bare_raise_exception(branch[0]):
        return None
    return helper.mechanism, PROOF_BOOLEAN, negated.name_token.start


# ---------------------------------------------------------------------------
# Evidence validation
# ---------------------------------------------------------------------------


def validate_contract(document: Any) -> dict[str, Helper]:
    if not isinstance(document, dict):
        raise EvidenceError("guard contract evidence must be an object")
    if set(document) != CONTRACT_DOC_KEYS:
        raise EvidenceError("guard contract evidence has unexpected keys")
    if document["scanner"] != CONTRACT_SCANNER:
        raise EvidenceError("guard contract evidence has the wrong producer")
    if document["status"] != "PROVEN":
        raise EvidenceError("guard contract evidence is not PROVEN")
    entries = document["helpers"]
    if not isinstance(entries, list):
        raise EvidenceError("guard contract helpers must be a list")
    if document["helper_count"] != len(entries):
        raise EvidenceError("guard contract helper_count disagrees")
    observed: dict[str, str] = {}
    for entry in entries:
        expected = {"identity", "guard_kind"}
        if not isinstance(entry, dict) or set(entry) != expected:
            raise EvidenceError("guard contract helper entry is malformed")
        identity = entry["identity"]
        if identity in observed:
            raise EvidenceError("guard contract lists a duplicate helper")
        observed[identity] = entry["guard_kind"]
    if observed != EXPECTED_HELPERS:
        raise EvidenceError("guard contract helper set is not reviewed")
    if document["exception_semantics"] != EXPECTED_EXCEPTION_SEMANTICS:
        raise EvidenceError("guard contract exception semantics have drifted")

    helpers: dict[str, Helper] = {}
    for identity, kind in EXPECTED_HELPERS.items():
        helper = Helper(identity, kind)
        helpers[helper.name] = helper
    return helpers


def validate_bindings(document: Any) -> list[dict[str, Any]]:
    if not isinstance(document, dict):
        raise EvidenceError("binding evidence must be an object")
    if set(document) != BINDING_DOC_KEYS:
        raise EvidenceError("binding evidence has unexpected keys")
    if document["scanner"] != BINDING_SCANNER:
        raise EvidenceError("binding evidence has the wrong producer")
    if document["status"] != "RESOLVED":
        raise EvidenceError("binding evidence is not RESOLVED")
    bindings = document["bindings"]
    if not isinstance(bindings, list):
        raise EvidenceError("binding evidence bindings must be a list")
    if document["binding_count"] != len(bindings):
        raise EvidenceError("binding evidence binding_count disagrees")
    if document["candidate_count"] != len(bindings):
        raise EvidenceError("binding evidence candidate_count disagrees")
    seen: set[int] = set()
    for binding in bindings:
        oid = binding["catalog_oid"]
        if oid in seen:
            raise EvidenceError("binding evidence repeats a catalog OID")
        seen.add(oid)
    return bindings


def check_identity(binding: dict[str, Any], routine: Routine) -> None:
    bound_name = _fold_identifier(binding["source_name"])
    if _fold_identifier(routine.name) != bound_name:
        raise EvidenceError("binding names a routine the source does not")
    if _fold_identifier(routine.schema) != _fold_identifier(
        binding["source_schema"]
    ):
        raise EvidenceError("binding names a different schema than the source")
    if _normalize_arguments(routine.arguments) != _normalize_arguments(
        binding["source_arguments"]
    ):
        raise EvidenceError("binding signature disagrees with the source")
    if routine.kind != str(binding["source_kind"]).upper():
        raise EvidenceError("binding routine kind disagrees with the source")
    expected_prokind = "p" if routine.kind == "PROCEDURE" else "f"
    if binding["catalog_prokind"] != expected_prokind:
        raise EvidenceError("binding prokind disagrees with the source")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def produce(
    source: str, bindings_doc: Any, contract_doc: Any
) -> dict[str, Any]:
    helpers = validate_contract(contract_doc)
    bindings = validate_bindings(bindings_doc)

    masked = Masked(source)
    statements = split_statements(masked)

    records: list[dict[str, Any]] = []
    for binding in bindings:
        index = binding["statement_index"]
        if not 1 <= index <= len(statements):
            raise EvidenceError("binding names a statement the source lacks")
        statement = statements[index - 1]
        routine = parse_routine(masked, statement)
        if routine is None:
            raise EvidenceError("bound statement is not a routine")
        check_identity(binding, routine)

        status = "UNKNOWN"
        mechanism: str | None = None
        proof_class: str | None = None
        location: str | None = None

        if routine.language == "plpgsql" and routine.body_span is not None:
            body_raw = masked.raw[routine.body_span[0] : routine.body_span[1]]
            body = Masked(body_raw)
            analysis = analyse_body(
                body, helpers, parse_parameters(routine.arguments)
            )
            status = analysis.status
            if status == "PROVEN":
                mechanism = analysis.mechanism
                proof_class = analysis.proof_class
                location = (
                    f"statement:{index}"
                    f":offset:{routine.body_span[0] + (analysis.offset or 0)}"
                )

        records.append(
            {
                "catalog_oid": binding["catalog_oid"],
                "catalog_identity": binding["catalog_identity"],
                "guard_status": status,
                "guard_mechanism": mechanism,
                "evidence_location": location,
                "proof_class": proof_class,
            }
        )

    return {"scanner": GUARD_SCANNER, "guard_records": records}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--bindings", required=True)
    parser.add_argument("--guard-contract-evidence", required=True)
    args = parser.parse_args(argv)

    try:
        with open(args.source, encoding="utf-8") as handle:
            source = handle.read()
        with open(args.bindings, encoding="utf-8") as handle:
            bindings_doc = json.load(handle)
        with open(args.guard_contract_evidence, encoding="utf-8") as handle:
            contract_doc = json.load(handle)
        payload = produce(source, bindings_doc, contract_doc)
    except EvidenceError as error:
        print(f"{ERROR_MARKER}: {error}", file=sys.stderr)
        return 2
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"{ERROR_MARKER}: {error}", file=sys.stderr)
        return 2

    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
