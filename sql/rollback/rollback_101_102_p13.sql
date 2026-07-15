-- ===================================================================
-- Rollback لـ Migrations 101+102 (P13) — لقطة ما قبل التطبيق
-- بيئة: Supabase «Manufacturing Process» (uutfztmqvajmsxnrqeiv)
-- تاريخ اللقطة: 2026-07-12 — التحقق: الدالتان مطابقتان حرفياً لملف 100،
-- والسياسات = سياسات 99 المتساهلة + *_org_isolation القديمة (app.current_org_id
-- الميتة) + سياسات org_settings من 98.
-- ⚠️ تحذير: هذا Rollback يعيد فتح ثغرات P0 (grant المخزون، اعتماد بعضوية فقط،
-- قراءة الرواتب لكل عضو) — لا تستخدمه إلا لاستعادة طارئة مع خطة إعادة تأمين.
-- ===================================================================

-- 1) استعادة الدالتين بنسخة Migration 100 الحرفية
--    (أعد تشغيل: sql/migrations/100_p12_atomic_payroll_and_settlement_posting.sql
--     فهو CREATE OR REPLACE مطابق لما كان منشوراً — تَحقق snapshot 2026-07-12)

-- 2) إسقاط ما أضافته 102
DROP FUNCTION IF EXISTS public.rpc_submit_settlement_review(JSONB);
DROP FUNCTION IF EXISTS public.wardah_settlement_snapshot(UUID);
ALTER TABLE hr_settlements DROP CONSTRAINT IF EXISTS fk_hr_settlements_employee_org;
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS fk_attendance_records_employee_org;
ALTER TABLE employee_leaves DROP CONSTRAINT IF EXISTS fk_employee_leaves_employee_org;
ALTER TABLE employee_salary_structures DROP CONSTRAINT IF EXISTS fk_employee_salary_structures_employee_org;
ALTER TABLE salary_components DROP CONSTRAINT IF EXISTS chk_salary_components_percentage_base;
-- الأعمدة الجديدة تُترك (إضافية غير ضارة): termination_type/review_hash/reviewed_by/
-- reviewed_at/request_hash/posted_snapshot — حذفها يفقد بيانات تدقيق.
-- ملاحظة: ترحيل بيانات E7 (termination_type) لا يُعكس تلقائياً.

-- 3) إسقاط ما أضافته 101
ALTER TABLE payroll_details DROP CONSTRAINT IF EXISTS fk_payroll_details_employee_org;
DROP INDEX IF EXISTS uq_employees_id_org;
DROP FUNCTION IF EXISTS public.wardah_is_org_admin(UUID);
-- إعادة grant دالة المخزون (حالة ما قبل 101 — ثغرة P0-1 كما كانت بعد 97):
GRANT EXECUTE ON FUNCTION public.wardah_apply_stock_incoming(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, UUID, TEXT, DATE) TO authenticated;

-- 4) استعادة سياسات ما قبل 101 على الجداول الثمانية:
--    أ. سياسات 99: أعد تشغيل القسم 1 من
--       sql/migrations/99_p12_hr_foundation_hardening.sql (حلقة الجداول الثمانية)
--    ب. سياسات org_settings: أعد تشغيل قسم السياسات من
--       sql/migrations/98_p11_org_settings.sql
--    ج. سياسات *_org_isolation القديمة (كانت قائمة وميتة عملياً — تعتمد
--       app.current_org_id الذي لا يضبطه عميل Supabase). نصها الموحد لكل جدول
--       من الثمانية إن أردت استعادتها حرفياً:
--       CREATE POLICY <table>_org_isolation ON <table> AS PERMISSIVE FOR ALL TO public
--         USING (org_id = (current_setting('app.current_org_id', true))::uuid)
--         WITH CHECK (org_id = (current_setting('app.current_org_id', true))::uuid);
