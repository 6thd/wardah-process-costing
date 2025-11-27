-- =====================================
-- بسم الله الرحمن الرحيم
-- Activity Tracking Triggers
-- تتبع الأنشطة التلقائي
-- تاريخ: نوفمبر 2025
-- =====================================

-- =====================================
-- 1. دالة تسجيل الأنشطة
-- =====================================

CREATE OR REPLACE FUNCTION log_activity()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_org_id UUID;
    v_action VARCHAR(50);
    v_old_data JSONB;
    v_new_data JSONB;
    v_changes JSONB;
BEGIN
    -- الحصول على معرف المستخدم الحالي
    v_user_id := auth.uid();
    
    -- تحديد نوع العملية
    IF TG_OP = 'INSERT' THEN
        v_action := 'create';
        v_new_data := to_jsonb(NEW);
        v_old_data := NULL;
        v_changes := v_new_data;
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := 'update';
        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);
        -- حساب التغييرات فقط
        v_changes := jsonb_build_object(
            'before', v_old_data,
            'after', v_new_data
        );
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'delete';
        v_old_data := to_jsonb(OLD);
        v_new_data := NULL;
        v_changes := v_old_data;
    END IF;

    -- محاولة الحصول على org_id من السجل
    IF TG_OP = 'DELETE' THEN
        v_org_id := OLD.org_id;
    ELSE
        v_org_id := NEW.org_id;
    END IF;

    -- تسجيل النشاط (بدون حظر الـ transaction إذا فشل)
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
            metadata
        ) VALUES (
            v_org_id,
            v_user_id,
            v_action,
            TG_TABLE_NAME,
            CASE 
                WHEN TG_OP = 'DELETE' THEN (OLD.id)::TEXT
                ELSE (NEW.id)::TEXT
            END,
            v_old_data,
            v_new_data,
            v_changes,
            jsonb_build_object(
                'table_schema', TG_TABLE_SCHEMA,
                'trigger_name', TG_NAME,
                'timestamp', NOW()
            )
        );
    EXCEPTION WHEN OTHERS THEN
        -- لا نريد أن يفشل الـ transaction بسبب التسجيل
        RAISE NOTICE 'Failed to log activity: %', SQLERRM;
    END;

    -- إرجاع السجل المناسب
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_activity() IS 'دالة تسجيل الأنشطة التلقائي للجداول';

-- =====================================
-- 2. إنشاء Triggers للجداول الهامة
-- =====================================

-- حذف الـ Triggers القديمة إن وجدت
DROP TRIGGER IF EXISTS audit_roles ON roles;
DROP TRIGGER IF EXISTS audit_user_roles ON user_roles;
DROP TRIGGER IF EXISTS audit_invitations ON invitations;
DROP TRIGGER IF EXISTS audit_user_organizations ON user_organizations;
DROP TRIGGER IF EXISTS audit_organizations ON organizations;
DROP TRIGGER IF EXISTS audit_gl_accounts ON gl_accounts;
DROP TRIGGER IF EXISTS audit_journal_entries ON journal_entries;
DROP TRIGGER IF EXISTS audit_manufacturing_orders ON manufacturing_orders;
DROP TRIGGER IF EXISTS audit_products ON products;

-- Trigger لجدول الأدوار
CREATE TRIGGER audit_roles
    AFTER INSERT OR UPDATE OR DELETE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION log_activity();

-- Trigger لجدول أدوار المستخدمين
CREATE TRIGGER audit_user_roles
    AFTER INSERT OR UPDATE OR DELETE ON user_roles
    FOR EACH ROW
    EXECUTE FUNCTION log_activity();

-- Trigger لجدول الدعوات
CREATE TRIGGER audit_invitations
    AFTER INSERT OR UPDATE OR DELETE ON invitations
    FOR EACH ROW
    EXECUTE FUNCTION log_activity();

-- Trigger لجدول user_organizations
CREATE TRIGGER audit_user_organizations
    AFTER INSERT OR UPDATE OR DELETE ON user_organizations
    FOR EACH ROW
    EXECUTE FUNCTION log_activity();

-- =====================================
-- 3. Triggers للجداول الأساسية (إذا كانت موجودة)
-- =====================================

DO $$
BEGIN
    -- Trigger لجدول المنظمات
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
        CREATE TRIGGER audit_organizations
            AFTER INSERT OR UPDATE OR DELETE ON organizations
            FOR EACH ROW
            EXECUTE FUNCTION log_activity();
    END IF;

    -- Trigger لجدول الحسابات
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_accounts') THEN
        CREATE TRIGGER audit_gl_accounts
            AFTER INSERT OR UPDATE OR DELETE ON gl_accounts
            FOR EACH ROW
            EXECUTE FUNCTION log_activity();
    END IF;

    -- Trigger لجدول قيود اليومية
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries') THEN
        CREATE TRIGGER audit_journal_entries
            AFTER INSERT OR UPDATE OR DELETE ON journal_entries
            FOR EACH ROW
            EXECUTE FUNCTION log_activity();
    END IF;

    -- Trigger لجدول أوامر التصنيع
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manufacturing_orders') THEN
        CREATE TRIGGER audit_manufacturing_orders
            AFTER INSERT OR UPDATE OR DELETE ON manufacturing_orders
            FOR EACH ROW
            EXECUTE FUNCTION log_activity();
    END IF;

    -- Trigger لجدول المنتجات
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
        CREATE TRIGGER audit_products
            AFTER INSERT OR UPDATE OR DELETE ON products
            FOR EACH ROW
            EXECUTE FUNCTION log_activity();
    END IF;

EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Some triggers could not be created: %', SQLERRM;
END $$;

-- =====================================
-- 4. تحديث جدول audit_logs
-- =====================================

-- إضافة أعمدة جديدة إذا لم تكن موجودة
DO $$
BEGIN
    -- إضافة عمود changes
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'audit_logs' AND column_name = 'changes') THEN
        ALTER TABLE audit_logs ADD COLUMN changes JSONB;
    END IF;

    -- إضافة عمود metadata
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'audit_logs' AND column_name = 'metadata') THEN
        ALTER TABLE audit_logs ADD COLUMN metadata JSONB;
    END IF;

    -- إضافة عمود old_data
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'audit_logs' AND column_name = 'old_data') THEN
        ALTER TABLE audit_logs ADD COLUMN old_data JSONB;
    END IF;

    -- إضافة عمود new_data
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'audit_logs' AND column_name = 'new_data') THEN
        ALTER TABLE audit_logs ADD COLUMN new_data JSONB;
    END IF;
END $$;

-- إنشاء index للبحث السريع
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_date ON audit_logs(org_id, created_at DESC);

-- =====================================
-- 5. دالة مساعدة لتسجيل نشاط مخصص
-- =====================================

CREATE OR REPLACE FUNCTION log_custom_activity(
    p_org_id UUID,
    p_action VARCHAR(100),
    p_entity_type VARCHAR(100),
    p_entity_id TEXT DEFAULT NULL,
    p_details JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO audit_logs (
        org_id,
        user_id,
        action,
        entity_type,
        entity_id,
        changes,
        metadata
    ) VALUES (
        p_org_id,
        auth.uid(),
        p_action,
        p_entity_type,
        p_entity_id,
        p_details,
        jsonb_build_object('timestamp', NOW(), 'source', 'manual')
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_custom_activity IS 'تسجيل نشاط مخصص في سجل التدقيق';

-- =====================================
-- تأكيد النجاح
-- =====================================

SELECT 'Activity tracking triggers created successfully' as result;

