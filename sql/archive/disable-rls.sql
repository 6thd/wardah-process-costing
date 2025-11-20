-- تعطيل RLS مؤقتاً للاستيراد
ALTER TABLE gl_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE gl_mappings DISABLE ROW LEVEL SECURITY;

SELECT 'تم تعطيل RLS - يمكنك الآن تشغيل: node setup-complete.cjs' as status;
