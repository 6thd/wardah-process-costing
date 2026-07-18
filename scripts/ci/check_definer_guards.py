#!/usr/bin/env python3
"""
CI guard: prevent new SECURITY DEFINER functions without an org-member guard.

Scans all migration files numbered > BASELINE_CUTOFF for new/replaced DEFINER
functions. Fails if any is callable by 'authenticated' without a body line that
calls wardah_assert_org_member, wardah_assert_org_admin, or wardah_is_org_member.

Exemptions:
  - Functions with REVOKE EXECUTE FROM authenticated immediately after definition
  - Functions listed in KNOWN_EXEMPT (intentionally open to authenticated, documented)
"""

import pathlib
import re
import sys

MIGRATIONS_DIR = pathlib.Path("sql/migrations")
BASELINE_FILE = next(pathlib.Path("sql/baseline").glob("000_schema_baseline_*.sql"), None)

KNOWN_EXEMPT = {
    # Documented in SECURITY_DEFINER_AUDIT.md — open to anon deliberately
    "rpc_get_invitation_preview",
}

GUARD_PATTERNS = [
    r"wardah_assert_org_member",
    r"wardah_assert_org_admin",
    r"wardah_is_org_member",
]
GUARD_RE = re.compile("|".join(GUARD_PATTERNS))

DEFINER_FUNC_RE = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(",
    re.IGNORECASE,
)

# REVOKE FROM PUBLIC is the only grant that actually prevents authenticated access.
# REVOKE FROM authenticated alone still leaves the PUBLIC grant active.
REVOKE_RE = re.compile(
    r"REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+.*?\s+FROM\s+PUBLIC\b",
    re.IGNORECASE | re.DOTALL,
)


def get_cutoff() -> int:
    if BASELINE_FILE is None:
        return 0
    m = re.search(r"migration_cutoff:\s*(\d+)", BASELINE_FILE.read_text(encoding="utf-8"))
    return int(m.group(1)) if m else 0


def extract_function_body(sql: str, func_start: int) -> str:
    """Return text from func_start to the closing dollar-quote block.

    Detects the actual delimiter (e.g. $function$, $$) so that the guard
    search is confined to the target function's body and cannot bleed into
    a subsequent guarded function in the same migration file.
    """
    delim_m = re.search(r"AS\s+(\$\w*\$)", sql[func_start:], re.IGNORECASE)
    if delim_m:
        delim = delim_m.group(1)
        body_start = func_start + delim_m.end()
        end = sql.find(delim, body_start)
        if end != -1:
            return sql[func_start: end + len(delim)]
    return sql[func_start: func_start + 4000]


def check_file(path: pathlib.Path) -> list[str]:
    errors = []
    sql = path.read_text(encoding="utf-8")

    for m in re.finditer(
        r"SECURITY\s+DEFINER",
        sql,
        re.IGNORECASE,
    ):
        # Walk back to find the CREATE FUNCTION
        prefix = sql[: m.start()]
        func_m = None
        for fm in DEFINER_FUNC_RE.finditer(prefix):
            func_m = fm
        if func_m is None:
            continue

        func_name = func_m.group(1).lower()
        if func_name in KNOWN_EXEMPT:
            continue

        body = extract_function_body(sql, func_m.start())

        # Check for explicit REVOKE after definition
        after = sql[func_m.end():]
        revoke_before_next_func = after.split("CREATE")[0] if "CREATE" in after else after
        if REVOKE_RE.search(revoke_before_next_func):
            continue

        if not GUARD_RE.search(body):
            errors.append(
                f"  ❌ {path.name}: function '{func_name}' is SECURITY DEFINER "
                f"but has no org-member guard (wardah_assert_org_member / "
                f"wardah_assert_org_admin / wardah_is_org_member)"
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
        errors = check_file(mig)
        all_errors.extend(errors)

    if all_errors:
        print("\n".join(all_errors), file=sys.stderr)
        print(
            "\nأضف wardah_assert_org_member(v_org) أو wardah_assert_org_admin(v_org) "
            "في أول جسم الدالة، أو أضف اسمها إلى KNOWN_EXEMPT إن كانت مقصودة.",
            file=sys.stderr,
        )
        return 1

    print(f"✅ {len(new_migrations)} migration(s) — لا دوال DEFINER بلا حارس")
    return 0


if __name__ == "__main__":
    sys.exit(main())
