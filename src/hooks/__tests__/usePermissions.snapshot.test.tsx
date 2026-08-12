// src/hooks/__tests__/usePermissions.snapshot.test.tsx
//
// Migration 174 UI contract: the client must not decide authorization itself.
//
// These exercise the real hook against a mocked Supabase RPC — not a stub
// re-implementation of the logic in the test file, which is what the previous
// role tests did and which cannot catch a regression in the hook at all.

import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ rpc: rpcMock }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    currentOrgId: 'org-1',
    isAuthenticated: true,
  }),
}));

vi.mock('@/lib/safe-storage', () => ({
  safeLocalStorage: { getItem: () => null, setItem: () => undefined },
}));

import { usePermissions, clearPermissionCache } from '../usePermissions';

const ORDINARY = 'accounting.entries.approve';
const SENSITIVE = 'accounting.vouchers.unpost';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      user_id: 'user-1',
      org_id: 'org-1',
      is_super_admin: false,
      is_org_admin: true,
      permission_keys: [ORDINARY],
      sensitive_permission_keys: [SENSITIVE, 'accounting.vouchers.cancel'],
      generated_at: new Date().toISOString(),
      ...overrides,
    },
    error: null,
  };
}

describe('usePermissions — backend snapshot is the only source of truth', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    clearPermissionCache();
  });

  it('asks rpc_permission_snapshot for the current org', async () => {
    rpcMock.mockResolvedValue(snapshot());
    const { result } = renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(rpcMock).toHaveBeenCalledWith('rpc_permission_snapshot', { p_org_id: 'org-1' });
  });

  it('denies a sensitive key to an org admin the backend did not grant it to', async () => {
    // This is the whole point of Migration 174. The old hook returned true here
    // purely because is_org_admin was set, with no backend round-trip at all.
    rpcMock.mockResolvedValue(snapshot());
    const { result } = renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isOrgAdmin).toBe(true);
    expect(result.current.hasPermissionKey(SENSITIVE)).toBe(false);
    expect(result.current.hasPermission('accounting', 'unpost')).toBe(false);
  });

  it('allows an ordinary key the snapshot does contain', async () => {
    rpcMock.mockResolvedValue(snapshot());
    const { result } = renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasPermissionKey(ORDINARY)).toBe(true);
    expect(result.current.hasPermission('accounting', 'approve')).toBe(true);
    expect(result.current.hasModuleAccess('accounting')).toBe(true);
    expect(result.current.hasModuleAccess('sales')).toBe(false);
  });

  it('grants module entry from any exact backend key without inventing a view action', async () => {
    rpcMock.mockResolvedValue(
      snapshot({ permission_keys: ['sales.receipts.read'] })
    );
    const { result } = renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasPermission('sales', 'view')).toBe(false);
    expect(result.current.hasModuleAccess('sales')).toBe(true);
    expect(result.current.hasModuleAccess('sale')).toBe(false);
  });

  it('allows a sensitive key once the backend reports it as granted', async () => {
    rpcMock.mockResolvedValue(snapshot({ permission_keys: [ORDINARY, SENSITIVE] }));
    const { result } = renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasPermissionKey(SENSITIVE)).toBe(true);
  });

  it('grants a super admin only what the snapshot lists — no local shortcut', async () => {
    // Even for a super admin the hook reports the backend's answer. The override
    // itself still exists, but it lives in the database, where it is auditable.
    rpcMock.mockResolvedValue(
      snapshot({ is_super_admin: true, is_org_admin: false, permission_keys: [SENSITIVE] })
    );
    const { result } = renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isSuperAdmin).toBe(true);
    expect(result.current.hasPermissionKey(SENSITIVE)).toBe(true);
    expect(result.current.hasPermissionKey('some.key.notGranted')).toBe(false);
  });

  it('exposes the sensitive set for badging without letting it authorize', async () => {
    rpcMock.mockResolvedValue(snapshot());
    const { result } = renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isSensitivePermission(SENSITIVE)).toBe(true);
    expect(result.current.isSensitivePermission(ORDINARY)).toBe(false);
    // Classified as sensitive, still not held.
    expect(result.current.hasPermissionKey(SENSITIVE)).toBe(false);
  });

  it('fails closed when the snapshot cannot be read', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => usePermissions());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.isOrgAdmin).toBe(false);
    expect(result.current.hasPermissionKey(ORDINARY)).toBe(false);
    expect(result.current.hasModuleAccess('accounting')).toBe(false);
  });

  it('re-reads the backend after refreshPermissions, so a revocation lands', async () => {
    rpcMock.mockResolvedValueOnce(snapshot({ permission_keys: [ORDINARY, SENSITIVE] }));
    const { result } = renderHook(() => usePermissions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasPermissionKey(SENSITIVE)).toBe(true);

    // The grant is withdrawn server-side.
    rpcMock.mockResolvedValueOnce(snapshot({ permission_keys: [ORDINARY] }));
    await act(async () => { await result.current.refreshPermissions(); });

    expect(result.current.hasPermissionKey(SENSITIVE)).toBe(false);
  });
});
