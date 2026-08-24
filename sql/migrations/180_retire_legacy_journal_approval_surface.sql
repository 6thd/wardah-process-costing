-- Migration 180 — retire legacy journal approval surface (Issue #175)
--
-- The canonical ledger is public.gl_entries / public.gl_entry_lines after 178.
-- The historical journal_entries approval model is retained for history only.
-- This migration is intentionally additive/non-destructive: no table, row,
-- function, baseline, or historical migration is deleted.
--
-- Scope:
--   * remove browser/client access to journal_entry_approvals;
--   * remove client/service execution of the two legacy approval functions;
--   * preserve all legacy objects and rows in place;
--   * do not change canonical manual journal create/post/reverse behavior.

BEGIN;

-- The legacy approval table previously retained broad table-level grants even
-- though its RLS depends on historical app.current_tenant_id context. Do not
-- treat that stale RLS contract as an authorization boundary.
REVOKE ALL ON TABLE public.journal_entry_approvals FROM PUBLIC;
REVOKE ALL ON TABLE public.journal_entry_approvals FROM anon;
REVOKE ALL ON TABLE public.journal_entry_approvals FROM authenticated;
REVOKE ALL ON TABLE public.journal_entry_approvals FROM service_role;

-- Keep definitions for historical/schema compatibility, but retire every
-- non-owner execution path. A future canonical approval workflow must be
-- designed explicitly against gl_entries rather than reviving these RPCs.
REVOKE ALL ON FUNCTION public.check_entry_approval_required(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_entry_approval_required(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.check_entry_approval_required(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.check_entry_approval_required(uuid) FROM service_role;

REVOKE ALL ON FUNCTION public.approve_journal_entry(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_journal_entry(uuid, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.approve_journal_entry(uuid, integer, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.approve_journal_entry(uuid, integer, text) FROM service_role;

COMMIT;
