/**
 * @deprecated قم باستيراد الأنواع من database.generated.ts مباشرةً.
 * هذا الملف يعيد التصدير فقط للتوافق مع الكود القديم.
 * الأنواع الحقيقية مولَّدة من المخطط الحي عبر `supabase gen types`.
 */
export type {
  Json,
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from './database.generated';
