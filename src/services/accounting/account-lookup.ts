/**
 * account-lookup — تحويل كود الحساب إلى معرّفه (P4-B2)
 * =====================================================
 * الخدمات القديمة تتعامل بأكواد الحسابات (account_code) بينما المسار
 * القانوني rpc_create_journal_entry يتطلب account_id. هذا الـ helper
 * يحل الكود إلى المعرّف مع كاش بسيط لكل (org, code) لتفادي تكرار الاستعلام.
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase'

const cache = new Map<string, string>()

/**
 * معرّف الحساب من كوده — يرمي خطأً عربياً واضحاً إن لم يوجد
 */
export async function resolveAccountIdByCode(
  accountCode: string,
  tenantId?: string
): Promise<string> {
  const org = tenantId ?? (await getEffectiveTenantId())
  const cacheKey = `${org ?? 'no-org'}:${accountCode}`

  const cached = cache.get(cacheKey)
  if (cached) return cached

  if (!supabase) throw new Error('Supabase client not initialized')

  let query = supabase
    .from('gl_accounts')
    .select('id, code')
    .eq('code', accountCode)
    .limit(1)
  if (org) query = query.eq('org_id', org)

  const { data, error } = await query
  if (error) {
    throw new Error(`تعذر البحث عن الحساب ${accountCode}: ${error.message}`)
  }
  const id = data?.[0]?.id
  if (!id) {
    throw new Error(
      `الحساب ${accountCode} غير موجود في دليل الحسابات — أضفه أولاً أو صحّح الكود`
    )
  }

  cache.set(cacheKey, id)
  return id
}

/** لأغراض الاختبار: تفريغ الكاش */
export function clearAccountLookupCache(): void {
  cache.clear()
}
