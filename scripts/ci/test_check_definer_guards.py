#!/usr/bin/env python3
"""Regression tests for the SECURITY DEFINER guard scanner.

These run against check_file() — the function CI actually uses per migration —
rather than against the masker alone, so they prove the verdict, not an
intermediate string.

Final-review remediation (PR #241, Finding 1): at the reviewed head
fa1de77f07077af97623c34c0a743b5d00000785, mask_sql() masked only `--` comments
once it entered a dollar-quoted function body. An unguarded SECURITY DEFINER
function therefore passed the scanner merely because the guard's NAME appeared
inside non-executable text — a string literal, a block comment, a nested block
comment, or a nested dollar-quoted literal. The MUST_REJECT cases below are that
false green, frozen.
"""

from __future__ import annotations

import importlib.util
import pathlib
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("check_definer_guards.py")
_spec = importlib.util.spec_from_file_location("check_definer_guards", SCRIPT)
guards = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(guards)


def definer(body: str, name: str = "f_probe") -> str:
    """A SECURITY DEFINER function whose body is exactly `body`."""
    return (
        f"CREATE OR REPLACE FUNCTION public.{name}(p_org uuid)\n"
        "RETURNS void\n"
        "LANGUAGE plpgsql\n"
        "SECURITY DEFINER\n"
        "SET search_path TO 'public', 'pg_temp'\n"
        "AS $function$\n"
        "BEGIN\n"
        f"{body}\n"
        "  UPDATE public.bins SET actual_qty = 0 WHERE org_id = p_org;\n"
        "END;\n"
        "$function$;\n"
    )


GUARD = "wardah_assert_org_member"

MUST_REJECT = {
    # The plain unguarded case: the scanner's original reason for existing.
    "no_guard_at_all": definer("  PERFORM 1;"),
    # Finding 1: guard name inside a single-quoted string literal.
    "guard_only_in_string_literal": definer(f"  PERFORM '{GUARD}';"),
    # Finding 1: guard name inside a block comment in the body.
    "guard_only_in_block_comment": definer(f"  /* {GUARD} */"),
    # Finding 1: guard name inside a NESTED block comment in the body.
    "guard_only_in_nested_block_comment": definer(
        f"  /* outer /* {GUARD} */ still outer */"
    ),
    # Already rejected before the fix; kept so it cannot regress.
    "guard_only_in_line_comment": definer(f"  -- {GUARD}"),
    # Finding 1: guard name inside a nested dollar-quoted literal.
    "guard_only_in_nested_dollar_literal": definer(f"  RAISE NOTICE $${GUARD}$$;"),
    "guard_only_in_tagged_nested_dollar_literal": definer(
        f"  RAISE NOTICE $msg${GUARD}$msg$;"
    ),
    # A doubled quote is literal content, not an early close: the guard named
    # after it is still inside the literal.
    "guard_after_doubled_quote_in_literal": definer(
        f"  PERFORM 'it''s not a call to {GUARD}';"
    ),
    # The original defect, in its most seductive shape: prose that describes the
    # guard next to a body that never calls it.
    "guard_named_in_prose_only": definer(
        f"  -- This RPC relies on {GUARD}() being applied by its caller."
    ),
}

MUST_ACCEPT = {
    # The real thing, in statement position.
    "executable_guard_call": definer(f"  PERFORM public.{GUARD}(p_org);"),
    # Same, with the non-executable decoys present as well: an executable call
    # anywhere in the body is still a pass.
    "executable_guard_plus_decoys": definer(
        f"  /* {GUARD} */\n"
        f"  PERFORM 'log {GUARD}';\n"
        f"  PERFORM public.{GUARD}(p_org);"
    ),
    # The unqualified form some migrations use.
    "unqualified_guard_call": definer(f"  PERFORM {GUARD}(p_org);"),
    # An admin guard is equally recognized.
    "admin_guard_call": definer("  PERFORM public.wardah_assert_org_admin(p_org);"),
}

# Constructs the masker cannot follow. These must fail closed rather than be
# scanned as executable text.
MUST_FAIL_CLOSED = {
    "unterminated_block_comment": definer(f"  /* {GUARD}"),
    "unterminated_string_literal": definer(f"  PERFORM '{GUARD};"),
    "unterminated_nested_dollar": definer(f"  RAISE NOTICE $${GUARD};"),
}


class DefinerScannerTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def verdict(self, name: str, sql: str) -> list[str]:
        path = self.root / f"999_{name}.sql"
        path.write_text(sql, encoding="utf-8")
        return guards.check_file(path)

    def test_non_executable_guard_mentions_are_rejected(self) -> None:
        for name, sql in MUST_REJECT.items():
            with self.subTest(case=name):
                self.assertTrue(
                    self.verdict(name, sql),
                    f"{name}: SECURITY DEFINER function accepted with no "
                    f"executable authorization guard",
                )

    def test_real_executable_guards_are_accepted(self) -> None:
        for name, sql in MUST_ACCEPT.items():
            with self.subTest(case=name):
                self.assertEqual(
                    self.verdict(name, sql),
                    [],
                    f"{name}: a real executable guard was rejected",
                )

    def test_unmaskable_constructs_fail_closed(self) -> None:
        for name, sql in MUST_FAIL_CLOSED.items():
            with self.subTest(case=name):
                errors = self.verdict(name, sql)
                self.assertTrue(errors, f"{name}: unmaskable construct not reported")
                self.assertIn("cannot be scanned safely", errors[0])

    def test_revoke_from_public_still_exempts(self) -> None:
        sql = definer("  PERFORM 1;", name="f_revoked") + (
            "REVOKE EXECUTE ON FUNCTION public.f_revoked(uuid) FROM PUBLIC;\n"
        )
        self.assertEqual(self.verdict("revoked", sql), [])

    def test_mask_preserves_offsets_and_keeps_body_executable(self) -> None:
        sql = definer(f"  PERFORM '{GUARD}';\n  PERFORM public.{GUARD}(p_org);")
        masked, problems = guards.mask_sql_checked(sql)
        self.assertEqual(problems, [])
        self.assertEqual(len(masked), len(sql), "mask changed offsets")
        self.assertEqual(masked.count("\n"), sql.count("\n"), "mask ate a newline")
        # The executable body must survive: exactly one guard occurrence left,
        # and it is the call, not the literal.
        self.assertEqual(masked.count(GUARD), 1)
        self.assertIn(f"PERFORM public.{GUARD}(p_org);", masked)
        self.assertIn("UPDATE public.bins", masked)

    def test_repository_migrations_remain_scannable(self) -> None:
        """No committed migration or baseline may trip the fail-closed path."""
        files = sorted(pathlib.Path("sql/migrations").glob("*.sql")) + sorted(
            pathlib.Path("sql/baseline").glob("*.sql")
        )
        self.assertTrue(files, "no migrations found - run from the repository root")
        for path in files:
            _, problems = guards.mask_sql_checked(path.read_text(encoding="utf-8"))
            self.assertEqual(problems, [], f"{path.name}: {problems}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
