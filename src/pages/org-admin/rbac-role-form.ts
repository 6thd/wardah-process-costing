// src/pages/org-admin/rbac-role-form.ts
//
// Pure logic behind the role editor, extracted from roles.tsx so it can be
// tested directly instead of only through a mounted Radix dialog.
//
// Everything here is a pure function of its inputs — in particular, none of it
// decides authorization. Which keys are sensitive is a backend fact delivered by
// rpc_permission_snapshot (Migration 174's central classifier); these helpers
// only ever consume the list they are handed.

export interface PermissionLike {
  id: string;
  permission_key: string;
}

export interface ModuleLike {
  permissions: PermissionLike[];
}

/**
 * Map the editor's selected permission ids to permission keys.
 *
 * The 174 RPCs speak keys, not row ids: keys are stable across environments,
 * ids are not. Unknown ids are dropped rather than sent as `undefined`, so a
 * stale selection cannot turn into a malformed payload — the RPC would reject
 * it anyway (RBAC_174_UNKNOWN_PERMISSION_KEY), but failing here keeps the
 * request honest.
 */
export function permissionIdsToKeys(modules: ModuleLike[], ids: string[]): string[] {
  const byId = new Map<string, string>();
  modules.forEach(m => m.permissions.forEach(p => byId.set(p.id, p.permission_key)));
  return ids.map(id => byId.get(id)).filter((k): k is string => Boolean(k));
}

/**
 * Which of the selected permissions the backend classifies as sensitive.
 * Order follows `sensitiveKeys` so the warning list is stable between renders.
 */
export function sensitiveAmong(selectedKeys: string[], sensitiveKeys: string[]): string[] {
  const selected = new Set(selectedKeys);
  return sensitiveKeys.filter(k => selected.has(k));
}

/**
 * Migration 174 RPCs raise stable, greppable codes. Surfacing the raw Postgres
 * message would show an operator an internal string; mapping keeps the cause
 * legible while the original stays in the console for debugging.
 */
export function rbacErrorMessage(error: { message?: string } | null | undefined): string {
  const raw = error?.message ?? '';
  if (raw.includes('RBAC_174_ROLE_STILL_ASSIGNED')) {
    return 'لا يمكن حذف الدور وهو ما زال مُعيَّنًا لمستخدمين. اسحبه منهم أولًا.';
  }
  if (raw.includes('RBAC_174_SYSTEM_ROLE_IMMUTABLE')) return 'لا يمكن تعديل أو حذف دور النظام';
  if (raw.includes('RBAC_174_ROLE_NAME_TAKEN')) return 'يوجد دور آخر بالاسم نفسه في هذه المؤسسة';
  if (raw.includes('RBAC_174_ROLE_NAME_REQUIRED')) return 'اسم الدور مطلوب';
  if (raw.includes('RBAC_174_UNKNOWN_PERMISSION_KEY')) return 'مفتاح صلاحية غير معروف — حدّث الصفحة وأعد المحاولة';
  if (raw.includes('RBAC_174_DUPLICATE_ROLE_ID')) return 'تكرار في الأدوار المختارة';
  if (raw.includes('RBAC_174_ROLE_NOT_IN_ORG')) return 'الدور لا ينتمي إلى هذه المؤسسة';
  if (raw.includes('RBAC_174_TARGET_NOT_ACTIVE_ORG_MEMBER')) return 'المستخدم ليس عضوًا نشطًا في هذه المؤسسة';
  if (raw.includes('NOT_ORG_ADMIN')) return 'هذه العملية تتطلب صلاحية مسؤول المؤسسة';
  return raw || 'فشلت العملية';
}

/**
 * The payload for rpc_upsert_org_role. Built here so the shape the client sends
 * is covered by tests rather than living inline in a component body.
 */
export function buildUpsertRolePayload(params: {
  orgId: string;
  roleId?: string | null;
  name: string;
  nameAr: string;
  description?: string;
  isActive?: boolean;
  permissionKeys: string[];
}) {
  return {
    org_id: params.orgId,
    role_id: params.roleId ?? null,
    name: params.name || params.nameAr,
    name_ar: params.nameAr,
    description: params.description,
    is_active: params.isActive ?? true,
    permission_keys: params.permissionKeys,
  };
}
