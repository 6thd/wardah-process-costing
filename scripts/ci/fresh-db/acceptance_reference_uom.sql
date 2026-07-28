-- Acceptance: البيانات المرجعية النظامية لوحدات القياس.
--
-- لا يثبت وجود الصفوف فحسب، بل السلوك الذي يعتمد عليها. الفراغ هنا لا ينتج
-- «بيانات ناقصة» بل يقلب حارسين إلى fail-open داخل rpc_create_org_uom:
--
--   IF EXISTS (SELECT 1 FROM uoms       WHERE org_id IS NULL AND code=v_code)      → SYSTEM_UOM_CODE_RESERVED
--   IF EXISTS (SELECT 1 FROM uom_aliases WHERE org_id IS NULL AND alias_normalized=…) → SYSTEM_UOM_ALIAS_RESERVED
--
-- كلاهما يمر خاويًا على قاعدة بلا بذرة، فتستطيع مؤسسة اختطاف رمز وحدة نظامي
-- أو مرادف نظامي. لذلك تُختبر الحراسة نفسها لا وجود الصفوف.
--
-- يعمل على Fresh DB بعد 000 ثم 001. RLS يتجاوزها postgres، وauth.uid() تُضبط
-- صراحة لأن rpc_create_org_uom تستدعي wardah_assert_org_admin.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: for [%] expected [%] but got [%]',
        p_sql, p_needle, SQLERRM;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: for [%] expected error [%] but it succeeded',
      p_sql, p_needle;
  END IF;
END $$;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. الكتالوج النظامي موجود وعالمي
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['COUNT','MASS','VOLUME','LENGTH','AREA','TIME']) c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.uom_categories WHERE code = c AND is_system
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: أبعاد قياس نظامية مفقودة: %', v_missing;
  END IF;

  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['PCS','KG','G','L','M','HOUR','TON','DOZEN']) c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.uoms WHERE code = c AND org_id IS NULL AND is_active
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: وحدات نظامية مفقودة: %', v_missing;
  END IF;
END $$;

-- كل وحدة نظامية تنتمي إلى فئة موجودة، وكل فئة لها وحدة أساس واحدة بالضبط.
DO $$
DECLARE v_orphans bigint; v_bad_base bigint;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.uoms u
  WHERE u.org_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.uom_categories c WHERE c.id = u.category_id);
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: % وحدة نظامية بفئة غير موجودة', v_orphans;
  END IF;

  SELECT count(*) INTO v_bad_base
  FROM public.uom_categories c
  WHERE (SELECT count(*) FROM public.uoms u
         WHERE u.category_id = c.id AND u.org_id IS NULL AND u.is_category_base) <> 1;
  IF v_bad_base > 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: % فئة بلا وحدة أساس واحدة بالضبط', v_bad_base;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. تطبيع المرادفات يصيب وحدة نظامية معروفة
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_code text;
BEGIN
  SELECT u.code INTO v_code
  FROM public.uom_aliases a JOIN public.uoms u ON u.id = a.uom_id
  WHERE a.org_id IS NULL AND a.alias_normalized = public.uom_normalize_alias('قطعة');
  IF v_code IS DISTINCT FROM 'PCS' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: المرادف «قطعة» يُطبَّع إلى % لا PCS', COALESCE(v_code, '(لا شيء)');
  END IF;

  SELECT u.code INTO v_code
  FROM public.uom_aliases a JOIN public.uoms u ON u.id = a.uom_id
  WHERE a.org_id IS NULL AND a.alias_normalized = public.uom_normalize_alias('KILOGRAM');
  IF v_code IS DISTINCT FROM 'KG' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: المرادف KILOGRAM يُطبَّع إلى % لا KG', COALESCE(v_code, '(لا شيء)');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. الحراسة الفعلية: الرموز والمرادفات النظامية محجوزة على المؤسسات
-- ---------------------------------------------------------------------------
INSERT INTO public.organizations (id, code, name) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'ORGREF', 'Org Reference');

INSERT INTO public.user_organizations
  (id, user_id, org_id, is_active, is_org_admin, role) VALUES
  ('a1000000-0000-0000-0000-000000000001',
   'a1aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1111111-1111-1111-1111-111111111111', true, true, 'admin');

SELECT set_config('request.jwt.claim.sub', 'a1aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

-- الحارس الأول: رمز وحدة نظامي محجوز. يمر خاويًا على قاعدة بلا بذرة.
SELECT pg_temp.expect_error(
  format(
    $$ SELECT public.rpc_create_org_uom(
         'a1111111-1111-1111-1111-111111111111'::uuid, %L::uuid,
         'PCS', 'Hijacked Piece', NULL, 'hp', 1) $$,
    (SELECT id FROM public.uom_categories WHERE code = 'COUNT')),
  'SYSTEM_UOM_CODE_RESERVED');

SELECT pg_temp.expect_error(
  format(
    $$ SELECT public.rpc_create_org_uom(
         'a1111111-1111-1111-1111-111111111111'::uuid, %L::uuid,
         'KG', 'Hijacked Kilo', NULL, 'hk', 1) $$,
    (SELECT id FROM public.uom_categories WHERE code = 'MASS')),
  'SYSTEM_UOM_CODE_RESERVED');

-- الحارس الثاني: مرادف نظامي محجوز، حتى مع رمز جديد مقبول.
SELECT pg_temp.expect_error(
  format(
    $$ SELECT public.rpc_create_org_uom(
         'a1111111-1111-1111-1111-111111111111'::uuid, %L::uuid,
         'ORG_PIECE', 'Org Piece', NULL, 'op', 1, false, 6::smallint, ARRAY['قطعة']) $$,
    (SELECT id FROM public.uom_categories WHERE code = 'COUNT')),
  'SYSTEM_UOM_ALIAS_RESERVED');

-- ---------------------------------------------------------------------------
-- 4. ضابط موجب: الرفض ليس شاملًا — رمز غير محجوز يمر
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_result jsonb;
BEGIN
  SELECT public.rpc_create_org_uom(
           'a1111111-1111-1111-1111-111111111111'::uuid,
           (SELECT id FROM public.uom_categories WHERE code = 'COUNT'),
           'ORG_CRATE', 'Org Crate', NULL, 'ocr', 24)
    INTO v_result;
  IF NOT COALESCE((v_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: رمز غير محجوز رُفض: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.uoms
    WHERE code = 'ORG_CRATE' AND org_id = 'a1111111-1111-1111-1111-111111111111'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: الوحدة المخصصة لم تُكتب بنطاق المؤسسة';
  END IF;
END $$;

-- لا تُترك بيانات الاختبار في القاعدة: خطوات القبول التالية تعمل على
-- الحالة نفسها، وبقاء مؤسسة وهمية ووحدة مخصصة يلوّث بصمة أي فحص لاحق.
ROLLBACK;

\echo '✅ acceptance_reference_uom: الكتالوج النظامي موجود والحراسة تعتمد عليه فعليًا'
