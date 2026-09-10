#!/usr/bin/env python3
"""
CI guard: prevent new SECURITY DEFINER functions without a tenant/authorization guard.

Scans all migration files numbered > BASELINE_CUTOFF for new/replaced DEFINER
functions. Fails if any client-callable function lacks one of the reviewed
server-boundary guards.

A guard counts only when it appears as an executable function CALL
(`guard(...)` or `public.guard(...)`) inside the masked function body. A
textual occurrence of the name — a dollar-quote tag, a quoted identifier,
a bare identifier, comment or literal text — never satisfies the gate.

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

# Kept for backwards compatibility with callers that only need the names.
GUARD_PATTERNS = list(GUARD_NAMES)

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

# A PL/pgSQL `RAISE EXCEPTION` without an explicit SQLSTATE raises P0001
# (raise_exception). Only a handler able to catch THAT can swallow an
# authorization failure; an unrelated condition such as unique_violation cannot,
# and must not produce a false red.
_CATCHING_CONDITION_RE = re.compile(
    r"\b(OTHERS|raise_exception)\b|\bSQLSTATE\s+'P0001'", re.IGNORECASE
)


class _Frame:
    __slots__ = ("kind", "start", "end", "then_pos", "closed", "raises", "exc_pos")

    def __init__(self, kind, start):
        self.kind = kind
        self.start = start
        self.end = 1 << 60
        self.then_pos = None
        self.closed = False
        self.raises = False
        self.exc_pos = None


def parse_blocks(body: str):
    """Model BEGIN / IF / LOOP / CASE nesting and EXCEPTION sections.

    LOOP covers WHILE, FOR and FOREACH, which all open with LOOP and close with
    END LOOP. A bare END closes the innermost BEGIN or CASE, so a CASE
    expression cannot silently close an enclosing block.
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
        token = " ".join(m.group(1).upper().split())
        if token in ("BEGIN", "IF", "LOOP", "CASE"):
            stack.append(_Frame(token, m.start()))
        elif token == "THEN":
            if stack and stack[-1].kind == "IF" and stack[-1].then_pos is None:
                stack[-1].then_pos = m.start()
        elif token in ("ELSIF", "ELSE"):
            if stack and stack[-1].kind == "IF":
                stack[-1].closed = True
        elif token == "EXCEPTION":
            # `RAISE EXCEPTION` is a statement, not a handler section.
            if _RAISE_BEFORE_RE.search(body[max(0, m.start() - 16): m.start()]):
                continue
            for fr in reversed(stack):
                if fr.kind == "BEGIN":
                    if fr.exc_pos is None:
                        fr.exc_pos = m.start()
                    break
        elif token == "END IF":
            pop(("IF",), m.start())
        elif token == "END LOOP":
            pop(("LOOP",), m.start())
        elif token == "END CASE":
            pop(("CASE",), m.start())
        elif token == "END":
            pop(("BEGIN", "CASE"), m.start())
        elif token == "RAISE":
            fr = stack[-1] if stack else None
            if (
                fr is not None
                and fr.kind == "IF"
                and fr.then_pos is not None
                and not fr.closed
                and not _NON_ABORTING_RAISE_RE.match(body, m.start())
            ):
                fr.raises = True

    # Unclosed frames stay out of `frames`, so nothing depending on them is
    # recognized. That fails closed rather than guessing at the structure.
    return frames


def _enclosing(frames, pos):
    return [f for f in frames if f.start < pos < f.end]


def _handler_catches(body: str, frame) -> bool:
    """True when the block's EXCEPTION handlers can catch a P0001 assertion."""
    if frame.exc_pos is None:
        return False
    return bool(_CATCHING_CONDITION_RE.search(body[frame.exc_pos: frame.end]))


def is_swallowed(body: str, frames, pos: int) -> bool:
    """True when an authorization failure raised at `pos` would be caught by an
    enclosing block's own EXCEPTION handlers.

    Only blocks that actually enclose `pos` count: a later, unrelated nested
    exception block elsewhere in the function must not invalidate this guard,
    and a handler for an unrelated condition cannot catch the assertion.
    """
    for frame in _enclosing(frames, pos):
        if frame.kind != "BEGIN":
            continue
        if frame.exc_pos is not None and pos < frame.exc_pos and _handler_catches(body, frame):
            return True
    return False


def is_outer_statement_level(frames, pos: int) -> bool:
    """True when `pos` sits at the function's outermost PL/pgSQL statement level.

    Not inside IF/ELSIF/ELSE, LOOP/WHILE/FOR/FOREACH, CASE, a nested BEGIN, or
    an EXCEPTION handler. Identity and org-resolution reads may legitimately
    precede the guard: this is about execution level, not textual first-line
    placement.
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


def _if_blocks_with_raising_deny_branch(body: str):
    """(if_token_pos, condition_start, condition_end) for each IF whose own deny
    branch raises at its own nesting level."""
    return [
        (f.start, f.start + 2, f.then_pos)
        for f in parse_blocks(body)
        if f.kind == "IF" and f.then_pos is not None and f.raises
    ]


def has_negated_raising_predicate(body: str, strict: bool = False) -> bool:
    """True when a boolean membership predicate is negated as a WHOLE top-level
    condition term of an IF whose deny branch raises, that denial is not
    swallowed, and - under the strict contract - the guarding IF itself sits at
    the function's outer statement level."""
    frames = parse_blocks(body)
    for if_pos, cond_start, cond_end in _if_blocks_with_raising_deny_branch(body):
        if is_swallowed(body, frames, if_pos):
            continue
        if strict and not is_outer_statement_level(frames, if_pos):
            continue
        condition = body[cond_start:cond_end]
        if any(_is_sole_negated_predicate(t) for t in _split_top_level_or(condition)):
            return True
    return False


def has_recognized_guard(body: str, strict: bool = False) -> bool:
    """A raising assertion helper, or a boolean predicate in the negated raising
    idiom. A guard whose failure an enclosing handler can swallow never counts;
    under the strict contract it must also sit at the outer statement level."""
    frames = parse_blocks(body)
    for m in GUARD_RE.finditer(body):
        if is_swallowed(body, frames, m.start()):
            continue
        if strict and not is_outer_statement_level(frames, m.start()):
            continue
        return True
    return has_negated_raising_predicate(body, strict=strict)


def migration_number(path: pathlib.Path):
    """Leading number of a migration filename, or None when it has none."""
    head = path.stem.split("_")[0]
    return int(head) if head.isdigit() else None


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
    number = migration_number(path)
    strict = number is not None and number >= MIGRATION_STRICT_CUTOFF
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

        if not has_recognized_guard(body, strict=strict):
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
