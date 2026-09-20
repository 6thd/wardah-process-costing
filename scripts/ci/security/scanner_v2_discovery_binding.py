#!/usr/bin/env python3
"""Scanner v2 Slice 2: source discovery -> PostgreSQL catalog binding.

This layer does not replay ACL changes or interpret PL/pgSQL. It discovers
source-owned SECURITY DEFINER routines, binds them to already-produced Slice 1
runtime evidence, and fails closed when identity cannot be proved exactly.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ORACLE_SCANNER = "wardah-scanner-v2-runtime-probe"


@dataclass(frozen=True)
class Candidate:
    statement_index: int
    kind: str
    schema: str
    name: str
    arguments: str

    @property
    def prokind(self) -> str:
        return "p" if self.kind == "PROCEDURE" else "f"


def _mask_noncode(sql: str) -> str:
    """Mask comments/quoted text/dollar bodies while preserving string length."""
    out = list(sql)
    i = 0
    n = len(sql)

    def blank(start: int, end: int) -> None:
        for pos in range(start, end):
            if out[pos] != "\n":
                out[pos] = " "

    while i < n:
        if sql.startswith("--", i):
            end = sql.find("\n", i + 2)
            end = n if end < 0 else end
            blank(i, end)
            i = end
            continue

        if sql.startswith("/*", i):
            start = i
            depth = 1
            i += 2
            while i < n and depth:
                if sql.startswith("/*", i):
                    depth += 1
                    i += 2
                elif sql.startswith("*/", i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            blank(start, i)
            continue

        if sql[i] in ("'", '"'):
            quote = sql[i]
            start = i
            i += 1
            while i < n:
                if sql[i] == quote:
                    if i + 1 < n and sql[i + 1] == quote:
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            blank(start, i)
            continue

        if sql[i] == "$":
            match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", sql[i:])
            if match:
                tag = match.group(0)
                start = i
                close = sql.find(tag, i + len(tag))
                i = n if close < 0 else close + len(tag)
                blank(start, i)
                continue
        i += 1

    return "".join(out)


def _split_statements(sql: str) -> list[str]:
    masked = _mask_noncode(sql)
    statements: list[str] = []
    start = 0
    for index, ch in enumerate(masked):
        if ch == ";":
            piece = sql[start:index].strip()
            if piece:
                statements.append(piece)
            start = index + 1
    tail = sql[start:].strip()
    if tail:
        statements.append(tail)
    return statements


def _strip_leading_comments(statement: str) -> str:
    masked = _mask_noncode(statement)
    match = re.search(r"\S", masked)
    if not match:
        return ""
    return statement[match.start() :]


def _parse_identifier(text: str, pos: int) -> tuple[str, int] | None:
    while pos < len(text) and text[pos].isspace():
        pos += 1
    if pos >= len(text):
        return None

    if text[pos] == '"':
        pos += 1
        chars: list[str] = []
        while pos < len(text):
            if text[pos] == '"':
                if pos + 1 < len(text) and text[pos + 1] == '"':
                    chars.append('"')
                    pos += 2
                    continue
                return "".join(chars), pos + 1
            chars.append(text[pos])
            pos += 1
        return None

    match = re.match(r"[A-Za-z_][A-Za-z0-9_$]*", text[pos:])
    if not match:
        return None
    return match.group(0).lower(), pos + len(match.group(0))


def _matching_paren(text: str, open_pos: int) -> int | None:
    depth = 0
    quote: str | None = None
    i = open_pos
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == quote:
                if i + 1 < len(text) and text[i + 1] == quote:
                    i += 2
                    continue
                quote = None
            i += 1
            continue
        if ch in ("'", '"'):
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
            if depth < 0:
                return None
        i += 1
    return None


def _signature_with_end(
    statement: str, pos: int
) -> tuple[str, str, str, int] | None:
    first = _parse_identifier(statement, pos)
    if first is None:
        return None
    schema, pos = first

    while pos < len(statement) and statement[pos].isspace():
        pos += 1
    if pos >= len(statement) or statement[pos] != ".":
        # Never assume search_path for a security-sensitive binding.
        return None

    second = _parse_identifier(statement, pos + 1)
    if second is None:
        return None
    name, pos = second

    while pos < len(statement) and statement[pos].isspace():
        pos += 1
    if pos >= len(statement) or statement[pos] != "(":
        return None

    close = _matching_paren(statement, pos)
    if close is None:
        return None
    return schema, name, statement[pos + 1 : close].strip(), close + 1


def _signature(statement: str, pos: int) -> tuple[str, str, str] | None:
    parsed = _signature_with_end(statement, pos)
    if parsed is None:
        return None
    schema, name, arguments, _ = parsed
    return schema, name, arguments


def _parse_complete_identity(identity: str) -> tuple[str, str, str] | None:
    parsed = _signature_with_end(identity, 0)
    if parsed is None:
        return None
    schema, name, arguments, end = parsed
    if identity[end:].strip():
        return None
    return schema, name, arguments


def _is_security_definer(statement: str) -> bool:
    return bool(
        re.search(
            r"\bSECURITY\s+DEFINER\b",
            _mask_noncode(statement),
            flags=re.IGNORECASE,
        )
    )


def _discover(sql: str) -> list[Candidate]:
    create = re.compile(
        r"^CREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\b",
        re.IGNORECASE,
    )
    alter = re.compile(r"^ALTER\s+(FUNCTION|PROCEDURE)\b", re.IGNORECASE)
    found: list[Candidate] = []

    for statement_index, raw in enumerate(_split_statements(sql), start=1):
        statement = _strip_leading_comments(raw)
        if not statement:
            continue

        match = create.match(statement) or alter.match(statement)
        if not match or not _is_security_definer(statement):
            continue

        kind = match.group(1).upper()
        parsed = _signature(statement, match.end())
        if parsed is None:
            raise RuntimeError(
                f"UNKNOWN source identity at statement {statement_index}: "
                f"{kind} SECURITY DEFINER cannot be bound safely"
            )
        schema, name, arguments = parsed
        found.append(Candidate(statement_index, kind, schema, name, arguments))

    if not found:
        raise RuntimeError("UNKNOWN no source-owned SECURITY DEFINER candidates found")
    return found


def _split_args(arguments: str) -> list[str] | None:
    if not arguments.strip():
        return []

    parts: list[str] = []
    start = 0
    depth = 0
    quote: str | None = None
    i = 0
    while i < len(arguments):
        ch = arguments[i]
        if quote:
            if ch == quote:
                if i + 1 < len(arguments) and arguments[i + 1] == quote:
                    i += 2
                    continue
                quote = None
            i += 1
            continue
        if ch in ("'", '"'):
            quote = ch
        elif ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
            if depth < 0:
                return None
        elif ch == "," and depth == 0:
            part = arguments[start:i].strip()
            if not part:
                return None
            parts.append(part)
            start = i + 1
        i += 1

    if quote or depth != 0:
        return None
    final = arguments[start:].strip()
    if not final:
        return None
    parts.append(final)
    return parts


def _without_default(declaration: str) -> str:
    match = re.search(
        r"(?is)\s+DEFAULT\s+|(?<![<>!])=(?!=)",
        declaration,
    )
    return declaration[: match.start()].strip() if match else declaration.strip()


def _canon(fragment: str) -> str:
    """Normalize whitespace/case outside quoted identifiers."""
    out: list[str] = []
    i = 0
    quoted = False
    pending_space = False
    while i < len(fragment):
        ch = fragment[i]
        if quoted:
            out.append(ch)
            if ch == '"':
                if i + 1 < len(fragment) and fragment[i + 1] == '"':
                    out.append('"')
                    i += 2
                    continue
                quoted = False
            i += 1
            continue

        if ch == '"':
            if pending_space and out and out[-1] not in ".([":
                out.append(" ")
            pending_space = False
            quoted = True
            out.append(ch)
        elif ch.isspace():
            pending_space = True
        elif ch in ".,()[]":
            while out and out[-1] == " ":
                out.pop()
            out.append(ch)
            pending_space = False
        else:
            if pending_space and out and out[-1] not in ".([":
                out.append(" ")
            pending_space = False
            out.append(ch.lower())
        i += 1
    return "".join(out).strip()


def _argument_matches(source: str, oracle: str) -> bool:
    source_norm = _canon(_without_default(source))
    oracle_norm = _canon(oracle)
    if not source_norm or not oracle_norm:
        return False

    folded = source_norm.upper()
    if folded.startswith(("OUT ", "INOUT ", "VARIADIC ")):
        return False
    if folded.startswith("IN "):
        source_norm = source_norm[3:].lstrip()

    # CREATE signatures may include an argument name; ALTER identities normally
    # do not. A match must still end in the exact PostgreSQL-rendered type text.
    return source_norm == oracle_norm or source_norm.endswith(" " + oracle_norm)


def _signature_matches(source: str, oracle: str) -> bool:
    source_parts = _split_args(source)
    oracle_parts = _split_args(oracle)
    if source_parts is None or oracle_parts is None:
        return False
    return len(source_parts) == len(oracle_parts) and all(
        _argument_matches(left, right)
        for left, right in zip(source_parts, oracle_parts)
    )


def _load_oracle(path: Path) -> list[dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"UNKNOWN oracle evidence cannot be read: {exc}") from exc

    if not isinstance(payload, dict) or payload.get("scanner") != ORACLE_SCANNER:
        raise RuntimeError("UNKNOWN oracle evidence has invalid scanner identity")

    routines = payload.get("routines")
    if not isinstance(routines, list):
        raise RuntimeError("UNKNOWN oracle routines must be an array")
    if type(payload.get("routine_count")) is not int or payload["routine_count"] != len(routines):
        raise RuntimeError("UNKNOWN oracle routine_count does not match routines")

    required = {
        "oid",
        "schema",
        "name",
        "identity_arguments",
        "identity",
        "prokind",
        "security_definer",
        "client_callable",
    }
    for index, row in enumerate(routines):
        if not isinstance(row, dict) or not required.issubset(row):
            raise RuntimeError(f"UNKNOWN oracle routine[{index}] is malformed")
        if type(row["oid"]) is not int or row["oid"] <= 0:
            raise RuntimeError(f"UNKNOWN oracle routine[{index}].oid is invalid")
        for field in ("schema", "name", "identity_arguments", "identity", "prokind"):
            if not isinstance(row[field], str):
                raise RuntimeError(
                    f"UNKNOWN oracle routine[{index}].{field} must be string"
                )
        if row["security_definer"] is not True:
            raise RuntimeError(
                f"UNKNOWN oracle routine[{index}] is not SECURITY DEFINER"
            )
        if type(row["client_callable"]) is not bool:
            raise RuntimeError(
                f"UNKNOWN oracle routine[{index}].client_callable must be boolean"
            )

        parsed_identity = _parse_complete_identity(row["identity"])
        if parsed_identity is None:
            raise RuntimeError(
                f"UNKNOWN oracle routine[{index}].identity is malformed"
            )
        identity_schema, identity_name, identity_arguments = parsed_identity
        if (
            identity_schema != row["schema"]
            or identity_name != row["name"]
            or identity_arguments != row["identity_arguments"]
        ):
            raise RuntimeError(
                f"UNKNOWN oracle routine[{index}] identity fields are inconsistent"
            )
    return routines


def _bind(candidate: Candidate, rows: list[dict[str, Any]]) -> dict[str, Any]:
    exact = [
        row
        for row in rows
        if row["schema"] == candidate.schema
        and row["name"] == candidate.name
        and row["prokind"] == candidate.prokind
        and _signature_matches(candidate.arguments, row["identity_arguments"])
    ]

    if not exact:
        raise RuntimeError(
            "UNKNOWN no exact PostgreSQL catalog identity for "
            f"{candidate.schema}.{candidate.name} "
            f"at statement {candidate.statement_index}"
        )
    if len(exact) != 1:
        raise RuntimeError(
            "AMBIGUOUS PostgreSQL catalog identity for "
            f"{candidate.schema}.{candidate.name}"
        )

    row = exact[0]
    callable_by_client = row["client_callable"]
    return {
        "statement_index": candidate.statement_index,
        "source_kind": candidate.kind,
        "source_schema": candidate.schema,
        "source_name": candidate.name,
        "source_arguments": candidate.arguments,
        "catalog_oid": row["oid"],
        "catalog_identity": row["identity"],
        "catalog_prokind": row["prokind"],
        "discovery_status": "RESOLVED",
        "client_callable": callable_by_client,
        "runtime_verdict": "OPEN" if callable_by_client else "CLOSED",
        "runtime_evidence": {
            key: row.get(key)
            for key in (
                "public_execute",
                "anon_role_exists",
                "anon_execute",
                "authenticated_role_exists",
                "authenticated_execute",
                "proacl",
                "proconfig",
            )
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--oracle-evidence", required=True, type=Path)
    args = parser.parse_args(argv)

    try:
        source = args.source.read_text(encoding="utf-8")
        candidates = _discover(source)
        rows = _load_oracle(args.oracle_evidence)
        bindings = [_bind(candidate, rows) for candidate in candidates]
    except (OSError, RuntimeError, ValueError) as exc:
        message = str(exc)
        if not message.startswith(("UNKNOWN", "AMBIGUOUS")):
            message = "UNKNOWN " + message
        print(message, file=sys.stderr)
        return 2

    print(
        json.dumps(
            {
                "scanner": "wardah-scanner-v2-discovery-binding",
                "status": "RESOLVED",
                "candidate_count": len(candidates),
                "binding_count": len(bindings),
                "bindings": bindings,
            },
            sort_keys=True,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
