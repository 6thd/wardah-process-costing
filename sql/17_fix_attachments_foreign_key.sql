-- إصلاح ربط المرفقات والتعليقات بجدول gl_entries (مصحح)

DO $$
BEGIN
    -- 1. إصلاح journal_entry_attachments
    ALTER TABLE journal_entry_attachments DROP CONSTRAINT IF EXISTS journal_entry_attachments_entry_id_fkey;

    ALTER TABLE journal_entry_attachments 
    ADD CONSTRAINT journal_entry_attachments_entry_id_fkey 
    FOREIGN KEY (entry_id) 
    REFERENCES gl_entries(id) 
    ON DELETE CASCADE;

    -- 2. إصلاح journal_entry_comments
    ALTER TABLE journal_entry_comments DROP CONSTRAINT IF EXISTS journal_entry_comments_entry_id_fkey;

    ALTER TABLE journal_entry_comments 
    ADD CONSTRAINT journal_entry_comments_entry_id_fkey 
    FOREIGN KEY (entry_id) 
    REFERENCES gl_entries(id) 
    ON DELETE CASCADE;

    RAISE NOTICE '✅ تم تحديث الروابط لتشير إلى gl_entries';
END $$;
