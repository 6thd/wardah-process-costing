-- =====================================================================
-- 149_ap_three_way_match_allocations
-- =====================================================================
-- الشريحة الأولى من المطابقة الثلاثية:
--   Purchase Order ↔ Goods Receipt ↔ Supplier Invoice
--
-- العقد المعماري في docs/db/AP_THREE_WAY_MATCH_FOUNDATION.md.
--
-- ---------------------------------------------------------------------
-- 1) لماذا سجل تخصيصات لا عمود تراكمي
-- ---------------------------------------------------------------------
-- العمود التراكمي على سطر الاستلام أسرع، لكنه حقيقة ثانية تجب مزامنتها مع
-- الفواتير دائمًا؛ وأي عكس أو إلغاء أو إشعار دائن يتركه منحرفًا بصمت.
--
-- `supplier_invoice_receipt_allocations` دفتر append-only: كل تخصيص صف موجب،
-- وكل عكس صف جديد يشير إلى أصله. الرصيد يُشتق ولا يُخزَّن:
--
--     المقبول من سطر الاستلام
--   − مجموع التخصيصات النشطة
--   + مجموع التخصيصات المعكوسة
--   = المقبول غير المفوتر
--
-- ويعطي provenance تحتاجه المطابقة: أي فاتورة استهلكت أي استلام، وكم بقي، وكيف
-- يُعكس، وكيف يُدقَّق سباقٌ أو إعادة محاولة.
--
-- ---------------------------------------------------------------------
-- 2) مصدر الكمية المقبولة
-- ---------------------------------------------------------------------
-- المصدر التشغيلي هو `goods_receipt_lines` ذات `quality_status = 'accepted'`،
-- لأن الفاتورة تطابق استلامًا بعينه لا إجماليًا على أمر الشراء.
--
-- و`purchase_order_lines.accepted_quantity` حارس مصالحة وسقف إجمالي لا مصدر
-- رصيد: يمنع تجاوز المقبول على مستوى سطر الأمر، ويكشف انحراف تجميع الاستلامات
-- عن القيمة التراكمية. الاعتماد عليه وحده يفقد تفاصيل أي GRN استُهلك.
--
-- ---------------------------------------------------------------------
-- 3) الحالة النهائية المتسقة
-- ---------------------------------------------------------------------
--     supplier_invoices.status = 'approved'   ← دورة المستند
--     allocations              = active
--     gl_entries.status        = 'posted'     ← دورة القيد
--
-- `approved` لا `posted` على الفاتورة: المخطط لا يعرف `posted` لفاتورة مورد،
-- وإضافتها لتوحيد الأسماء تخلط دورة المستند بدورة القيد. ولا حالة وسطية: إما
-- الثلاثة معًا أو لا شيء.
--
-- ---------------------------------------------------------------------
-- 4) القيد المحاسبي: النواة القائمة لا نسخة منها
-- ---------------------------------------------------------------------
-- `rpc_create_journal_entry` نواة قانونية صارمة بالفعل: تتحقق من المؤسسة
-- (TENANT_MISSING) والفترة (assert_period_open) وتوازن المدين والدائن
-- (UNBALANCED_ENTRY) ورفض القيد الفارغ والصفري، وتدعم أسطرًا متعددة
-- وidempotency، ولا تعيد success=false مع استمرار المعاملة — كل فشل يرفع
-- استثناء. فتُستدعى كما هي داخل المعاملة نفسها، ولا يُنسخ منطق دفتر الأستاذ هنا.
--
--     Dr GRNI clearing
--     Dr Input VAT
--         Cr Accounts Payable
--
-- ---------------------------------------------------------------------
-- 5) خارج الشريحة الأولى عمدًا
-- ---------------------------------------------------------------------
-- الفواتير المباشرة بلا أمر/استلام، وإشعارات الدائن والمرتجعات، ومسار الإلغاء
-- والعكس، وتوزيع التكلفة المستوردة، والتسامح القابل للضبط، وترحيل فرق السعر،
-- والمطابقة متعددة العملات. والشريحة الأولى **صفر تسامح**: أي فرق سعر يرفض
-- الفاتورة ولا يُنشئها بحالة استثناء.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- القسم 1: دقة الكمية — قبل أي كتابة جديدة
-- ---------------------------------------------------------------------
--     goods_receipt_lines.received_quantity   numeric(18,6)
--     supplier_invoice_lines.quantity         numeric(12,2)  ← منزلتان
--
-- فوترة كمية مقبولة بأكثر من منزلتين تُقرَّب عند الإدخال ثم تُقارن برصيد غير
-- مقرَّب: تسريب فوترة جزئية صامت لا مسألة عرض.
--
-- وPostgreSQL يرفض تغيير نوع عمود يعتمد عليه عمود محسوب:
--
--   ERROR: cannot alter type of a column used by a generated column
--   DETAIL: Column "quantity" is used by generated column "line_total"
--
-- فيلزم إسقاط `line_total` وإعادته بالتعبير نفسه داخل المعاملة ذاتها. وهذا لا
-- يخالف القاعدة الذهبية في CLAUDE.md: العمود **محسوب**، قيمه مشتقة بالكامل من
-- `quantity` و`unit_cost` و`discount_percentage` و`tax_percentage` — وكلها تبقى
-- كما هي، وPostgreSQL يعيد حسابه صفًا صفًا. ولو كان عمودًا مخزَّنًا عاديًا لما جاز.
--
-- التعبير أدناه منسوخ حرفيًا من `pg_get_expr` على قاعدة حية لا مُعاد كتابته: أي
-- اختلاف في الأقواس أو الصبّ يغيّر التقريب بصمت.
--
-- ويتّسع `line_total` معه إلى numeric(18,2). المنازل تبقى منزلتين — تقريب العملة
-- شأن مستقل عن دقة الكمية — لكن الجزء الصحيح يتّسع من 10 أرقام إلى 16. فبلا ذلك
-- تصير كمية بـ12 رقمًا صحيحًا مضروبةً في سعر قادرةً على تجاوز سعة الناتج، فتفشل
-- الكتابة بـnumeric field overflow عند حدٍّ لم يكن قائمًا قبل التوسيع.
-- و(18,2) هو عرض المبالغ نفسه في `gl_entry_lines`.
ALTER TABLE public.supplier_invoice_lines
  DROP COLUMN line_total;

