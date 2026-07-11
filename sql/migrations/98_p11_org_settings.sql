-- ===================================================================
-- Migration 98: جدول إعدادات المؤسسة (org_settings) — P11-6
-- ===================================================================
-- الهدف: خلفية حقيقية لشاشة «إعدادات النظام» (كانت «قريباً» بلا أي جدول).
-- تخزين key/value JSONB مرن لكل مؤسسة: عملة العرض، تنسيق الأرقام/التاريخ،
-- المخزن الافتراضي، خيارات الطباعة... دون أعمدة جديدة على organizations.
--
-- المبدأ: إضافي 100% (جدول جديد فقط). RLS بنمط wardah_org_id(NULL) القياسي
-- (Migration 83). idempotent: IF NOT EXISTS + DROP POLICY IF EXISTS.
-- ===================================================================

CREATE TABLE IF NOT EXISTS org_settings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value       JSONB NOT NULL DEFAULT '{}'::JSONB,
    updated_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT org_settings_org_key_unique UNIQUE (org_id, key)
);

COMMENT ON TABLE org_settings IS
'إعدادات المؤسسة key/value (Migration 98): عملة العرض، تنسيقات، مخزن افتراضي... upsert على (org_id,key).';

CREATE INDEX IF NOT EXISTS idx_org_settings_org ON org_settings(org_id);

ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_settings_org_select ON org_settings;
CREATE POLICY org_settings_org_select ON org_settings
    FOR SELECT TO authenticated
    USING (org_id = wardah_org_id(NULL));

DROP POLICY IF EXISTS org_settings_org_insert ON org_settings;
CREATE POLICY org_settings_org_insert ON org_settings
    FOR INSERT TO authenticated
    WITH CHECK (org_id = wardah_org_id(NULL));

DROP POLICY IF EXISTS org_settings_org_update ON org_settings;
CREATE POLICY org_settings_org_update ON org_settings
    FOR UPDATE TO authenticated
    USING (org_id = wardah_org_id(NULL))
    WITH CHECK (org_id = wardah_org_id(NULL));

DROP POLICY IF EXISTS org_settings_org_delete ON org_settings;
CREATE POLICY org_settings_org_delete ON org_settings
    FOR DELETE TO authenticated
    USING (org_id = wardah_org_id(NULL));

-- تحديث updated_at آلياً عند التعديل (يعيد استخدام دالة قياسية إن وُجدت، وإلا ينشئها)
CREATE OR REPLACE FUNCTION public.wardah_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_settings_touch ON org_settings;
CREATE TRIGGER trg_org_settings_touch
    BEFORE UPDATE ON org_settings
    FOR EACH ROW EXECUTE FUNCTION public.wardah_touch_updated_at();
