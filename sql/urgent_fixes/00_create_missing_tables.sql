-- ===================================
-- إنشاء الجداول المفقودة
-- التاريخ: 28 أكتوبر 2025
-- الأولوية: يجب تنفيذه قبل 01_fix_tenant_id.sql
-- ===================================

-- ملاحظة: نفذ هذا السكريبت أولاً في Supabase SQL Editor

BEGIN;

-- تفعيل extensions المطلوبة
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===================================
-- 1. جدول المنظمات
-- ===================================
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    code VARCHAR(50) UNIQUE NOT NULL,
    settings JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================
-- 2. جدول ربط المستخدمين بالمنظمات
-- ===================================
CREATE TABLE IF NOT EXISTS user_organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL, -- References auth.users
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'manager', 'admin')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, org_id)
);

-- ===================================
-- 3. تفعيل RLS
-- ===================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;

-- ===================================
-- 4. إنشاء Policies
-- ===================================

-- حذف Policies القديمة إن وجدت
DROP POLICY IF EXISTS "Users can view organizations they belong to" ON organizations;
DROP POLICY IF EXISTS "Users can view their organization associations" ON user_organizations;

-- Policy للمنظمات
CREATE POLICY "Users can view organizations they belong to" ON organizations
    FOR SELECT USING (id IN (
        SELECT org_id FROM user_organizations WHERE user_id = auth.uid()
    ));

-- Policy لربط المستخدمين
CREATE POLICY "Users can view their organization associations" ON user_organizations
    FOR SELECT USING (user_id = auth.uid());

-- ===================================
-- 5. منح الصلاحيات
-- ===================================
GRANT ALL ON TABLE organizations TO authenticated;
GRANT ALL ON TABLE user_organizations TO authenticated;

-- ===================================
-- 6. التحقق من الجداول
-- ===================================
DO $$
DECLARE
    orgs_count INTEGER;
    user_orgs_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orgs_count FROM organizations;
    SELECT COUNT(*) INTO user_orgs_count FROM user_organizations;
    
    RAISE NOTICE '✅ جدول organizations: موجود (عدد السجلات: %)', orgs_count;
    RAISE NOTICE '✅ جدول user_organizations: موجود (عدد السجلات: %)', user_orgs_count;
    RAISE NOTICE '📊 يمكنك الآن تنفيذ 01_fix_tenant_id.sql';
END $$;

COMMIT;
