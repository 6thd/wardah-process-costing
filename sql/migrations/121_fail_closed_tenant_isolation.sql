-- ============================================================================
-- Migration 121: إغلاق ثغرة عزل المؤسسات P0 — fail-closed tenant resolver
-- المرجع: مراجعة كودكس الحية 2026-07-16 (اختراق مُثبت داخل BEGIN/ROLLBACK)
--
-- الثغرة المُثبتة قبل هذه الترقية:
--   • get_current_tenant_id() كانت تُرجع المؤسسة الافتراضية
--     '00000000-0000-0000-0000-000000000001' كـ fallback في المسار الطبيعي
--     وفي معالج EXCEPTION ⇒ مستخدم authenticated بلا أي عضوية في
--     user_organizations كان يُحلّ إلى المؤسسة الافتراضية ويقرأ/يكتب بياناتها.
--   • wardah_org_id(p_explicit) كانت تُرجع p_explicit القادمة من العميل
--     (وكذلك org_id من JWT) بلا أي تحقق عضوية ⇒ تمرير Org B صريحاً كان
--     يُقبل. كل سياسات RLS الـ99 (54 جدولاً) تعتمد wardah_org_id، لذا كانت
--     الثغرة قراءةً وكتابةً معاً.
--
-- الإصلاح (fail-closed عند الجذر):
--   • wardah_org_id هو "الجذر الأمني الموثّق": لا يُرجع أبداً مؤسسةً ليس
--     auth.uid() عضواً نشطاً فيها، ويُرجع NULL بدل ذلك. لا يرفع استثناءً
--     إطلاقاً لأنه يُستدعى داخل مسند سياسات RLS؛ الاستثناء داخل مسند سياسة
--     يُفجّر كل استعلام بخطأ 500 بدل الإغلاق الصامت. NULL ⇒ org_id = NULL ⇒
--     لا صف يطابق (قراءةً) و WITH CHECK يرفض (كتابةً) = fail-closed صحيح.
--   • get_current_tenant_id بلا مؤسسة افتراضية إطلاقاً؛ تقبل claim الـJWT
--     فقط بعد تأكيد العضوية؛ وإلا العضوية الوحيدة النشطة؛ وإلا NULL.
--   • لأن 16/17 دالة RPC حساسة تحتوي أصلاً على IF v_org IS NULL THEN RAISE،
--     وكلها تشتق org عبر wardah_org_id، فإن تحصين الجذر يُغلق الوصول
--     العابر للمؤسسات وعديم-العضوية فيها جميعاً دفعة واحدة. الدالة الوحيدة
--     التي كانت تفتقر لحارس NULL (rpc_create_mo_with_reservation) تُحصَّن
--     صراحةً هنا.
--   • الفحص الختامي لـ Migration 120 كان false-negative: اعتبر مجرد ورود
--     wardah_org_id في نص الدالة "حماية" رغم أن wardah_org_id نفسها لم تكن
--     تتحقق من العضوية. الفحص الختامي هنا يُصلح ذلك: يتحقق أولاً أن الجذرين
--     (wardah_org_id + get_current_tenant_id) مُحصَّنان فعلاً (يحويان فحص
--     user_organizations ولا يحويان UUID الافتراضي)، ثم يثق بهما.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) فحص عضوية منطقي (boolean، لا يرفع استثناءً) — يُعاد استخدامه في الجذر
--    يختلف عن wardah_assert_org_member (التي ترفع استثناءً؛ مناسبة للـ RPC
--    لا لمسند RLS).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wardah_is_org_member(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL
       AND p_org IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM public.user_organizations
            WHERE user_id = auth.uid()
              AND org_id  = p_org
              AND COALESCE(is_active, TRUE)
       );
$function$;

REVOKE ALL ON FUNCTION public.wardah_is_org_member(uuid) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 1) get_current_tenant_id() — fail-closed، بلا مؤسسة افتراضية
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_uid        uuid := auth.uid();
    v_claims     jsonb;
    v_claim_org  uuid;
    v_org        uuid;
    v_count      integer;
