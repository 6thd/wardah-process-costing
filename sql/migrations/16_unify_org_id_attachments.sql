-- توحيد org_id و tenant_id في جداول المرفقات والتعليقات

-- 1. جدول journal_entry_attachments
-- جعل tenant_id يقبل NULL (اختياري) لأنه مكرر
ALTER TABLE journal_entry_attachments ALTER COLUMN tenant_id DROP NOT NULL;

-- تحديث org_id من tenant_id إذا كان فارغاً
UPDATE journal_entry_attachments 
SET org_id = tenant_id 
WHERE org_id IS NULL AND tenant_id IS NOT NULL;

-- تحديث tenant_id من org_id إذا كان فارغاً (للتوافق العكسي)
UPDATE journal_entry_attachments 
SET tenant_id = org_id 
WHERE tenant_id IS NULL AND org_id IS NOT NULL;

-- 2. جدول journal_entry_comments
-- إضافة org_id إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'journal_entry_comments' 
        AND column_name = 'org_id'
    ) THEN
        ALTER TABLE journal_entry_comments ADD COLUMN org_id uuid;
        RAISE NOTICE '✅ Added org_id to journal_entry_comments';
    END IF;
END $$;

-- تحديث org_id من tenant_id
UPDATE journal_entry_comments 
SET org_id = tenant_id 
WHERE org_id IS NULL AND tenant_id IS NOT NULL;

-- جعل tenant_id يقبل NULL
ALTER TABLE journal_entry_comments ALTER COLUMN tenant_id DROP NOT NULL;

-- جعل org_id مطلوب (NOT NULL) في كلا الجدولين
ALTER TABLE journal_entry_attachments ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE journal_entry_comments ALTER COLUMN org_id SET NOT NULL;

-- إضافة default value
ALTER TABLE journal_entry_attachments ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE journal_entry_comments ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

