# M202 acceptance membership contract

Local correction only. `sql/migrations/202_qc_privileged_write_closure.sql` is
not edited, and this file is not a migration.

`wardah_internal.qc_assert_closed_graph_202()` already tolerates one incoming
membership: `admin_option` true, `set_option` false, `inherit_option` false,
and the member is the owner of `public.quality_inspections`. That is the
ADMIN-only edge PostgreSQL 16+ records when a non-superuser `CREATEROLE` role
creates `wardah_qc_entry_202`. The acceptance assertion now uses that same
predicate (`pg_temp.m202_membership_contract()`). Zero edges still pass.
Every other incoming edge fails, and any outgoing edge fails.

The allowed edge is not a powerless leftover. `admin_option` is enough for
that member to `GRANT wardah_qc_entry_202 ... WITH SET TRUE`, directly or
through a hop role the member can `SET`. Once that SET edge exists, the
acceptance contract fails and `qc_write_guard_202()` refuses the insert with
`QC_EXECUTION_GRAPH_OPEN_202: MEMBERSHIP`. The negative tests grant that SET
edge, prove the role is reachable, prove the guard refuses, and roll the
grant back. They do not delete the admin edge and they do not relax the
assertion to ignore other edges.

Applying 202 as non-superuser `postgres` creates the admin edge. This
correction does not switch that apply to `supabase_admin`.