BEGIN
    -- بلا مصادقة ⇒ بلا مؤسسة (لا سقوط لمؤسسة افتراضية)
    IF v_uid IS NULL THEN
        RETURN NULL;
    END IF;

    -- claim من JWT (tenant_id ثم org_id) — تُقبل فقط بعد تأكيد العضوية
    BEGIN
        v_claims := current_setting('request.jwt.claims', true)::jsonb;
    EXCEPTION WHEN OTHERS THEN
        v_claims := NULL;
    END;

    IF v_claims IS NOT NULL THEN
        v_claim_org := COALESCE(
            NULLIF(v_claims ->> 'tenant_id', '')::uuid,
            NULLIF(v_claims ->> 'org_id', '')::uuid,
            NULLIF(v_claims -> 'app_metadata' ->> 'org_id', '')::uuid
        );
        IF v_claim_org IS NOT NULL AND public.wardah_is_org_member(v_claim_org) THEN
            RETURN v_claim_org;
        END IF;
    END IF;

    -- بلا claim صالح: تُستخدم العضوية النشطة فقط إن كانت واحدة بالضبط.
    -- تعدد العضويات يُلزم العميل بتمرير org_id في JWT (تُحقَّق أعلاه) بدل
    -- اختيار عشوائي بـ LIMIT 1.
    SELECT count(*) INTO v_count
    FROM public.user_organizations
    WHERE user_id = v_uid AND COALESCE(is_active, TRUE);

    IF v_count = 1 THEN
        SELECT org_id INTO v_org
        FROM public.user_organizations
        WHERE user_id = v_uid AND COALESCE(is_active, TRUE);
        RETURN v_org;
    END IF;

    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    -- fail-closed مطلقاً: لا مؤسسة افتراضية على أي خطأ
    RETURN NULL;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2) wardah_org_id(p_explicit) — الجذر الأمني الموثّق
