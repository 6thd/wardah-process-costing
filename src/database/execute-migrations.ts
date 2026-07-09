/**
 * ⛔ معطَّل أمنياً (Migration 82)
 * =================================
 * كان هذا الملف ينفّذ ملفات SQL عبر supabase.rpc('execute_sql') —
 * دالة تنفّذ أي SQL يُمرَّر لها، وهي سطح حقن كامل أُزيلت من قاعدة
 * البيانات في Migration 82 (sql/migrations/82_p4_security_hardening.sql).
 *
 * الطريقة المعتمدة لتطبيق الـ migrations:
 *   انسخ محتوى sql/migrations/NN_*.sql إلى محرّر Supabase SQL ونفّذه
 *   يدوياً — كما هو موثَّق في docs/improvements/README.md.
 *
 * الـ exports باقية كي لا ينكسر أي استيراد قديم، لكنها ترمي خطأً واضحاً.
 */

const DISABLED_MESSAGE =
  'execute-migrations معطَّل أمنياً (Migration 82): دالة execute_sql أُزيلت من قاعدة البيانات. ' +
  'طبّق ملفات sql/migrations يدوياً عبر محرّر Supabase SQL.';

export async function executeSQLFile(_filePath: string): Promise<void> {
  throw new Error(DISABLED_MESSAGE);
}

export async function runMigrations(): Promise<void> {
  throw new Error(DISABLED_MESSAGE);
}
