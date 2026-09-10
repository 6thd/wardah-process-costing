#!/usr/bin/env python3
"""
CI guard: prevent new SECURITY DEFINER functions without a tenant/authorization guard.

Scans all migration files numbered > BASELINE_CUTOFF for new/replaced DEFINER
functions. Fails if any client-callable function lacks one of the reviewed
server-boundary guards.

Recognized guards:
  - wardah_assert_org_member / wardah_assert_org_admin / wardah_is_org_member
  - wardah_178_assert_permission: Migration 178's assertion wrapper around
    wardah_has_exact_permission. Unlike matching a bare boolean permission
    helper, this wrapper raises on denial and preserves the central Super Admin,
    active-membership, role-org, role-active and expiry semantics.

Exemptions:
  - Functions with REVOKE EXECUTE/ALL FROM PUBLIC immediately after definition
  - Functions listed in KNOWN_EXEMPT (intentionally open/delegating/superseded,
    with a documented reason)
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

GUARD_PATTERNS = [
    r"wardah_assert_org_member",
    r"wardah_assert_org_admin",
    r"wardah_is_org_member",
    # Match only the assertion wrapper, never a bare boolean permission lookup.
    r"wardah_178_assert_permission",
]
GUARD_RE = re.compile("|".join(GUARD_PATTERNS))

DEFINER_FUNC_RE = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(",
    re.IGNORECASE,
)

# Both REVOKE EXECUTE and REVOKE ALL remove the inherited PUBLIC EXECUTE grant.
# REVOKE from authenticated alone is insufficient while PUBLIC still holds it.
REVOKE_RE = re.compile(
    r"REVOKE\s+(?:EXECUTE|ALL(?:\s+PRIVILEGES)?)\s+ON\s+FUNCTION\s+.*?\s+FROM\s+PUBLIC\b",
    re.IGNORECASE | re.DOTALL,
)


class MaskError(Exception):
    """A construct the length-preserving masker cannot mask soundly."""


def _dollar_tag_at(sql: str, i: int) -> str | None:
    """Return the dollar-quote tag opening at i, or None.

    PostgreSQL tags are `$$` or `$tag$` where tag starts with a letter or
    underscore. `$1` (a positional parameter) is therefore not a tag.
    """
    n = len(sql)
    if i >= n or sql[i] != "$":
        return None
    j = i + 1
    if j < n and (sql[j].isalpha() or sql[j] == "_"):
        j += 1
        while j < n and (sql[j].isalnum() or sql[j] == "_"):
            j += 1
    if j < n and sql[j] == "$":
        return sql[i : j + 1]
    return None


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


def _mask_quoted(sql: str, out: list[str], i: int) -> int:
    """Mask the CONTENT of a single-quoted literal, keeping both delimiters so
    the statement shape around it stays readable. A doubled '' is content. In an
    E'' literal a backslash escapes the next character, so \' does not close
    the literal."""
    n = len(sql)
    escape = _is_escape_string(sql, i)
    j = i + 1
    while j < n:
        ch = sql[j]
        if escape and ch == "\\" and j + 1 < n:
            _blank(out, j, j + 2)
            j += 2
            continue
        if ch == "'":
            if sql.startswith("''", j):
                _blank(out, j, j + 2)
                j += 2
                continue
            return j + 1
        if ch != "\n":
            out[j] = " "
        j += 1
    raise MaskError("unterminated single-quoted literal")


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
    doubled quotes and E'' backslash escapes) and nested dollar-quoted literals.
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


def mask_sql(sql: str) -> str:
    """Backwards-compatible wrapper: masked text only."""
    return mask_sql_checked(sql)[0]


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
    sql, mask_problems = mask_sql_checked(path.read_text(encoding="utf-8"))

    # Fail closed. A body the masker could not follow may hide a guard name in
    # unmasked non-executable text, which is exactly the false green this
    # scanner exists to prevent.
    for problem in mask_problems:
        errors.append(
            f"  \u274c {path.name}: cannot be scanned safely ({problem}); "
            f"fix the construct or split it out"
        )
    if mask_problems:
        return errors

    for m in re.finditer(r"SECURITY\s+DEFINER", sql, re.IGNORECASE):
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

        # Check for explicit REVOKE after definition and before the next CREATE.
        after = sql[func_m.end():]
        revoke_before_next_func = after.split("CREATE")[0] if "CREATE" in after else after
        if REVOKE_RE.search(revoke_before_next_func):
            continue

        if not GUARD_RE.search(body):
            errors.append(
                f"  ❌ {path.name}: function '{func_name}' is SECURITY DEFINER "
                f"but has no recognized tenant/authorization assertion"
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
