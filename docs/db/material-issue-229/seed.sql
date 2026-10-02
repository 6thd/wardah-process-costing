\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.organizations(id,name,code) VALUES
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','Issue scope foreign organization','ISSUE-SCOPE-FOREIGN');
\ir ../posted-history-193/_fixture.sql
CREATE TABLE wardah_internal.issue_scope_test_ids(k text PRIMARY KEY,v uuid);
REVOKE ALL ON wardah_internal.issue_scope_test_ids FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO wardah_internal.issue_scope_test_ids VALUES
 ('mo',pg_temp.mk_mo('ISSUE-SCOPE-1',5,100,'in_progress','IN_PROGRESS')),
 ('mo2',pg_temp.mk_mo('ISSUE-SCOPE-2',5,100,'in_progress','IN_PROGRESS'));
COMMIT;
