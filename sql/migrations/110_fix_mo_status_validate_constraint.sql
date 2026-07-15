-- ===================================================================
-- Migration 110: تطبيع حالات أوامر التصنيع + التحقق من القيد
-- ===================================================================
-- المشكلة:
--   - صفّان في manufacturing_orders بحالة بصيغة مواصلة (hyphen) قديمة:
--       in-progress  → in_progress
--       quality-check → quality_check
--   - القيد manufacturing_orders_status_check مُعرَّف NOT VALID
--     → لا يُفرَّض على الصفوف القائمة حتى يُصادَق عليه
-- الحل:
--   1. تطبيع القيم القديمة (UPDATE قبل التحقق من القيد)
--   2. ALTER TABLE ... VALIDATE CONSTRAINT
-- ===================================================================

BEGIN;

-- 1) تطبيع الحالات القديمة ذات المواصلة
UPDATE manufacturing_orders
   SET status     = 'in_progress',
       updated_at = NOW()
 WHERE status = 'in-progress';

UPDATE manufacturing_orders
   SET status     = 'quality_check',
       updated_at = NOW()
 WHERE status = 'quality-check';

UPDATE manufacturing_orders
   SET status     = 'on_hold',
       updated_at = NOW()
 WHERE status = 'on-hold';

DO $$
DECLARE v_bad INT;
BEGIN
    SELECT COUNT(*) INTO v_bad
    FROM manufacturing_orders
    WHERE status NOT IN (
        'draft','pending','confirmed','in_progress',
        'on_hold','quality_check','done','cancelled'
    );
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'FAIL[110-1] — لا تزال % صفوف بحالة غير قانونية', v_bad;
    END IF;
    RAISE NOTICE 'VERIFY[110-1] ✓ — كل الحالات قانونية، جاهز للتحقق من القيد';
END;
$$;

-- 2) التحقق من القيد (يُحوّله من NOT VALID إلى VALID)
ALTER TABLE manufacturing_orders
    VALIDATE CONSTRAINT manufacturing_orders_status_check;

RAISE NOTICE 'VERIFY[110-2] ✓ — manufacturing_orders_status_check أصبح VALID';

COMMIT;
