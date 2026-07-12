/**
 * بوابة اعتماد الرواتب/التسويات في الواجهة — تطابق بوابة الخادم
 * wardah_is_org_admin (Migration 101): is_org_admin أو role admin/owner.
 * fail-closed: أي خطأ ⇒ غير مخوَّل (عكس checkIsOrgAdmin القديمة التي كانت
 * تعيد true عند الخطأ). الحاجز الحقيقي هو RLS/RPC خادمياً — هذا للعرض فقط.
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export async function checkIsPayrollAdmin(): Promise<boolean> {
  try {
    const orgId = await getEffectiveTenantId();
    if (!orgId) return false;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabase
      .from('user_organizations')
      .select('is_org_admin, role')
      .eq('user_id', user.id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error || !data) return false;
    return data.is_org_admin === true || data.role === 'admin' || data.role === 'owner';
  } catch {
    return false;
  }
}
