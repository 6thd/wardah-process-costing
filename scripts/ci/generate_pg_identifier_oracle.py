#!/usr/bin/env python3
"""Derive the PostgreSQL identifier-identity oracle from a live PostgreSQL 17.

The scanner has to answer one question everywhere it makes a security decision:
are these two identifiers the same identifier? Four consecutive review rounds
found a case where its answer differed from PostgreSQL's. A table of expected
values written by hand would encode the same assumptions that were wrong; this
asks the server instead.

`quote_ident(x)::name` is exactly the path a parsed identifier takes - the cast
to `name` applies NAMEDATALEN truncation - and an unquoted identifier is put
through the parser itself so downcase_identifier() decides the folding rather
than this script.

Usage (a throwaway cluster is fine, and PostgreSQL 17 is what CI runs):
    python3 scripts/ci/generate_pg_identifier_oracle.py \
        --psql "psql -h /tmp/pg -p 5442 -U postgres" \
        > scripts/ci/oracles/pg_identifier_identity.json

The committed oracle is consumed by test_check_definer_guards.py, which fails
if the scanner's canonicalizer disagrees with any row.
"""

import argparse
import json
import shlex
import subprocess  # nosec B404 - developer tool; shells out to psql by design
import sys

# A bounded, deterministic corpus - never random - covering every axis on which
# the scanner and PostgreSQL were found to disagree, plus the ordinary cases.
LIMIT = 63
CORPUS = [
    # plain ASCII, and folding
    "rpc_probe", "RPC_PROBE", "Rpc_Probe", "_leading", "with$dollar", "a1b2",
    # BMP non-ASCII: PostgreSQL does NOT downcase these in a UTF-8 database
    "حارس", "rpc_bÄd", "rpc_bäd",
    "RPC_BÄD", "TypeÄ", "Typeä",
    # length-changing Python lowercase - the P1-2 class
    "K", "K" + "a" * 60 + "X", "K" + "a" * 60 + "Y",
    "Å", "Ω", "ẞ", "İ",
    # astral plane - the P1-1 class
    "auth\U0001D400", "\U0001D400auth", "auth\U0001F600", "rpc_\U0001D400",
    # exactly at, and across, the byte limit
    "a" * 62, "a" * 63, "a" * 64, "a" * 200,
    "rpc_" + "a" * 60 + "X", "rpc_" + "a" * 60 + "Y",
    "a" * 62 + "م", "a" * 61 + "م", "a" * 60 + "م",
    "a" * 62 + "ก", "a" * 61 + "ก", "a" * 60 + "ก",
    "a" * 62 + "\U0001D400", "a" * 61 + "\U0001D400", "a" * 60 + "\U0001D400",
    "م" * 32, "م" * 31, "\U0001D400" * 16,
    # mixed scripts
    "rpc_مixÄ", "A" * 30 + "م" * 20,
]


def _psql(cmd: list[str], sql: str) -> str:
    # nosec B603 - `cmd` is the operator's own --psql invocation and the SQL
    # is built from this file's fixed corpus; no shell and no external input.
    out = subprocess.run(  # nosec B603
        cmd + ["-Atq", "-c", sql], capture_output=True, text=True
    )
    if out.returncode != 0:
        sys.exit(f"psql failed: {out.stderr.strip()}")
    return out.stdout.rstrip("\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--psql", required=True, help="psql invocation, quoted")
    args = ap.parse_args()
    cmd = shlex.split(args.psql)

    version = _psql(cmd, "SELECT version()")
    encoding = _psql(cmd, "SELECT current_setting('server_encoding')")
    if encoding != "UTF8":
        sys.exit(f"oracle must be generated on a UTF8 database, got {encoding}")

    rows = []
    for text in CORPUS:
        rows.append(
            {
                "text": text,
                # The parser's own path: downcase_identifier + truncate_identifier.
                "unquoted": _resolve_unquoted(cmd, text),
                # Folding suppressed; the cast to `name` still truncates.
                "quoted": _psql(cmd, f"SELECT {_literal(text)}::name"),
            }
        )

    json.dump(
        {
            "server_version": version,
            "server_encoding": encoding,
            "namedatalen_limit": LIMIT,
            "note": (
                "Generated from a live PostgreSQL server by "
                "scripts/ci/generate_pg_identifier_oracle.py. 'unquoted' is the "
                "identifier as the parser resolves it (downcase_identifier then "
                "truncate_identifier); 'quoted' is the same with folding "
                "suppressed. Do not edit by hand - regenerate."
            ),
            "rows": rows,
        },
        sys.stdout,
        ensure_ascii=False,
        indent=1,
    )
    sys.stdout.write("\n")
    return 0


def _literal(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def _resolve_unquoted(cmd: list[str], text: str) -> str:
    """The identifier as PostgreSQL's PARSER resolves it when written bare.

    Written as a column alias, so the server's own scanner folds and truncates
    it and then reports the resolved name back as the column header. Asking the
    parser is the point: a hand-written expectation would encode the very
    assumptions these reviews found to be wrong.
    """
    out = subprocess.run(  # nosec B603 - see _psql(); same fixed corpus, no shell
        cmd + ["-A", "-c", f"SELECT 1 AS {text}"], capture_output=True, text=True
    )
    if out.returncode != 0:
        sys.exit(f"psql failed resolving unquoted {text!r}: {out.stderr.strip()}")
    return out.stdout.splitlines()[0]


if __name__ == "__main__":
    sys.exit(main())
