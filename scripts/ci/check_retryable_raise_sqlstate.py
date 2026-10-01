#!/usr/bin/env python3
"""Reject deliberate transaction-retry SQLSTATEs in installed PL/pgSQL functions.

PostgREST 14 retries a request whose transaction fails with a serialization
failure (40001). Supabase documents the consequence for custom error codes: a
function that RAISEs 40001 on purpose for a permanent business rejection is
retried without bound, the caller never receives a response, and the backend
spins. This happened with the proposed M196 ISSUE_SETUP_STALE_VERSION
rejection and is corrected by proposed M197 (40001 -> P0001).

This gate keeps that class of defect from coming back. It reads the FINAL
installed function sources (pg_proc.prosrc, after the migration chain), so a
function defined in one migration and replaced in a later one is judged only
by its effective definition. It fails when an installed PL/pgSQL body:

  * raises 40001/40P01 (or serialization_failure/deadlock_detected) through
    USING ERRCODE, RAISE <condition> or RAISE SQLSTATE; or
  * catches one of those conditions by name in an EXCEPTION handler, which
    would reclassify a real engine conflict; or
  * uses a non-literal ERRCODE, whose value cannot be verified statically.

Real engine serialization failures are not raised by user code, so they are
unaffected. Comments are ignored; string literals are kept so ERRCODE values
remain visible. WHEN OTHERS handlers are out of scope here and need review.

Usage:
  psql -XAt -c "<catalog query>" | python3 scripts/ci/check_retryable_raise_sqlstate.py
where the input is a JSON array of {"fn": "<regprocedure>", "src": "<prosrc>"}.
"""
from __future__ import annotations

import json
import re
import sys

RETRYABLE = r"(?:40001|40P01|serialization_failure|deadlock_detected)"
_CODE = rf"'{RETRYABLE}'"
_LEVEL = r"(?:DEBUG|LOG|INFO|NOTICE|WARNING|EXCEPTION)"

ERRCODE_RETRYABLE_RE = re.compile(rf"\bERRCODE\s*(?::=|=)\s*{_CODE}", re.IGNORECASE)
# Lookahead spans the whitespace: "\s*(?!')" would backtrack before a quote.
ERRCODE_NON_LITERAL_RE = re.compile(r"\bERRCODE\s*(?::=|=)(?!\s*')", re.IGNORECASE)
RAISE_CONDITION_RE = re.compile(
    rf"\bRAISE\s+(?:{_LEVEL}\s+)?(?:SQLSTATE\s+{_CODE}|{RETRYABLE}\b)", re.IGNORECASE)
HANDLER_RE = re.compile(
    rf"\bWHEN\b(?:(?!\bTHEN\b)[^;])*?(?:\bSQLSTATE\s+{_CODE}|\b{RETRYABLE}\b)(?:(?!\bTHEN\b)[^;])*?\bTHEN\b",
    re.IGNORECASE)

CHECKS = (
    (ERRCODE_RETRYABLE_RE, "raises a transaction-retry SQLSTATE via ERRCODE"),
    (RAISE_CONDITION_RE, "raises a transaction-retry condition"),
    (HANDLER_RE, "catches a transaction-retry condition by name"),
    (ERRCODE_NON_LITERAL_RE, "uses a non-literal ERRCODE that cannot be verified"),
)


def strip_comments(sql: str) -> str:
    """Blank -- and nested /* */ comments; keep literals, offsets and newlines.

    Dollar-quote delimiters are treated as transparent because the input is a
    function body (code). A nested dollar-quoted literal is therefore scanned as
    code too, which can only over-report (fail closed).
    """
    out = list(sql)
    n = len(sql)
    i = 0

    def blank(start: int, end: int) -> None:
        for k in range(start, end):
            if out[k] != "\n":
                out[k] = " "

    while i < n:
        c = sql[i]
        if sql.startswith("--", i):
            end = sql.find("\n", i)
            end = n if end < 0 else end
            blank(i, end)
            i = end
        elif sql.startswith("/*", i):
            depth, j = 1, i + 2
            while j < n and depth:
                if sql.startswith("/*", j):
                    depth, j = depth + 1, j + 2
                elif sql.startswith("*/", j):
                    depth, j = depth - 1, j + 2
                else:
                    j += 1
            if depth:
                raise ValueError("UNTERMINATED_BLOCK_COMMENT")
            blank(i, j)
            i = j
        elif c == "'":
            escaped = i > 0 and sql[i - 1] in "eE" and (i < 2 or not (sql[i - 2].isalnum() or sql[i - 2] == "_"))
            j = i + 1
            while True:
                if j >= n:
                    raise ValueError("UNTERMINATED_STRING_LITERAL")
                if escaped and sql[j] == "\\":
                    j += 2
                    continue
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            i = j + 1
        elif c == '"':
            j = sql.find('"', i + 1)
            while j >= 0 and j + 1 < n and sql[j + 1] == '"':
                j = sql.find('"', j + 2)
            if j < 0:
                raise ValueError("UNTERMINATED_QUOTED_IDENTIFIER")
            i = j + 1
        else:
            i += 1
    return "".join(out)


def scan_source(src: str) -> list[str]:
    """Return '<line>: <problem>' entries for one PL/pgSQL body."""
    try:
        code = strip_comments(src)
    except ValueError as error:
        return [f"0: cannot lex body ({error})"]
    problems = []
    for pattern, reason in CHECKS:
        for match in pattern.finditer(code):
            line = code.count("\n", 0, match.start()) + 1
            problems.append(f"{line}: {reason}: {' '.join(match.group(0).split())[:80]}")
    return problems


def main() -> int:
    try:
        rows = json.load(sys.stdin)
    except json.JSONDecodeError:
        print("RETRYABLE_SQLSTATE_GATE_INPUT_INVALID", file=sys.stderr)
        return 2
    if not isinstance(rows, list) or not rows or not all(
            isinstance(r, dict) and isinstance(r.get("fn"), str) and isinstance(r.get("src"), str) for r in rows):
        print("RETRYABLE_SQLSTATE_GATE_INPUT_INVALID (expected a non-empty JSON array of {fn, src})", file=sys.stderr)
        return 2
    failures = [f"{r['fn']}:{p}" for r in rows for p in scan_source(r["src"])]
    for failure in failures:
        print(f"RETRYABLE_SQLSTATE_VIOLATION {failure}", file=sys.stderr)
    if failures:
        return 1
    print(f"RETRYABLE_SQLSTATE_GATE_PASS functions={len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
