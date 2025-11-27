-- =====================================
-- بسم الله الرحمن الرحيم
-- إصلاح دالة تسجيل الأنشطة
-- =====================================

-- تحديث نوع عمود entity_id ليقبل TEXT
ALTER TABLE audit_logs 
ALTER COLUMN entity_id TYPE TEXT USING entity_id::TEXT;

-- إعادة إنشاء دالة التسجيل
CREATE OR REPLACE FUNCTION log_activity()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_org_id UUID;
    v_action VARCHAR(50);
    v_old_data JSONB;
    v_new_data JSONB;
    v_changes JSONB;
    v_entity_id TEXT;
BEGIN
    -- الحصول على معرف المستخدم الحالي
    v_user_id := auth.uid();
    
    -- تحديد نوع العملية والبيانات
    IF TG_OP = 'INSERT' THEN
        v_action := 'create';
        v_new_data := to_jsonb(NEW);
        v_old_data := NULL;
        v_changes := v_new_data;
        v_entity_id := NEW.id::TEXT;
        -- محاولة الحصول على org_id
        BEGIN
            v_org_id := NEW.org_id;
        EXCEPTION WHEN OTHERS THEN
            v_org_id := NULL;
        END;
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := 'update';
        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);
        v_changes := jsonb_build_object('before', v_old_data, 'after', v_new_data);
        v_entity_id := NEW.id::TEXT;
        BEGIN
            v_org_id := NEW.org_id;
        EXCEPTION WHEN OTHERS THEN
            v_org_id := NULL;
        END;
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'delete';
        v_old_data := to_jsonb(OLD);
        v_new_data := NULL;
        v_changes := v_old_data;
        v_entity_id := OLD.id::TEXT;
        BEGIN
            v_org_id := OLD.org_id;
        EXCEPTION WHEN OTHERS THEN
            v_org_id := NULL;
        END;
    END IF;

    -- تسجيل النشاط
    BEGIN
        INSERT INTO audit_logs (
            org_id,
            user_id,
            action,
            entity_type,
            entity_id,
            old_data,
            new_data,
            changes,
            metadata,
            created_at
        ) VALUES (
            v_org_id,
            v_user_id,
            v_action,
            TG_TABLE_NAME,
            v_entity_id,
            v_old_data,
            v_new_data,
            v_changes,
            jsonb_build_object(
                'table_schema', TG_TABLE_SCHEMA,
                'trigger_name', TG_NAME,
                'triggered_at', NOW()
            ),
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN
        -- تسجيل الخطأ دون إيقاف العملية
        RAISE WARNING 'Audit log failed: % - %', SQLSTATE, SQLERRM;
    END;

    -- إرجاع السجل المناسب
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================
-- اختبار سريع
-- =====================================

-- إنشاء دور تجريبي
INSERT INTO roles (org_id, name, name_ar, is_system_role, is_active)
VALUES ('00000000-0000-0000-0000-000000000001', 'test_trigger_v2', 'اختبار التدقيق 2', false, true);

-- التحقق من التسجيل
SELECT 
    action,
    entity_type,
    entity_id,
    created_at
FROM audit_logs 
WHERE entity_type = 'roles'
ORDER BY created_at DESC 
LIMIT 1;

-- حذف الدور التجريبي
DELETE FROM roles WHERE name = 'test_trigger_v2';

-- عرض آخر سجلين
SELECT 
    action as "العملية",
    entity_type as "الجدول",
    LEFT(entity_id, 8) as "المعرف",
    created_at as "التاريخ"
FROM audit_logs 
ORDER BY created_at DESC 
LIMIT 5;

