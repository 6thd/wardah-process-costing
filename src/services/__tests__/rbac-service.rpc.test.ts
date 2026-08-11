// src/services/__tests__/rbac-service.rpc.test.ts
//
// Migration 174 contract at the service boundary.
//
// These assert the exact RPC name and payload shape each function sends, which
// is the thing that silently breaks when the migration and the client drift —
// a renamed key or a dropped field fails here rather than at runtime in front
// of an administrator.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ rpc: rpcMock }),
}));

import {
  createRole,
  updateRolePermissions,
  deleteRole,
  createRoleFromTemplate,
  replaceUserRoles,
  getPermissionSnapshot,
} from '../rbac-service';

const ORG = 'org-1';
const ROLE = 'role-1';
const SENSITIVE = 'accounting.vouchers.unpost';

beforeEach(() => rpcMock.mockReset());

describe('createRole', () => {
  it('sends one rpc_upsert_org_role call carrying the whole permission set', async () => {
    rpcMock.mockResolvedValue({ data: { role_id: ROLE, created: true, sensitive_keys: [] }, error: null });

    const res = await createRole({
      orgId: ORG, name: 'Controller', name_ar: 'مراقب',
      permissionKeys: ['accounting.entries.approve'],
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fn, args] = rpcMock.mock.calls[0];
    expect(fn).toBe('rpc_upsert_org_role');
    expect(args.p_payload).toMatchObject({
      org_id: ORG,
      name: 'Controller',
      permission_keys: ['accounting.entries.approve'],
    });
    expect(res.success).toBe(true);
    expect(res.roleId).toBe(ROLE);
  });

  it('reports the sensitive keys the backend says the role now grants', async () => {
    rpcMock.mockResolvedValue({ data: { role_id: ROLE, sensitive_keys: [SENSITIVE] }, error: null });
    const res = await createRole({ orgId: ORG, name: 'FC', name_ar: 'مراقب', permissionKeys: [SENSITIVE] });
    expect(res.sensitiveKeys).toEqual([SENSITIVE]);
  });

  it('surfaces an RPC error instead of reporting success', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'RBAC_174_ROLE_NAME_TAKEN' } });
    const res = await createRole({ orgId: ORG, name: 'Dup', name_ar: 'مكرر' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('RBAC_174_ROLE_NAME_TAKEN');
  });

  it('defaults to an empty permission set rather than omitting the field', async () => {
    rpcMock.mockResolvedValue({ data: { role_id: ROLE }, error: null });
    await createRole({ orgId: ORG, name: 'Empty', name_ar: 'فارغ' });
    expect(rpcMock.mock.calls[0][1].p_payload.permission_keys).toEqual([]);
  });
});

describe('updateRolePermissions', () => {
  it('sends role_id so the RPC updates in place instead of creating', async () => {
    rpcMock.mockResolvedValue({ data: { role_id: ROLE, created: false, sensitive_keys: [] }, error: null });

    await updateRolePermissions({
      orgId: ORG, roleId: ROLE, name: 'Controller', permissionKeys: [SENSITIVE],
    });

    const [fn, args] = rpcMock.mock.calls[0];
    expect(fn).toBe('rpc_upsert_org_role');
    expect(args.p_payload.role_id).toBe(ROLE);
    expect(args.p_payload.permission_keys).toEqual([SENSITIVE]);
  });

  it('does not swallow a rejected key set', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'RBAC_174_UNKNOWN_PERMISSION_KEY: nope' } });
    const res = await updateRolePermissions({
      orgId: ORG, roleId: ROLE, name: 'X', permissionKeys: ['nope'],
    });
    expect(res.success).toBe(false);
  });
});

describe('deleteRole', () => {
  it('goes through rpc_delete_org_role with the org scope', async () => {
    rpcMock.mockResolvedValue({ data: { deleted: true }, error: null });
    const res = await deleteRole(ROLE, ORG);
    expect(rpcMock.mock.calls[0][0]).toBe('rpc_delete_org_role');
    expect(rpcMock.mock.calls[0][1].p_payload).toEqual({ org_id: ORG, role_id: ROLE });
    expect(res.success).toBe(true);
  });

  it('reports the refusal when users still hold the role', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'RBAC_174_ROLE_STILL_ASSIGNED: 2 user(s)' } });
    const res = await deleteRole(ROLE, ORG);
    expect(res.success).toBe(false);
    expect(res.error).toContain('RBAC_174_ROLE_STILL_ASSIGNED');
  });
});

