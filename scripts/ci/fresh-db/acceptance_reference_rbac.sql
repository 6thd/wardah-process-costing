-- Acceptance: البيانات المرجعية النظامية لـRBAC (modules + permissions).
--
-- أثر الفراغ هنا أخبث من أثره في UoM: لا شيء ينهار عند البناء. النظام يُبنى
-- ناجحًا ظاهريًا ثم يعمل بمرجع صلاحيات فارغ — فكل شاشة تُقاس بصلاحية غير
-- موجودة تصبح إما مغلقة للجميع أو مفتوحة للجميع، بحسب كيفية قراءة الواجهة
-- لغياب الصف. ولذلك لا يكفي عدّ الصفوف: تُفحص العلاقة والبنية المتوقعة.
--
-- يعمل على Fresh DB بعد 000 ثم 001. قراءة فقط: لا يكتب صفًا.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. الوحدات الوظيفية المعروفة موجودة
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(m, ', ') INTO v_missing
  FROM unnest(ARRAY['dashboard','manufacturing','inventory','purchasing','sales',
                    'accounting','general_ledger','hr','reports','settings']) m
  WHERE NOT EXISTS (SELECT 1 FROM public.modules WHERE name = m AND is_active);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: وحدات وظيفية مفقودة: %', v_missing;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. التكامل المرجعي: لا صلاحية بلا وحدة
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_orphans bigint;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.permissions p
  WHERE NOT EXISTS (SELECT 1 FROM public.modules m WHERE m.id = p.module_id);
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: % صلاحية تشير إلى وحدة غير موجودة', v_orphans;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. علاقات معروفة: الصلاحية تنتمي إلى وحدتها الصحيحة
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('inventory.products.read',            'inventory'),
      ('inventory.stock_moves.approve',      'inventory'),
      ('manufacturing.orders.approve',       'manufacturing'),
      ('accounting.journals.approve',        'accounting'),
      ('general_ledger.chart_of_accounts.view', 'general_ledger'),
      ('purchasing.purchase_orders.approve', 'purchasing'),
      ('sales.sales_invoices.approve',       'sales'),
      ('settings.roles.update',              'settings')
    ) AS t(permission_key, module_name)
  LOOP
    SELECT m.name INTO v_actual
    FROM public.permissions p JOIN public.modules m ON m.id = p.module_id
    WHERE p.permission_key = r.permission_key;

    IF v_actual IS NULL THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: الصلاحية % غير موجودة', r.permission_key;
    END IF;
    IF v_actual <> r.module_name THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: الصلاحية % تنتمي إلى % لا %',
        r.permission_key, v_actual, r.module_name;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. بنية المفتاح: permission_key = module.resource.action
-- ---------------------------------------------------------------------------
-- هذا العقد هو ما تبني عليه الواجهة فحص الصلاحية. انحرافه يجعل صلاحية موجودة
-- في القاعدة غير قابلة للعثور عليها من الواجهة — عطل صامت لا يكشفه أي عدّ.
DO $$
DECLARE v_bad bigint; v_sample text;
BEGIN
  SELECT count(*), min(p.permission_key) INTO v_bad, v_sample
  FROM public.permissions p JOIN public.modules m ON m.id = p.module_id
  WHERE p.permission_key <> m.name || '.' || p.resource || '.' || p.action;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: % مفتاح صلاحية يخالف module.resource.action (مثال: %)',
      v_bad, v_sample;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. لا ازدواج ولا ترجمة ناقصة
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_dupes bigint; v_untranslated bigint;
BEGIN
  SELECT count(*) INTO v_dupes FROM (
    SELECT permission_key FROM public.permissions
    GROUP BY permission_key HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: % مفتاح صلاحية مكرر', v_dupes;
  END IF;

  SELECT count(*) INTO v_untranslated
  FROM public.permissions
  WHERE NULLIF(trim(resource_ar), '') IS NULL
     OR NULLIF(trim(action_ar), '') IS NULL
     OR NULLIF(trim(description_ar), '') IS NULL;
  IF v_untranslated > 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: % صلاحية بترجمة عربية ناقصة', v_untranslated;
  END IF;
END $$;

\echo '✅ acceptance_reference_rbac: مرجع الصلاحيات كامل ومترابط وبنية مفاتيحه سليمة'