--    لا يُرجع أبداً مؤسسة ليس المستخدم عضواً فيها؛ NULL بدلاً من ذلك؛ لا يرفع
--    استثناءً (آمن داخل مسند سياسات RLS).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wardah_org_id(p_explicit uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_org uuid;
BEGIN
    -- طلب صريح من الخدمة/العميل: يُقبل فقط إن كان المستخدم عضواً نشطاً فيه.
    -- غير ذلك ⇒ NULL (لا سقوط لمؤسسة أخرى، ولا استثناء يكسر RLS).
    IF p_explicit IS NOT NULL THEN
        IF public.wardah_is_org_member(p_explicit) THEN
            RETURN p_explicit;
        END IF;
        RETURN NULL;
    END IF;

    -- بلا طلب صريح: التحليل من JWT/العضوية (محصَّن، يُرجع NULL إن تعذّر)
    BEGIN
        v_org := public.get_current_tenant_id();
    EXCEPTION WHEN OTHERS THEN
        v_org := NULL;
    END;

    RETURN v_org;  -- إما مؤسسة المستخدم أو NULL
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3) تحصين صريح لـ rpc_create_mo_with_reservation
--    (الدالة الوحيدة بين الـ17 التي كانت تفتقر لحارس IF v_org IS NULL؛ بقيتها
--    تحتوي أصلاً IF v_org IS NULL THEN RAISE فتُغلَق بتحصين الجذر.)
--    الجسد مطابق للنسخة الحية 2026-07-16 + سطر واحد مُضاف:
--        PERFORM public.wardah_assert_org_member(v_org);
--    مباشرة بعد اشتقاق v_org — يرفع ORG_UNRESOLVED إن كان NULL و NOT_ORG_MEMBER
--    إن لم يكن المستخدم عضواً (دفاع في العمق فوق تحصين الجذر).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_mo_with_reservation(
    p_order jsonb, p_materials jsonb DEFAULT '[]'::jsonb, p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_org         UUID;
    v_mo_id       UUID;
    v_mo_number   TEXT;
    v_mat         JSONB;
    v_item_id     UUID;
    v_qty         NUMERIC;
    v_avail       NUMERIC;
    v_insufficient JSONB := '[]'::jsonb;
    v_reserved     INT   := 0;
    v_init_status  TEXT;
BEGIN
    v_org := wardah_org_id(
        COALESCE((p_order->>'org_id')::UUID, p_tenant)
    );

    -- حارس عضوية صريح (يرفع ORG_UNRESOLVED / NOT_ORG_MEMBER) — أُضيف في 121
    PERFORM public.wardah_assert_org_member(v_org);

    -- ---------------------------------------------------------------
    -- 7a. فحص التوفر (للمواد المطلوبة) — قبل أي إنشاء
    -- ---------------------------------------------------------------
    IF jsonb_array_length(p_materials) > 0 THEN
        FOR v_mat IN SELECT * FROM jsonb_array_elements(p_materials)
        LOOP
            v_item_id := (v_mat->>'item_id')::UUID;
            v_qty     := (v_mat->>'quantity')::NUMERIC;

            -- المخزون المتاح = إجمالي المستلم - المُصرف - المحجوز
            SELECT COALESCE(SUM(
                CASE move_type
                    WHEN 'receipt'        THEN quantity
                    WHEN 'material_issue' THEN -quantity
                    ELSE 0
                END
            ), 0) -
            COALESCE((
                SELECT SUM(quantity_reserved - COALESCE(quantity_consumed,0) - COALESCE(quantity_released,0))
                FROM   material_reservations
                WHERE  item_id = v_item_id AND org_id = v_org AND status = 'reserved'
            ), 0)
            INTO v_avail
            FROM stock_moves
            WHERE product_id = v_item_id
              AND org_id     = v_org
              AND status     = 'done';

            IF v_avail < v_qty THEN
                v_insufficient := v_insufficient || jsonb_build_object(
                    'item_id',   v_item_id,
                    'required',  v_qty,
                    'available', v_avail
                );
            END IF;
        END LOOP;

        IF jsonb_array_length(v_insufficient) > 0 THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: مواد غير كافية: %',
                v_insufficient::TEXT;
        END IF;
    END IF;

    -- ---------------------------------------------------------------
    -- 7b. إنشاء أمر التصنيع
    -- أعمدة الجدول الحية: order_number/quantity/product_id/item_id/start_date/
    -- due_date (وليست mo_number/qty_planned/uom_id… التي كانت في الجسد القديم —
    -- مخطط قديم عُدّل بعد كتابة الدالة فصارت تشير لأعمدة غائبة؛ صُحِّح في 121
    -- ليطابق المخطط الحي وعقد الواجهة ManufacturingOrderInput).
    -- ---------------------------------------------------------------
    v_init_status := normalize_mo_status(COALESCE(p_order->>'status', 'draft'));

    -- توليد رقم الأمر إن لم يُزوَّد
    v_mo_number := COALESCE(
        NULLIF(p_order->>'order_number', ''),
        'MO-' || to_char(NOW(), 'YYYYMMDD') || '-' ||
        lpad(nextval('mo_seq')::TEXT, 4, '0')
    );

    INSERT INTO manufacturing_orders (
        org_id, order_number, product_id, item_id, quantity,
        status, notes, start_date, due_date
    )
    VALUES (
        v_org,
        v_mo_number,
        NULLIF(p_order->>'product_id', '')::UUID,
        NULLIF(p_order->>'item_id', '')::UUID,
        COALESCE(NULLIF(p_order->>'quantity', '')::NUMERIC, 0),
        v_init_status,
        NULLIF(p_order->>'notes', ''),
        NULLIF(p_order->>'start_date', '')::DATE,
        NULLIF(p_order->>'due_date', '')::DATE
    )
    RETURNING id INTO v_mo_id;

    -- ---------------------------------------------------------------
    -- 7c. حجز المواد (في نفس المعاملة)
    -- ---------------------------------------------------------------
    FOR v_mat IN SELECT * FROM jsonb_array_elements(p_materials)
    LOOP
        INSERT INTO material_reservations (
            org_id, mo_id, item_id, quantity_reserved, status, expires_at
        )
        VALUES (
            v_org,
            v_mo_id,
            (v_mat->>'item_id')::UUID,
            (v_mat->>'quantity')::NUMERIC,
            'reserved',
            (v_mat->>'expires_at')::TIMESTAMPTZ
        );
        v_reserved := v_reserved + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success',            true,
        'mo_id',              v_mo_id,
        'mo_number',          v_mo_number,
        'status',             v_init_status,
        'materials_reserved', v_reserved
    );

