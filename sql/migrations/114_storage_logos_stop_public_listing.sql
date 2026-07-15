-- ===================================================================
-- Migration 114: إيقاف السرد العام لملفات bucket شعارات المؤسسات
-- ===================================================================
-- تحذير Advisor: «Public Bucket Allows Listing» — سياسة SELECT عريضة
--   (bucket_id = 'organization-logos') لدور public على storage.objects.
-- الحقيقة التقنية:
--   الـ bucket عام (public=true) ⇒ تنزيل الشعار عبر الرابط العام
--   /storage/v1/object/public/… لا يمرّ على RLS إطلاقاً — السياسة العريضة
--   لا تخدم العرض؛ كل ما تتيحه هو أن يسرد أي مجهول (anon) أسماء كل
--   الملفات لكل المؤسسات عبر storage API (تسريب metadata: عدد المؤسسات،
--   org_ids، تواريخ الرفع).
-- الإصلاح:
--   حذف السياسة العامة، واستبدالها بسياسة SELECT لأعضاء المؤسسة على
--   مجلد مؤسستهم فقط (نمط foldername المستخدم في سياسات الرفع/الحذف
--   القائمة) — يحفظ upsert/remove اللذين يتحققان من SELECT داخلياً.
-- الأثر على الواجهة: صفر — العرض عبر getPublicUrl يبقى كما هو.
-- ===================================================================

BEGIN;

DROP POLICY IF EXISTS "Public read access for organization logos" ON storage.objects;

CREATE POLICY "Org members can read their organization logos"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'organization-logos'
    AND (storage.foldername(name))[1] IN (
        SELECT (uo.org_id)::text
        FROM public.user_organizations uo
        WHERE uo.user_id = auth.uid()
          AND uo.is_active = true
    )
);

-- تحقق: السياسة العامة اختفت والبديلة موجودة
DO $$
DECLARE
    v_public INT;
    v_scoped INT;
BEGIN
    SELECT COUNT(*) INTO v_public
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public read access for organization logos';

    SELECT COUNT(*) INTO v_scoped
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Org members can read their organization logos';

    IF v_public > 0 THEN
        RAISE EXCEPTION 'FAIL[114-1] — السياسة العامة لا تزال موجودة';
    END IF;
    IF v_scoped = 0 THEN
        RAISE EXCEPTION 'FAIL[114-2] — السياسة البديلة المُقيَّدة غير موجودة';
    END IF;
    RAISE NOTICE 'VERIFY[114] ✓ — السرد العام موقوف، قراءة API مقيَّدة بأعضاء المؤسسة';
END;
$$;

COMMIT;