ALTER TABLE public.supplier_invoice_lines
  ALTER COLUMN quantity TYPE numeric(18,6);

ALTER TABLE public.supplier_invoice_lines
  ADD COLUMN line_total numeric(18,2)
  GENERATED ALWAYS AS (
    (((quantity * unit_cost) * ((1)::numeric - (discount_percentage / (100)::numeric)))
     * ((1)::numeric + (tax_percentage / (100)::numeric)))
  ) STORED;

-- ---------------------------------------------------------------------
-- القسم 2: أعمدة الإثبات على الفاتورة وأسطرها
-- ---------------------------------------------------------------------
-- كلها nullable: المسار التقليدي غير المطابَق يبقى يعمل دون تعبئتها، والمسار
-- المطابَق يملؤها كاملة.
ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_hash text,
  ADD COLUMN IF NOT EXISTS match_status text,
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid,
  ADD COLUMN IF NOT EXISTS matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS matched_by uuid;

ALTER TABLE public.supplier_invoice_lines
  ADD COLUMN IF NOT EXISTS purchase_order_line_id uuid,
  ADD COLUMN IF NOT EXISTS uom_id uuid,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,6),
  ADD COLUMN IF NOT EXISTS conversion_factor_snapshot numeric(30,12),
  ADD COLUMN IF NOT EXISTS unit_cost_entered numeric(18,6),
  ADD COLUMN IF NOT EXISTS po_unit_price_snapshot numeric(18,6),
  ADD COLUMN IF NOT EXISTS quantity_variance numeric(18,6),
  ADD COLUMN IF NOT EXISTS price_variance numeric(18,6),
  ADD COLUMN IF NOT EXISTS match_status text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_invoices_match_status_check') THEN
    ALTER TABLE public.supplier_invoices
      ADD CONSTRAINT supplier_invoices_match_status_check
      CHECK (match_status IS NULL OR match_status IN ('matched'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_invoice_lines_match_status_check') THEN
    ALTER TABLE public.supplier_invoice_lines
      ADD CONSTRAINT supplier_invoice_lines_match_status_check
      CHECK (match_status IS NULL OR match_status IN ('matched'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_invoice_lines_po_line_fk') THEN
    ALTER TABLE public.supplier_invoice_lines
      ADD CONSTRAINT supplier_invoice_lines_po_line_fk
      FOREIGN KEY (purchase_order_line_id) REFERENCES public.purchase_order_lines(id);
  END IF;
END $$;

-- مفتاح idempotency فريد داخل المؤسسة لا عالميًا.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoices_org_idempotency_uk
  ON public.supplier_invoices (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- رقم فاتورة المورد فريد داخل (المؤسسة، المورد) للمسار المطابَق. جزئي عمدًا:
-- لا يُفرض بأثر رجعي على الفواتير التقليدية القائمة.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoices_org_vendor_number_matched_uk
  ON public.supplier_invoices (org_id, vendor_id, upper(btrim(invoice_number)))
  WHERE match_status = 'matched';

-- ---------------------------------------------------------------------
-- القسم 3: دفتر التخصيصات
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_invoice_receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  supplier_invoice_id uuid NOT NULL REFERENCES public.supplier_invoices(id),
  supplier_invoice_line_id uuid NOT NULL REFERENCES public.supplier_invoice_lines(id),
  goods_receipt_line_id uuid NOT NULL REFERENCES public.goods_receipt_lines(id),
  purchase_order_line_id uuid NOT NULL REFERENCES public.purchase_order_lines(id),

  -- الكمية بالوحدة الأساس دائمًا. الوحدة التجارية تُحفظ على سطر الفاتورة مع
  -- عامل التحويل اللقطة؛ والرصيد يُحسب بالأساس وحده فلا يختلط مقياسان.
  quantity_base numeric(18,6) NOT NULL CHECK (quantity_base > 0),

  -- العكس صفٌّ جديد يشير إلى أصله، لا تعديل على الأصل.
  reversal_of_allocation_id uuid REFERENCES public.supplier_invoice_receipt_allocations(id),
  reversal_reason text,

  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,

  CONSTRAINT supplier_invoice_receipt_allocations_not_self_reversal
    CHECK (reversal_of_allocation_id IS NULL OR reversal_of_allocation_id <> id)
);

COMMENT ON TABLE public.supplier_invoice_receipt_allocations IS
  'دفتر append-only يربط سطر فاتورة مورد بسطر استلام مقبول. الرصيد غير المفوتر يُشتق منه ولا يُخزَّن. العكس صفّ جديد لا تعديل.';

CREATE INDEX IF NOT EXISTS supplier_invoice_receipt_allocations_receipt_line_idx
  ON public.supplier_invoice_receipt_allocations (goods_receipt_line_id)
  WHERE reversal_of_allocation_id IS NULL;

CREATE INDEX IF NOT EXISTS supplier_invoice_receipt_allocations_po_line_idx
  ON public.supplier_invoice_receipt_allocations (purchase_order_line_id);

CREATE INDEX IF NOT EXISTS supplier_invoice_receipt_allocations_invoice_idx
  ON public.supplier_invoice_receipt_allocations (supplier_invoice_id);

CREATE INDEX IF NOT EXISTS supplier_invoice_receipt_allocations_org_idx
  ON public.supplier_invoice_receipt_allocations (org_id);

-- كل أصل يُعكس مرة واحدة على الأكثر.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_receipt_allocations_reversal_uk
  ON public.supplier_invoice_receipt_allocations (reversal_of_allocation_id)
  WHERE reversal_of_allocation_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- القسم 4: عدم القابلية للتعديل يُفرض في القاعدة
-- ---------------------------------------------------------------------
-- الدفتر append-only بالعقد؛ وبلا حارس يبقى ذلك اتفاقًا يكسره أول UPDATE.
CREATE OR REPLACE FUNCTION public.wardah_guard_allocation_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION
    'AP_ALLOCATION_IMMUTABLE: دفتر التخصيصات append-only — العكس يكون بصف جديد يشير إلى أصله، لا بتعديل أو حذف (العملية: %)',
    TG_OP;
END $$;

REVOKE ALL ON FUNCTION public.wardah_guard_allocation_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_guard_allocation_immutability() FROM anon;
REVOKE ALL ON FUNCTION public.wardah_guard_allocation_immutability() FROM authenticated;

DROP TRIGGER IF EXISTS trg_supplier_invoice_receipt_allocations_immutable
  ON public.supplier_invoice_receipt_allocations;
CREATE TRIGGER trg_supplier_invoice_receipt_allocations_immutable
  BEFORE UPDATE OR DELETE ON public.supplier_invoice_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION public.wardah_guard_allocation_immutability();

-- ---------------------------------------------------------------------
-- القسم 5: عزل المؤسسات
-- ---------------------------------------------------------------------
ALTER TABLE public.supplier_invoice_receipt_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_invoice_receipt_allocations_org_isolation
  ON public.supplier_invoice_receipt_allocations;
CREATE POLICY supplier_invoice_receipt_allocations_org_isolation
  ON public.supplier_invoice_receipt_allocations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_organizations uo
      WHERE uo.org_id = supplier_invoice_receipt_allocations.org_id
        AND uo.user_id = auth.uid()
        AND uo.is_active IS TRUE
    )
  );

GRANT SELECT ON public.supplier_invoice_receipt_allocations TO authenticated;
REVOKE ALL ON public.supplier_invoice_receipt_allocations FROM anon;

-- ---------------------------------------------------------------------
-- القسم 6: الرصيد المقبول غير المفوتر — دالة اشتقاق واحدة
-- ---------------------------------------------------------------------
-- تُستعمل من القراءة ومن الكتابة معًا، فلا يتباعد تعريفان للرصيد.
CREATE OR REPLACE FUNCTION public.wardah_receipt_line_uninvoiced_base(
  p_goods_receipt_line_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_accepted_base numeric(18,6);
  v_allocated_base numeric(18,6);
BEGIN
  -- `quality_status` حالة السطر كاملًا في عقد 148، فسطر غير مقبول رصيده صفر.
  SELECT CASE
           WHEN grl.quality_status <> 'accepted' THEN 0
           ELSE COALESCE(grl.received_quantity, 0)
         END
    INTO v_accepted_base
  FROM public.goods_receipt_lines grl
  WHERE grl.id = p_goods_receipt_line_id;

  IF v_accepted_base IS NULL THEN
    RAISE EXCEPTION 'AP_GRN_LINE_NOT_FOUND: سطر استلام غير موجود (%)', p_goods_receipt_line_id;
  END IF;

  SELECT COALESCE(SUM(
           CASE WHEN a.reversal_of_allocation_id IS NULL
                THEN a.quantity_base
                ELSE -a.quantity_base
           END), 0)
    INTO v_allocated_base
  FROM public.supplier_invoice_receipt_allocations a
  WHERE a.goods_receipt_line_id = p_goods_receipt_line_id;

  RETURN v_accepted_base - v_allocated_base;
END $$;

REVOKE ALL ON FUNCTION public.wardah_receipt_line_uninvoiced_base(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_receipt_line_uninvoiced_base(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.wardah_receipt_line_uninvoiced_base(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- القسم 7: RPC المطابقة النهائية
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_matched_supplier_invoice(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_org             uuid;
  v_vendor          uuid;
  v_invoice_number  text;
  v_number_norm     text;
  v_invoice_date    date;
  v_due_date        date;
  v_idem_invoice    text;
  v_idem_journal    text;
  v_existing        record;
  v_line            jsonb;
  v_invoice_id      uuid;
  v_invoice_line_id uuid;
  v_line_no         integer := 0;
  v_grl             record;
  v_pol             record;
  v_available       numeric(18,6);
  v_qty             numeric(18,6);
  v_price           numeric(18,6);
  v_disc            numeric(5,2);
  v_tax             numeric(5,2);
  v_net             numeric(18,6);
  v_goods_total     numeric(18,2) := 0;
  v_vat_total       numeric(18,2) := 0;
  v_map_goods       record;
  v_map_vat         record;
  v_acc_grni        uuid;
  v_acc_vat         uuid;
  v_acc_ap          uuid;
  v_journal         jsonb;
  v_entry_id        uuid;
  v_entry_status    text;
  v_drift           numeric(18,6);
  v_lines           jsonb;
BEGIN
  -- === 1. المؤسسة والحراسة ===============================================
  -- المؤسسة تُصرَّح في الحمولة ثم **يُتحقق منها**؛ لا تُؤخذ بثقة. العضوية
  -- النشطة أولًا، ثم صلاحية الاعتماد/الترحيل. المطابقة تثبت صحة المستند ولا
  -- تثبت أن المستدعي يحق له الترحيل — شرطان مستقلان.
  v_org := NULLIF(p_payload ->> 'org_id', '')::uuid;
  PERFORM public.wardah_assert_org_member(v_org);

  IF NOT public.has_permission(auth.uid(), v_org, 'purchasing.purchase_invoices.approve') THEN
    RAISE EXCEPTION
      'AP_POST_PERMISSION_DENIED: هذا المسار ينشئ الفاتورة ويرحّل قيدها معًا، ويتطلب صلاحية purchasing.purchase_invoices.approve';
  END IF;

  -- === 2. الترويسة =======================================================
  v_vendor         := NULLIF(p_payload ->> 'vendor_id', '')::uuid;
  v_invoice_number := btrim(COALESCE(p_payload ->> 'invoice_number', ''));
  v_number_norm    := upper(v_invoice_number);
  v_invoice_date   := COALESCE(NULLIF(p_payload ->> 'invoice_date', '')::date, CURRENT_DATE);
  v_due_date       := NULLIF(p_payload ->> 'due_date', '')::date;

  IF v_vendor IS NULL THEN
    RAISE EXCEPTION 'AP_VENDOR_REQUIRED: معرّف المورد مطلوب';
  END IF;
  IF v_invoice_number = '' THEN
    RAISE EXCEPTION 'AP_INVOICE_NUMBER_REQUIRED: رقم فاتورة المورد مطلوب';
  END IF;
  IF v_due_date IS NOT NULL AND v_due_date < v_invoice_date THEN
    RAISE EXCEPTION 'AP_DUE_DATE_BEFORE_INVOICE_DATE: تاريخ الاستحقاق قبل تاريخ الفاتورة';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = v_vendor AND s.org_id = v_org) THEN
    RAISE EXCEPTION 'AP_VENDOR_MISMATCH: المورد لا ينتمي إلى المؤسسة المحددة';
  END IF;

  -- الفترة تُفحص هنا صراحةً أيضًا لا في القيد وحده: الفشل قبل أي كتابة أوضح.
  PERFORM public.assert_period_open(v_org, v_invoice_date);

  -- === 3. idempotency على مستوى الفاتورة =================================
  -- مشتق من هوية المستند داخل المؤسسة، لا UUID جديد في كل محاولة.
  v_idem_invoice := 'ap-invoice:' || v_org::text || ':' || v_vendor::text || ':' || v_number_norm;

  SELECT id, journal_entry_id, total_amount INTO v_existing
  FROM public.supplier_invoices
  WHERE org_id = v_org AND idempotency_key = v_idem_invoice;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'invoice_id', v_existing.id,
      'journal_entry_id', v_existing.journal_entry_id,
      'total_amount', v_existing.total_amount
    );
  END IF;

  -- === 4. تحقق شكلي قبل أي قفل ===========================================
  IF jsonb_typeof(p_payload -> 'lines') <> 'array'
     OR jsonb_array_length(p_payload -> 'lines') = 0 THEN
    RAISE EXCEPTION 'AP_LINES_REQUIRED: الفاتورة تحتاج سطرًا واحدًا على الأقل';
  END IF;

  -- === 5. الأقفال بترتيب ثابت ============================================
  -- سطور أمر الشراء أولًا ثم سطور الاستلام، وكلاهما مرتب بالمعرّف. الترتيب
  -- الثابت هو ما يمنع deadlock بين جلستين تفوتران استلامات متقاطعة.
  PERFORM 1
  FROM public.purchase_order_lines pol
  WHERE pol.id IN (
    SELECT grl.purchase_order_line_id
    FROM public.goods_receipt_lines grl
    WHERE grl.id IN (
      SELECT (l ->> 'goods_receipt_line_id')::uuid
      FROM jsonb_array_elements(p_payload -> 'lines') l
    )
  )
  ORDER BY pol.id
  FOR UPDATE;

  PERFORM 1
  FROM public.goods_receipt_lines grl
  WHERE grl.id IN (
    SELECT (l ->> 'goods_receipt_line_id')::uuid
    FROM jsonb_array_elements(p_payload -> 'lines') l
  )
  ORDER BY grl.id
  FOR UPDATE;

  -- === 6. الفاتورة (بمبالغ صفرية تُحدَّث بعد الأسطر) ======================
  INSERT INTO public.supplier_invoices (
    org_id, invoice_number, vendor_id, invoice_date, due_date,
    subtotal, tax_amount, total_amount, status,
    idempotency_key, match_status, matched_at, matched_by, created_by
  ) VALUES (
    v_org, v_invoice_number, v_vendor, v_invoice_date, v_due_date,
    0, 0, 0, 'approved',
    v_idem_invoice, 'matched', now(), auth.uid(), auth.uid()
  )
  RETURNING id INTO v_invoice_id;

  -- === 7. سطر سطر: تحقق تحت القفل ثم كتابة ===============================
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_payload -> 'lines')
  LOOP
    v_line_no := v_line_no + 1;

    SELECT grl.*, gr.org_id AS receipt_org
      INTO v_grl
    FROM public.goods_receipt_lines grl
    JOIN public.goods_receipts gr ON gr.id = grl.goods_receipt_id
    WHERE grl.id = (v_line ->> 'goods_receipt_line_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'AP_GRN_LINE_NOT_FOUND: سطر استلام غير موجود (السطر %)', v_line_no;
    END IF;
    IF v_grl.org_id <> v_org OR v_grl.receipt_org <> v_org THEN
      RAISE EXCEPTION 'AP_CROSS_ORG_REFERENCE: سطر الاستلام خارج المؤسسة (السطر %)', v_line_no;
    END IF;
    IF v_grl.quality_status <> 'accepted' THEN
      RAISE EXCEPTION
        'AP_GRN_LINE_NOT_ACCEPTED: لا تُفوتر كمية غير مقبولة — حالة الجودة % (السطر %)',
        v_grl.quality_status, v_line_no;
    END IF;
    IF v_grl.purchase_order_line_id IS NULL THEN
      RAISE EXCEPTION
        'AP_GRN_LINE_WITHOUT_PO: هذا المسار للفواتير المستندة إلى أمر شراء (السطر %)', v_line_no;
    END IF;

    SELECT pol.*, po.status AS order_status, po.supplier_id AS order_vendor
      INTO v_pol
    FROM public.purchase_order_lines pol
    JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
    WHERE pol.id = v_grl.purchase_order_line_id;

    IF v_pol.org_id <> v_org THEN
      RAISE EXCEPTION 'AP_CROSS_ORG_REFERENCE: سطر أمر الشراء خارج المؤسسة (السطر %)', v_line_no;
    END IF;
    IF v_pol.order_vendor <> v_vendor THEN
      RAISE EXCEPTION 'AP_VENDOR_MISMATCH: أمر الشراء يخص موردًا آخر (السطر %)', v_line_no;
    END IF;
    IF v_pol.order_status NOT IN ('approved', 'partially_received', 'received', 'closed') THEN
      RAISE EXCEPTION
        'AP_PO_NOT_INVOICEABLE: حالة أمر الشراء % لا تسمح بالفوترة (السطر %)',
        v_pol.order_status, v_line_no;
    END IF;
    IF v_pol.product_id <> v_grl.product_id THEN
      RAISE EXCEPTION 'AP_PRODUCT_MISMATCH: المنتج يختلف بين الأمر والاستلام (السطر %)', v_line_no;
    END IF;

    -- الكمية: موجبة وبست منازل كحدّ. التقريب الصامت هو ما تمنعه دقة (18,6).
    v_qty := (v_line ->> 'quantity_base')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'AP_QUANTITY_INVALID: الكمية يجب أن تكون موجبة (السطر %)', v_line_no;
    END IF;
    IF v_qty <> round(v_qty, 6) THEN
      RAISE EXCEPTION 'AP_QUANTITY_PRECISION: الكمية تتجاوز ست منازل عشرية (السطر %)', v_line_no;
    END IF;

    -- الرصيد يُعاد حسابه **تحت القفل**، لا من قراءة سابقة.
    v_available := public.wardah_receipt_line_uninvoiced_base(v_grl.id);
    IF v_qty > v_available THEN
      RAISE EXCEPTION
        'AP_QUANTITY_EXCEEDS_RECEIPT: المطلوب % والمتاح المقبول غير المفوتر % (السطر %)',
        v_qty, v_available, v_line_no;
    END IF;

    -- السعر: صفر تسامح في الشريحة الأولى. لا فاتورة بحالة استثناء.
    v_price := (v_line ->> 'unit_price')::numeric;
    IF v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'AP_PRICE_INVALID: سعر الوحدة مطلوب وغير سالب (السطر %)', v_line_no;
    END IF;
    IF round(v_price, 6) <> round(COALESCE(v_pol.unit_price, -1), 6) THEN
      RAISE EXCEPTION
        'AP_PRICE_VARIANCE_REQUIRES_APPROVAL: سعر الفاتورة % يخالف لقطة أمر الشراء % (السطر %)',
        v_price, v_pol.unit_price, v_line_no;
    END IF;

    v_disc := COALESCE((v_line ->> 'discount_percentage')::numeric, COALESCE(v_pol.discount_percentage, 0));
    v_tax  := COALESCE((v_line ->> 'tax_percentage')::numeric, COALESCE(v_pol.tax_percentage, 0));

    INSERT INTO public.supplier_invoice_lines (
      org_id, supplier_invoice_id, goods_receipt_line_id, purchase_order_line_id,
      line_number, product_id, quantity, unit_cost,
      discount_percentage, tax_percentage,
      uom_id, conversion_factor_snapshot, po_unit_price_snapshot,
      quantity_variance, price_variance, match_status
    ) VALUES (
      v_org, v_invoice_id, v_grl.id, v_pol.id,
      v_line_no, v_grl.product_id, v_qty, v_price,
      v_disc, v_tax,
      v_grl.uom_id, v_grl.conversion_factor_snapshot, v_pol.unit_price,
      0, 0, 'matched'
    )
    RETURNING id INTO v_invoice_line_id;

    INSERT INTO public.supplier_invoice_receipt_allocations (
      org_id, supplier_invoice_id, supplier_invoice_line_id,
      goods_receipt_line_id, purchase_order_line_id,
      quantity_base, idempotency_key, created_by
    ) VALUES (
      v_org, v_invoice_id, v_invoice_line_id,
      v_grl.id, v_pol.id,
      v_qty, v_idem_invoice || ':' || v_line_no::text, auth.uid()
    );

    -- المبالغ: الكمية بست منازل، والمال بمنزلتين. التقريب يقع هنا وحده.
    v_net         := v_qty * v_price * (1 - v_disc / 100);
    v_goods_total := v_goods_total + round(v_net, 2);
    v_vat_total   := v_vat_total   + round(v_net * v_tax / 100, 2);
  END LOOP;

  -- === 8. مصالحة على مستويين ============================================
  -- التفصيلي: لا تخصيصات تتجاوز المقبول على سطر الاستلام.
  SELECT max(over_alloc) INTO v_drift
  FROM (
    SELECT SUM(CASE WHEN a.reversal_of_allocation_id IS NULL
                    THEN a.quantity_base ELSE -a.quantity_base END)
             - CASE WHEN grl.quality_status = 'accepted'
                    THEN COALESCE(grl.received_quantity, 0) ELSE 0 END AS over_alloc
    FROM public.supplier_invoice_receipt_allocations a
    JOIN public.goods_receipt_lines grl ON grl.id = a.goods_receipt_line_id
    WHERE a.goods_receipt_line_id IN (
      SELECT goods_receipt_line_id
      FROM public.supplier_invoice_receipt_allocations
      WHERE supplier_invoice_id = v_invoice_id
    )
    GROUP BY a.goods_receipt_line_id, grl.quality_status, grl.received_quantity
  ) s;

  IF COALESCE(v_drift, 0) > 0 THEN
    RAISE EXCEPTION 'AP_ALLOCATION_EXCEEDS_RECEIPT: التخصيصات تتجاوز المقبول بمقدار %', v_drift;
  END IF;

  -- الحارس الإجمالي: تراكم PO لا يتجاوز المقبول المسجّل على سطر الأمر. يكشف
  -- انحراف تجميع الاستلامات عن القيمة التراكمية، ولا يُستعمل مصدرًا للرصيد.
  SELECT max(over_alloc) INTO v_drift
  FROM (
    SELECT SUM(CASE WHEN a.reversal_of_allocation_id IS NULL
                    THEN a.quantity_base ELSE -a.quantity_base END)
             - COALESCE(pol.accepted_quantity, 0) AS over_alloc
    FROM public.supplier_invoice_receipt_allocations a
    JOIN public.purchase_order_lines pol ON pol.id = a.purchase_order_line_id
    WHERE a.purchase_order_line_id IN (
      SELECT purchase_order_line_id
      FROM public.supplier_invoice_receipt_allocations
      WHERE supplier_invoice_id = v_invoice_id
    )
    GROUP BY a.purchase_order_line_id, pol.accepted_quantity
  ) s;

  IF COALESCE(v_drift, 0) > 0 THEN
    RAISE EXCEPTION
      'AP_ALLOCATION_EXCEEDS_PO_ACCEPTED: تخصيصات سطر الأمر تتجاوز المقبول المسجّل بمقدار % — انحراف بين تراكم الأمر وسطور الاستلام',
      v_drift;
  END IF;

  -- === 9. إجماليات الفاتورة =============================================
  IF v_goods_total + v_vat_total <= 0 THEN
    RAISE EXCEPTION 'AP_ZERO_INVOICE: إجمالي الفاتورة صفر أو سالب';
  END IF;

  UPDATE public.supplier_invoices
  SET subtotal     = v_goods_total,
      tax_amount   = v_vat_total,
      total_amount = v_goods_total + v_vat_total,
      updated_at   = now()
  WHERE id = v_invoice_id;

  -- === 10. الحسابات الثلاثة ==============================================
  -- gl_event_mappings ثنائية الطرف، فتُقرأ خريطتان متوازنتان ويُشترط اتفاقهما
  -- على حساب الدائن نفسه — وإلا فالخريطة متناقضة وتوزّع AP على حسابين.
  SELECT * INTO v_map_goods FROM public.gl_event_mappings
  WHERE org_id = v_org AND event_code = 'AP_MATCHED_INVOICE_GOODS'
    AND work_center_code IS NULL AND is_active = true
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'AP_ACCOUNT_MAPPING_MISSING: لا خريطة للحدث AP_MATCHED_INVOICE_GOODS (مدين تصفية GRNI / دائن الذمم الدائنة)';
  END IF;

  SELECT * INTO v_map_vat FROM public.gl_event_mappings
  WHERE org_id = v_org AND event_code = 'AP_MATCHED_INVOICE_VAT'
    AND work_center_code IS NULL AND is_active = true
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'AP_ACCOUNT_MAPPING_MISSING: لا خريطة للحدث AP_MATCHED_INVOICE_VAT (مدين ضريبة المدخلات / دائن الذمم الدائنة)';
  END IF;

  IF v_map_goods.credit_account_code <> v_map_vat.credit_account_code THEN
    RAISE EXCEPTION
      'AP_ACCOUNT_MAPPING_INCONSISTENT: خريطتا البضاعة والضريبة تدلّان على حسابي دائن مختلفين (% و%) — الذمم الدائنة حساب واحد في هذا القيد',
      v_map_goods.credit_account_code, v_map_vat.credit_account_code;
  END IF;

  SELECT id INTO v_acc_grni FROM public.gl_accounts
  WHERE org_id = v_org AND code = v_map_goods.debit_account_code;
  SELECT id INTO v_acc_vat  FROM public.gl_accounts
  WHERE org_id = v_org AND code = v_map_vat.debit_account_code;
  SELECT id INTO v_acc_ap   FROM public.gl_accounts
  WHERE org_id = v_org AND code = v_map_goods.credit_account_code;

  IF v_acc_grni IS NULL OR v_acc_vat IS NULL OR v_acc_ap IS NULL THEN
    RAISE EXCEPTION
      'AP_ACCOUNT_NOT_FOUND: حساب من حسابات القيد غير موجود (GRNI=% VAT=% AP=%)',
      v_map_goods.debit_account_code, v_map_vat.debit_account_code, v_map_goods.credit_account_code;
  END IF;

  -- === 11. القيد: النواة القائمة، مرحَّلًا داخل المعاملة =================
  -- سطر الضريبة يُحذف إذا كانت صفرًا: قيد بلا ضريبة قيد سليم لا ناقص.
  v_idem_journal := 'ap-invoice-journal:' || v_invoice_id::text;

  v_lines := jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_acc_grni,
                       'debit', v_goods_total, 'credit', 0,
                       'description', 'GRNI clearing')
  );
  IF v_vat_total > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('line_number', 2, 'account_id', v_acc_vat,
                         'debit', v_vat_total, 'credit', 0,
                         'description', 'Input VAT')
    );
  END IF;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('line_number', 3, 'account_id', v_acc_ap,
                       'debit', 0, 'credit', v_goods_total + v_vat_total,
                       'description', 'Accounts payable')
  );

  v_journal := public.rpc_create_journal_entry(jsonb_build_object(
    'org_id', v_org,
    'entry_date', v_invoice_date,
    'description', 'Matched supplier invoice ' || v_invoice_number,
    'reference_type', 'supplier_invoice',
    'reference_number', v_invoice_id::text,
    'idempotency_key', v_idem_journal,
    'auto_post', true,
    'lines', v_lines
  ));

  -- === 12. التحقق من نتيجة القيد قبل القبول ==============================
  -- النواة ترفع استثناء عند الفشل، لكن الاعتماد على ذلك وحده يفترض عقدًا لا
  -- يُفحص. الفحص هنا يجعل أي انحراف مستقبلي في النواة يُسقط المعاملة كاملة بدل
  -- أن يترك فاتورة معتمدة بقيد غير مرحَّل.
  v_entry_id := NULLIF(v_journal ->> 'entry_id', '')::uuid;

  IF COALESCE((v_journal ->> 'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'AP_JOURNAL_NOT_CREATED: النواة المحاسبية لم تُبلّغ بالنجاح — %', v_journal;
  END IF;
  IF v_entry_id IS NULL THEN
    RAISE EXCEPTION 'AP_JOURNAL_ENTRY_ID_MISSING: القيد بلا معرّف — %', v_journal;
  END IF;

  SELECT status INTO v_entry_status FROM public.gl_entries WHERE id = v_entry_id;
  IF v_entry_status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION
      'AP_JOURNAL_NOT_POSTED: القيد بحالة % لا posted — لا تُقبل فاتورة معتمدة بقيد غير مرحَّل',
      COALESCE(v_entry_status, '(غير موجود)');
  END IF;

  -- === 13. الربط الصريح ==================================================
  -- عمود مباشر لا اعتمادًا على reference_id وحده: البحث العكسي من الفاتورة إلى
  -- قيدها يجب ألا يمر بمطابقة نصية.
  UPDATE public.supplier_invoices
  SET journal_entry_id = v_entry_id, updated_at = now()
  WHERE id = v_invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'invoice_id', v_invoice_id,
    'invoice_status', 'approved',
    'journal_entry_id', v_entry_id,
    'journal_status', 'posted',
    'subtotal', v_goods_total,
    'tax_amount', v_vat_total,
    'total_amount', v_goods_total + v_vat_total,
    'lines', v_line_no
  );
END $$;

REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_matched_supplier_invoice(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_matched_supplier_invoice(jsonb) TO service_role;

COMMIT;
