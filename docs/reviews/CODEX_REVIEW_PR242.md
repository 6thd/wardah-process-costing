# Codex Review — PR #242

**PR:** Harden SECURITY DEFINER acceptance contract for PR #241  
**Commit reviewed:** `97eb58588601bb1c76d11160308bb4816ba90e13`  
**Reviewed at:** 2026-09-11T11:59:08Z  
**File under review:** `scripts/ci/check_definer_guards.py`

---

## P1 Findings

### P1-1 · Check the matching CREATE before accepting an ALTER (line 1405–1406)

When a migration creates a function as `SECURITY INVOKER` and subsequently runs `ALTER FUNCTION ... SECURITY DEFINER`, the definition is skipped by the definer loop, but this unconditional identity match suppresses the ALTER finding anyway. The final function can therefore remain client-callable and unguarded while `check_file()` returns no errors; acceptance should require that the matching definition was itself a checked `SECURITY DEFINER` definition rather than merely present.

> [View on GitHub](https://github.com/6thd/wardah-process-costing/pull/242#discussion_r3988897611)

---

### P1-2 · Preserve each OR term's actual source offset (line 321–322)

When two SQLSTATE terms have the same masked representation, as in `WHEN SQLSTATE '23505' OR SQLSTATE 'P0001' THEN`, `index(term)` returns the first term's offset for both terms. The second condition is consequently read as `23505`, so an outer handler can catch the guard's P0001 and perform privileged work while the scanner accepts the guard as unswallowed.

> [View on GitHub](https://github.com/6thd/wardah-process-costing/pull/242#discussion_r3988897621)

---

### P1-3 · Parse quoted client grantees from unmasked SQL (line 1212–1216)

Quoted role contents have already been blanked in `grantee_text`, so `GRANT EXECUTE ... TO "authenticated"` produces an empty grantee set. After a valid PUBLIC revocation, that later grant reopens the function to the real `authenticated` role, but the privilege replay still reports the unguarded function as closed; the fixture-scoped catalog contract does not backstop arbitrary new functions.

> [View on GitHub](https://github.com/6thd/wardah-process-costing/pull/242#discussion_r3988897623)

---

## P2 Findings

### P2-1 · Preserve quoted type names in overload identities (line 1037–1041)

The argument list passed here comes from masked SQL, where quoted identifier contents are spaces. Consequently distinct signatures such as `x(public."TypeA")` and `x(public."TypeB")` normalize identically; with both overloads present, revoking only the invoker `TypeB` overload can incorrectly exempt an unguarded, still-PUBLIC-executable definer `TypeA` overload.

> [View on GitHub](https://github.com/6thd/wardah-process-costing/pull/242#discussion_r3988897624)

---

### P2-2 · Do not treat an omitted schema as an identity wildcard (line 891–892)

When either identity is unqualified, this comparison ignores the schema. With the usual `public` search path, an unqualified `REVOKE ... ON FUNCTION x(uuid)` can therefore resolve to `public.x(uuid)` while the scanner also credits it to an unguarded `private.x(uuid)`, leaving the private definer's default PUBLIC EXECUTE intact without a finding.

> [View on GitHub](https://github.com/6thd/wardah-process-costing/pull/242#discussion_r3988897627)
