-- =====================================================================
-- Migration 78: P1 — آلة حالات أوامر التصنيع + حجز مواد ذرّي
-- =====================================================================
-- المتطلب: Migration 76 (لاشتقاق org_id)
-- آمن تماماً: IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS
-- لا حذف لبيانات — يُوسَّع CHECK ولا يُضيَّق
--
-- محتويات:
--  1. normalize_mo_status()           — توحيد صيغة الحالة
--  2. توسيع CHECK constraint          — قبول on_hold / pending / quality_check
--  3. validate_mo_transition()         — منطق آلة الحالات (قابل للاختبار)
--  4. trg_mo_status_machine()          — دالة الـ Trigger
--  5. Trigger mo_status_machine        — يُفعَّل قبل أي UPDATE للحالة
--  6. rpc_transition_mo_status()       — RPC آمن لتغيير الحالة
--  7. rpc_create_mo_with_reservation() — إنشاء أمر تصنيع + حجز مواد في معاملة واحدة
--  8. GRANT EXECUTE to authenticated
-- =====================================================================

-- =====================================================================
-- 1. دالة توحيد صيغة الحالة (kebab-case ↔ snake_case، completed ↔ done)
-- =====================================================================
CREATE OR REPLACE FUNCTION normalize_mo_status(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(trim(p_status))
        WHEN 'in-progress'     THEN 'in_progress'
        WHEN 'in_progress'     THEN 'in_progress'
        WHEN 'completed'       THEN 'done'
        WHEN 'done'            THEN 'done'
        WHEN 'on-hold'         THEN 'on_hold'
        WHEN 'on_hold'         THEN 'on_hold'
        WHEN 'quality-check'   THEN 'quality_check'
        WHEN 'quality_check'   THEN 'quality_check'
        WHEN 'draft'           THEN 'draft'
        WHEN 'confirmed'       THEN 'confirmed'
        WHEN 'pending'         THEN 'pending'
        WHEN 'cancelled'       THEN 'cancelled'
        ELSE lower(trim(p_status))
    END;
$$;

-- =====================================================================
-- 2. توسيع CHECK constraint لقبول الحالات الجديدة
--    NOT VALID: يُضاف الـ CHECK فوراً ويُطبَّق على الكتابات الجديدة فقط
--    لا يُعيد فحص الصفوف الموجودة → لا خطأ 23514 مهما كانت قيمها.
--    يمكن لاحقاً VALIDATE CONSTRAINT بعد تنظيف البيانات كاملاً.
-- =====================================================================
DO $$
BEGIN
    -- حذف أي CHECK قديم بنفس الاسم إن وُجد
    ALTER TABLE manufacturing_orders
        DROP CONSTRAINT IF EXISTS manufacturing_orders_status_check;

    -- إضافة CHECK موسَّع بدون فحص الصفوف الحالية (NOT VALID)
    ALTER TABLE manufacturing_orders
        ADD CONSTRAINT manufacturing_orders_status_check
        CHECK (status IN (
            'draft', 'pending', 'confirmed',
            'in_progress', 'on_hold', 'quality_check',
            'done', 'cancelled'
        ))
        NOT VALID;
END;
$$;

-- [اختياري — شغّله يدوياً بعد التحقق من تنظيف البيانات]
-- ALTER TABLE manufacturing_orders
--     VALIDATE CONSTRAINT manufacturing_orders_status_check;

-- =====================================================================
-- 3. دالة منطق آلة الحالات (مستقلة عن الـ Trigger — سهلة الاختبار)
-- =====================================================================
CREATE OR REPLACE FUNCTION validate_mo_transition(
    p_from TEXT,
    p_to   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
-- جدول التنقّلات المسموحة:
--
--  draft        → confirmed, cancelled
--  pending      → confirmed, cancelled
--  confirmed    → in_progress, on_hold, cancelled
--  in_progress  → done, on_hold, quality_check, cancelled
--  on_hold      → in_progress, cancelled
--  quality_check→ in_progress, done, cancelled
--  done         → (terminal)
--  cancelled    → (terminal)
DECLARE
    v_from TEXT := normalize_mo_status(p_from);
    v_to   TEXT := normalize_mo_status(p_to);
BEGIN
    -- لا تغيير = لا تحقق
    IF v_from = v_to THEN RETURN; END IF;

    -- حالات نهائية لا تقبل التنقل
    IF v_from IN ('done', 'cancelled') THEN
        RAISE EXCEPTION 'MO_TERMINAL_STATE: لا يمكن تغيير حالة أمر التصنيع من "%" — الحالة نهائية', v_from;
    END IF;

    -- جدول التنقّلات
    IF NOT (
        (v_from = 'draft'         AND v_to IN ('confirmed', 'cancelled'))                          OR
        (v_from = 'pending'       AND v_to IN ('confirmed', 'cancelled'))                          OR
        (v_from = 'confirmed'     AND v_to IN ('in_progress', 'on_hold', 'cancelled'))             OR
        (v_from = 'in_progress'   AND v_to IN ('done', 'on_hold', 'quality_check', 'cancelled'))   OR
        (v_from = 'on_hold'       AND v_to IN ('in_progress', 'cancelled'))                        OR
        (v_from = 'quality_check' AND v_to IN ('in_progress', 'done', 'cancelled'))
    ) THEN
        RAISE EXCEPTION 'MO_INVALID_TRANSITION: التنقل من "%" إلى "%" غير مسموح', v_from, v_to;
    END IF;
END;
$$;

-- =====================================================================
-- 4. دالة الـ Trigger
-- =====================================================================
CREATE OR REPLACE FUNCTION trg_mo_status_machine()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_norm_status TEXT;
BEGIN
    -- توحيد صيغة الحالة الواردة
    v_norm_status := normalize_mo_status(NEW.status);

    -- تحقق التنقّل
    PERFORM validate_mo_transition(OLD.status, v_norm_status);

    -- تطبيق الحالة الموحَّدة
    NEW.status := v_norm_status;

    -- ضبط التواريخ التلقائية
    IF v_norm_status = 'in_progress' AND OLD.date_started IS NULL THEN
        NEW.date_started := NOW();
    END IF;

    IF v_norm_status IN ('done', 'cancelled') AND OLD.date_finished IS NULL THEN
        NEW.date_finished := NOW();
    END IF;

    NEW.updated_at := NOW();

    RETURN NEW;
END;
$$;

-- =====================================================================
-- 5. Trigger — يُفعَّل قبل أي UPDATE على حقل status
-- =====================================================================
DROP TRIGGER IF EXISTS mo_status_machine ON manufacturing_orders;

CREATE TRIGGER mo_status_machine
    BEFORE UPDATE OF status ON manufacturing_orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION trg_mo_status_machine();

-- =====================================================================
-- 6. RPC آمن لتغيير حالة أمر التصنيع
-- =====================================================================
CREATE OR REPLACE FUNCTION rpc_transition_mo_status(
    p_mo_id    UUID,
    p_status   TEXT,
    p_notes    TEXT DEFAULT NULL,
    p_tenant   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org      UUID;
    v_mo       RECORD;
    v_norm     TEXT;
BEGIN
    v_org  := wardah_org_id(p_tenant);
    v_norm := normalize_mo_status(p_status);

    -- التحقق من وجود أمر التصنيع
    SELECT id, status, mo_number INTO v_mo
    FROM manufacturing_orders
    WHERE id = p_mo_id AND org_id = v_org;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MO_NOT_FOUND: أمر التصنيع "%" غير موجود', p_mo_id;
    END IF;

    -- التحقق المبكّر (سيتكرر في الـ Trigger لكن رسالته أوضح هنا)
    PERFORM validate_mo_transition(v_mo.status, v_norm);

    -- تطبيق التغيير (الـ Trigger سيُكمل باقي العمل)
    UPDATE manufacturing_orders
    SET   status = v_norm,
          notes  = COALESCE(p_notes, notes)
    WHERE id = p_mo_id AND org_id = v_org;

    -- إرجاع حالة الأمر المحدّث
    SELECT id, mo_number, status, date_started, date_finished, updated_at
    INTO v_mo
    FROM manufacturing_orders
    WHERE id = p_mo_id;

    RETURN jsonb_build_object(
        'success',        true,
        'mo_id',          p_mo_id,
        'mo_number',      v_mo.mo_number,
        'previous_status', normalize_mo_status(v_mo.status),
        'new_status',     v_norm,
        'date_started',   v_mo.date_started,
        'date_finished',  v_mo.date_finished,
        'updated_at',     v_mo.updated_at
    );
END;
$$;

-- =====================================================================
-- 7. RPC ذرّي: إنشاء أمر التصنيع + حجز المواد في معاملة واحدة
-- =====================================================================
-- p_order  JSONB: {
--   org_id?, mo_number?, product_id, qty_planned, uom_id,
--   location_id, bom_id?, work_center?, priority?, date_planned?,
--   notes?, status?
-- }
-- p_materials JSONB: [
--   { item_id, quantity, expires_at? }, ...
-- ]
CREATE OR REPLACE FUNCTION rpc_create_mo_with_reservation(
    p_order     JSONB,
    p_materials JSONB DEFAULT '[]'::jsonb,
    p_tenant    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
    -- ---------------------------------------------------------------
    v_init_status := normalize_mo_status(COALESCE(p_order->>'status', 'draft'));

    -- توليد رقم أمر التصنيع إن لم يُزوَّد
    v_mo_number := COALESCE(
        p_order->>'mo_number',
        'MO-' || to_char(NOW(), 'YYYYMMDD') || '-' ||
        lpad(nextval('mo_seq')::TEXT, 4, '0')
    );

    INSERT INTO manufacturing_orders (
        org_id, mo_number, product_id, qty_planned, uom_id,
        location_id, bom_id, work_center, priority,
        date_planned, notes, status
    )
    VALUES (
        v_org,
        v_mo_number,
        (p_order->>'product_id')::UUID,
        (p_order->>'qty_planned')::NUMERIC,
        (p_order->>'uom_id')::UUID,
        (p_order->>'location_id')::UUID,
        (p_order->>'bom_id')::UUID,
        p_order->>'work_center',
        COALESCE((p_order->>'priority')::INT, 3),
        (p_order->>'date_planned')::TIMESTAMPTZ,
        p_order->>'notes',
        v_init_status
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
$$;

-- تسلسل لترقيم أوامر التصنيع (آمن إن وُجد مسبقاً)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'mo_seq'
    ) THEN
        CREATE SEQUENCE mo_seq START WITH 1;
    END IF;
END;
$$;

-- =====================================================================
-- 8. منح الصلاحيات
-- =====================================================================
GRANT EXECUTE ON FUNCTION normalize_mo_status(TEXT)               TO authenticated;
GRANT EXECUTE ON FUNCTION validate_mo_transition(TEXT, TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_transition_mo_status(UUID,TEXT,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_create_mo_with_reservation(JSONB,JSONB,UUID) TO authenticated;

-- =====================================================================
-- تحقق سريع بعد التطبيق:
-- =====================================================================
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('normalize_mo_status','validate_mo_transition',
--    'trg_mo_status_machine','rpc_transition_mo_status',
--    'rpc_create_mo_with_reservation');
-- -- المتوقع: 5 صفوف
--
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'manufacturing_orders'::regclass;
-- -- يجب أن يشمل: mo_status_machine
