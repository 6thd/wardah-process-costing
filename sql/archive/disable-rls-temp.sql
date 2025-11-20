-- ========================================
-- حل مؤقت: تعطيل RLS للاستيراد فقط
-- ========================================

-- تعطيل RLS مؤقتاً
ALTER TABLE gl_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE gl_mappings DISABLE ROW LEVEL SECURITY;

-- يمكنك الآن تشغيل: node setup-complete.cjs

-- ⚠️ مهم: بعد الانتهاء من الاستيراد، قم بإعادة تفعيل RLS:
-- ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE gl_mappings ENABLE ROW LEVEL SECURITY;