describe('createRoleFromTemplate', () => {
  it('uses the audited server function instead of writing roles in the client', async () => {
    rpcMock.mockResolvedValue({ data: ROLE, error: null });

    const res = await createRoleFromTemplate(ORG, 'template-1', 'Controller');

    expect(rpcMock).toHaveBeenCalledWith('create_role_from_template', {
      p_org_id: ORG,
      p_template_id: 'template-1',
      p_custom_name: 'Controller',
    });
    expect(res).toEqual({ success: true, roleId: ROLE });
  });

  it('surfaces a rejected template call', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Template not found' } });

    const res = await createRoleFromTemplate(ORG, 'missing');

    expect(res.success).toBe(false);
    expect(res.error).toContain('Template not found');
  });
});

describe('replaceUserRoles', () => {
  it('passes plain ids through unchanged', async () => {
    rpcMock.mockResolvedValue({ data: { role_count: 1, sensitive_keys_granted: [] }, error: null });
    await replaceUserRoles({ userId: 'u1', orgId: ORG, roles: [ROLE] });
    expect(rpcMock.mock.calls[0][0]).toBe('rpc_replace_user_roles');
    expect(rpcMock.mock.calls[0][1].p_payload.role_ids).toEqual([ROLE]);
  });

  it('maps a per-role expiry into the shape the RPC expects', async () => {
    rpcMock.mockResolvedValue({ data: { role_count: 1 }, error: null });
    await replaceUserRoles({
      userId: 'u1', orgId: ORG,
      roles: [{ roleId: ROLE, expiresAt: '2026-12-31T00:00:00Z' }],
    });
    expect(rpcMock.mock.calls[0][1].p_payload.role_ids).toEqual([
      { role_id: ROLE, expires_at: '2026-12-31T00:00:00Z' },
    ]);
  });

  it('sends an explicit null expiry when one is given, so it can be cleared', async () => {
    rpcMock.mockResolvedValue({ data: { role_count: 1 }, error: null });
    await replaceUserRoles({ userId: 'u1', orgId: ORG, roles: [{ roleId: ROLE, expiresAt: null }] });
    expect(rpcMock.mock.calls[0][1].p_payload.role_ids).toEqual([
      { role_id: ROLE, expires_at: null },
    ]);
  });

  it('surfaces the sensitive keys the assignment granted', async () => {
    rpcMock.mockResolvedValue({ data: { sensitive_keys_granted: [SENSITIVE] }, error: null });
    const res = await replaceUserRoles({ userId: 'u1', orgId: ORG, roles: [ROLE] });
    expect(res.sensitiveKeysGranted).toEqual([SENSITIVE]);
  });

  it('reports a duplicate rejection rather than retrying or de-duplicating locally', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'RBAC_174_DUPLICATE_ROLE_ID' } });
    const res = await replaceUserRoles({ userId: 'u1', orgId: ORG, roles: [ROLE, ROLE] });
    expect(res.success).toBe(false);
    expect(res.error).toContain('RBAC_174_DUPLICATE_ROLE_ID');
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe('getPermissionSnapshot', () => {
  it('asks the backend for the caller-scoped snapshot', async () => {
    const snap = {
      user_id: 'u1', org_id: ORG, is_super_admin: false, is_org_admin: true,
      permission_keys: ['accounting.entries.approve'],
      sensitive_permission_keys: [SENSITIVE],
      generated_at: '2026-08-09T00:00:00Z',
    };
    rpcMock.mockResolvedValue({ data: snap, error: null });

    const res = await getPermissionSnapshot(ORG);
    expect(rpcMock).toHaveBeenCalledWith('rpc_permission_snapshot', { p_org_id: ORG });
    expect(res.snapshot?.permission_keys).toEqual(['accounting.entries.approve']);
    // Classified as sensitive, and deliberately NOT in the granted set.
    expect(res.snapshot?.sensitive_permission_keys).toContain(SENSITIVE);
    expect(res.snapshot?.permission_keys).not.toContain(SENSITIVE);
  });

  it('returns an error rather than an empty snapshot the caller might trust', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'NOT_ORG_MEMBER' } });
    const res = await getPermissionSnapshot(ORG);
    expect(res.snapshot).toBeUndefined();
    expect(res.error).toContain('NOT_ORG_MEMBER');
  });
});
