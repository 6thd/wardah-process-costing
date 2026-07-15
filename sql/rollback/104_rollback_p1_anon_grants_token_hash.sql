-- ===================================================================
-- تراجع Migration 104: استعادة الحالة قبل إصلاحات P1 التكميلية
-- ===================================================================
-- ⚠️ للطوارئ فقط — لا تنفّذ في الإنتاج إلا إذا كسر Migration 104
--    وظيفةً حقيقية ولا يمكن إصلاحها بطريقة أخرى.
--
-- ما يُعيده هذا الملف:
--   1. إعادة EXECUTE لـ anon على RPCs (تحذير: يُعيد الكشف لغير الموثَّقين)
--   2. إعادة ALL لـ anon على الجداول الحساسة (خطر)
--   3. استعادة audit_insert بدون قيد user_id
--   4. استعادة سياسات backup tables بـ USING(true)
--   5. حذف عمود token_hash والـ trigger (لا تحذف البيانات الحية)
--
-- بعد الطوارئ: أصلح سبب الفشل وأعد تطبيق 104.
-- ===================================================================

BEGIN;

-- 1. إعادة EXECUTE لـ anon
GRANT EXECUTE ON FUNCTION public.rpc_set_org_admin(uuid, uuid, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_accept_invitation(text)             TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_journal_entry(jsonb)         TO anon;
GRANT EXECUTE ON FUNCTION public.wardah_is_org_admin(uuid)               TO anon;

-- 2. إعادة ALL لـ anon على الجداول
GRANT ALL ON TABLE public.gl_entries         TO anon;
GRANT ALL ON TABLE public.gl_entry_lines     TO anon;
GRANT ALL ON TABLE public.user_organizations TO anon;
GRANT ALL ON TABLE public.user_roles         TO anon;
GRANT ALL ON TABLE public.roles              TO anon;
GRANT ALL ON TABLE public.role_permissions   TO anon;
GRANT ALL ON TABLE public.invitations        TO anon;

-- 3. استعادة audit_insert القديمة
DROP POLICY IF EXISTS "audit_insert" ON public.audit_logs;
CREATE POLICY "audit_insert" ON public.audit_logs
    FOR INSERT TO PUBLIC
    WITH CHECK (true);

-- 4. استعادة سياسات backup tables
DROP POLICY IF EXISTS "bom_backup_super_admin_only" ON public.bill_of_materials_20250905_1900;
CREATE POLICY "authenticated_all_bill_materials" ON public.bill_of_materials_20250905_1900
    FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "profiles_backup_self" ON public.users_profiles_20250905_1900;
CREATE POLICY "safe_select_profiles" ON public.users_profiles_20250905_1900
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "safe_insert_profiles" ON public.users_profiles_20250905_1900
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "safe_update_profiles" ON public.users_profiles_20250905_1900
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 5. حذف token_hash (الـ trigger والعمود والفهرس)
DROP TRIGGER IF EXISTS trg_invitations_set_token_hash ON public.invitations;
DROP FUNCTION IF EXISTS public.fn_invitations_set_token_hash();
DROP INDEX IF EXISTS public.invitations_token_hash_key;
ALTER TABLE public.invitations DROP COLUMN IF EXISTS token_hash;

-- ملاحظة: rpc_accept_invitation ورpc_get_invitation_preview ستعود للبحث عن
-- token_hash الذي لم يعد موجودًا — يجب إعادة نشر نسختَي 103 منهما يدويًا.

COMMIT;
