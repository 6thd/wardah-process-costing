#!/usr/bin/env python3
# Writes the preflight pins of Migration 205 (md5 of pg_proc.prosrc of every function 205 relies on) from a database
# built through 204, so no hash is typed by hand. The rows come on stdin from acceptance_205_preflight_pins.sql; this
# script rewrites only the lines between the two markers in the migration. With --check the file must not change.
#   psql -X -At -v ON_ERROR_STOP=1 -d <db> -f scripts/ci/fresh-db/acceptance_205_preflight_pins.sql \
#     | python3 scripts/ci/fresh-db/pin_205_preflight.py [--check]
import argparse
import re
import sys
from pathlib import Path

MIGRATION = Path(__file__).resolve().parents[3] / "sql/migrations/205_manufacturing_cost_policy_approval_and_overhead.sql"
BEGIN, END = "    -- M205_PREFLIGHT_PINS_BEGIN\n", "    -- M205_PREFLIGHT_PINS_END\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    rows = [ln.strip().split("|") for ln in sys.stdin.read().splitlines() if ln.strip()]
    if not rows or any(len(r) != 2 or not re.fullmatch(r"[0-9a-f]{32}", r[1]) for r in rows):
        sys.exit(f"PIN_205_ROWS_UNEXPECTED: {rows}")
    lines = [f"    ('{sig}', '{md5}')" for sig, md5 in rows]
    block = BEGIN + ",\n".join(lines) + "\n" + END
    src = MIGRATION.read_text(encoding="utf-8")
    start, stop = src.index(BEGIN), src.index(END) + len(END)
    new = src[:start] + block + src[stop:]
    if a.check:
        if new != src:
            sys.exit("PIN_205_DRIFT: the pinned bodies differ from this database")
        print(f"PIN_205_CHECK_OK {len(rows)} bodies")
        return
    MIGRATION.write_bytes(new.encode("utf-8"))
    print(f"PIN_205_WRITTEN {len(rows)} bodies")


if __name__ == "__main__":
    main()