EXCEPTION
    WHEN OTHERS THEN
        -- أي خطأ يُلغي المعاملة كاملة (INSERT + كل الحجوزات)
        RAISE;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4) الفحص الختامي الصارم (يستبدل منطق Migration 120 الضعيف)
--    الخطوة (أ): تأكيد أن الجذرين مُحصَّنان فعلاً — لا UUID افتراضي + يحويان
--    فحص user_organizations. الخطوة (ب): كل دالة SECURITY DEFINER متاحة
--    لـ authenticated يجب أن تشتق org عبر جذر موثّق أو تحوي حارساً صريحاً.
-- ----------------------------------------------------------------------------
DO $verify$
DECLARE
    v_src   text;
    v_bad   text;
    v_count integer;
    c_default constant text := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- (أ) get_current_tenant_id محصَّنة
    SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_current_tenant_id';
    IF v_src IS NULL THEN RAISE EXCEPTION 'FAIL[121-4a] get_current_tenant_id مفقودة'; END IF;
    IF position(c_default IN v_src) > 0 THEN
        RAISE EXCEPTION 'FAIL[121-4a] get_current_tenant_id ما زالت تحوي UUID الافتراضي';
    END IF;
    IF v_src NOT ILIKE '%user_organizations%' THEN
        RAISE EXCEPTION 'FAIL[121-4a] get_current_tenant_id لا تفحص العضوية';
    END IF;

    -- (أ) wardah_org_id محصَّنة
    SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='wardah_org_id';
    IF v_src IS NULL THEN RAISE EXCEPTION 'FAIL[121-4a] wardah_org_id مفقودة'; END IF;
    IF position(c_default IN v_src) > 0 THEN
        RAISE EXCEPTION 'FAIL[121-4a] wardah_org_id ما زالت تحوي UUID الافتراضي';
    END IF;
    IF v_src NOT ILIKE '%wardah_is_org_member%' THEN
        RAISE EXCEPTION 'FAIL[121-4a] wardah_org_id لا تتحقق من العضوية';
    END IF;

    -- (ب) لا دالة DEFINER متاحة لـ authenticated بلا اشتقاق org موثّق/حارس
    SELECT string_agg(p.proname, ', '), COUNT(*)
    INTO v_bad, v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.prosecdef
      AND p.proname NOT IN ('rpc_get_invitation_preview','is_super_admin',
                            'get_current_tenant_id','wardah_org_id',
                            'wardah_is_org_member','wardah_assert_org_member',
                            'wardah_assert_org_admin','wardah_is_org_admin')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.prosrc !~ '(wardah_assert_org|wardah_org_id|get_current_tenant_id|wardah_is_org_admin|is_org_admin|is_super_admin|user_organizations)';
    IF v_count > 0 THEN
        RAISE EXCEPTION 'FAIL[121-4b] % دالة DEFINER بلا اشتقاق org موثّق: %', v_count, v_bad;
    END IF;
    -- ملاحظة: الثقة في ورود wardah_org_id/get_current_tenant_id مشروعة الآن
    -- لأن الخطوة (أ) أثبتت أن هذين الجذرين محصَّنان (يفحصان العضوية ولا يحويان
    -- المؤسسة الافتراضية) — بخلاف فحص Migration 120 الذي وثق بهما دون التحقق.

    RAISE NOTICE 'PASS[121] fail-closed tenant isolation مُطبَّق: الجذران محصَّنان + لا دالة DEFINER مكشوفة';
END;
$verify$;
