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

// A mutable object, not a fixed literal: several tests below need to move the
// hook between orgs mid-test (renderHook + rerender) to exercise a real
// org-switch race, which a frozen mock return value cannot do.
let authState = {
  user: { id: 'user-1' } as { id: string } | null,
  currentOrgId: 'org-1' as string | null,
  isAuthenticated: true,
};

function setAuth(overrides: Partial<typeof authState>) {
  authState = { ...authState, ...overrides };
}

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
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

/** A promise plus its resolver, for controlling RPC ordering directly in a test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

describe('usePermissions — backend snapshot is the only source of truth', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    clearPermissionCache();
    authState = { user: { id: 'user-1' }, currentOrgId: 'org-1', isAuthenticated: true };
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

describe('usePermissions — org-switch races and cross-consumer de-duplication', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    clearPermissionCache();
    authState = { user: { id: 'user-1' }, currentOrgId: 'org-race-a', isAuthenticated: true };
  });

  it('ignores a stale org response that resolves after a newer org switch', async () => {
    const a = deferred<{ data: unknown; error: null }>();
    const b = deferred<{ data: unknown; error: null }>();

    rpcMock.mockImplementation((_fn: string, args: { p_org_id: string }) => {
      if (args.p_org_id === 'org-race-a') return a.promise;
      if (args.p_org_id === 'org-race-b') return b.promise;
      throw new Error(`unexpected org: ${args.p_org_id}`);
    });

    const { result, rerender } = renderHook(() => usePermissions());
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('rpc_permission_snapshot', { p_org_id: 'org-race-a' })
    );

    // Switch org before A's (slower) response ever arrives.
    setAuth({ currentOrgId: 'org-race-b' });
    rerender();
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('rpc_permission_snapshot', { p_org_id: 'org-race-b' })
    );

    // B — the org the user is now actually looking at — resolves first.
    act(() => {
      b.resolve(
        snapshot({ org_id: 'org-race-b', permission_keys: ['sales.orders.read'], sensitive_permission_keys: [] })
      );
    });
    await waitFor(() => expect(result.current.hasPermissionKey('sales.orders.read')).toBe(true));

    // A's stale response — for an org this hook no longer represents — arrives late.
    act(() => {
      a.resolve(snapshot({ org_id: 'org-race-a', permission_keys: [SENSITIVE], sensitive_permission_keys: [SENSITIVE] }));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Still org B's answer: A's late arrival must not have won the race.
    expect(result.current.hasPermissionKey('sales.orders.read')).toBe(true);
    expect(result.current.hasPermissionKey(SENSITIVE)).toBe(false);
  });

  it('does not let a late error from an abandoned org request clear a newer org state', async () => {
    const a = deferred<{ data: null; error: { message: string } }>();
    const b = deferred<{ data: unknown; error: null }>();

    rpcMock.mockImplementation((_fn: string, args: { p_org_id: string }) => {
      if (args.p_org_id === 'org-race-a') return a.promise;
      if (args.p_org_id === 'org-race-b') return b.promise;
      throw new Error(`unexpected org: ${args.p_org_id}`);
    });

    const { result, rerender } = renderHook(() => usePermissions());
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('rpc_permission_snapshot', { p_org_id: 'org-race-a' })
    );

    setAuth({ currentOrgId: 'org-race-b' });
    rerender();
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('rpc_permission_snapshot', { p_org_id: 'org-race-b' })
    );

    act(() => {
      b.resolve(snapshot({ org_id: 'org-race-b', permission_keys: [ORDINARY], sensitive_permission_keys: [] }));
    });
    await waitFor(() => expect(result.current.hasPermissionKey(ORDINARY)).toBe(true));

    // A's request — abandoned when the user switched away from it — fails late.
    act(() => {
      a.resolve({ data: null, error: { message: 'org-race-a timed out' } });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.error).toBeNull();
    expect(result.current.hasPermissionKey(ORDINARY)).toBe(true);
  });

  it('clears the previous org keys synchronously on switch, before any response arrives', async () => {
    rpcMock.mockResolvedValueOnce(
      snapshot({ org_id: 'org-race-a', permission_keys: [SENSITIVE], sensitive_permission_keys: [SENSITIVE] })
    );

    const { result, rerender } = renderHook(() => usePermissions());
    await waitFor(() => expect(result.current.hasPermissionKey(SENSITIVE)).toBe(true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // org-race-b's request is left unresolved until cleanup below: this test
    // mainly covers what is true before any network round trip completes. A
    // deferred promise, not one that can never settle — an eternally-pending
    // entry would still be sitting in the shared in-flight request map,
    // keyed by this exact (user, org) pair, for any later test that asks for
    // the same switch.
    const pending = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation(() => pending.promise);
    setAuth({ currentOrgId: 'org-race-b' });
    rerender();

    expect(result.current.hasPermissionKey(SENSITIVE)).toBe(false);
    expect(result.current.isOrgAdmin).toBe(false);
    // A ModuleGuard-style consumer reads `loading` before treating empty
    // permissions as a denial. If this were still false here, switching org
    // would flash "access denied" for a frame before org-race-b's real
    // answer (still unresolved above) ever arrives.
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    // Cleanup, not part of the assertion: let the in-flight entry settle.
    act(() => { pending.resolve(snapshot({ org_id: 'org-race-b' })); });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('does not let a user switch inherit another user\'s in-flight request for the same org', async () => {
    setAuth({ user: { id: 'user-A' }, currentOrgId: 'org-shared' });

    const a = deferred<{ data: unknown; error: null }>();
    const b = deferred<{ data: unknown; error: null }>();
    let calls = 0;
    rpcMock.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? a.promise : b.promise;
    });

    const { result, rerender } = renderHook(() => usePermissions());
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));

    // A different user signs into the SAME org before user-A's request
    // resolves. The org alone must not be treated as the whole identity: a
    // dedup key of orgId only would hand user-A's in-flight promise to
    // user-B here instead of firing a separate request.
    setAuth({ user: { id: 'user-B' }, currentOrgId: 'org-shared' });
    rerender();
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2));

    act(() => {
      b.resolve(
        snapshot({
          user_id: 'user-B',
          org_id: 'org-shared',
          permission_keys: ['inventory.items.read'],
          sensitive_permission_keys: [],
        })
      );
    });
    await waitFor(() => expect(result.current.hasPermissionKey('inventory.items.read')).toBe(true));

    // user-A's abandoned request resolves late, carrying user-A's own
    // permissions under user-A's own identity. Even if some future change
    // let it reach this instance, the identity check must refuse it rather
    // than silently apply another user's sensitive grants.
    act(() => {
      a.resolve(
        snapshot({ user_id: 'user-A', org_id: 'org-shared', permission_keys: [SENSITIVE], sensitive_permission_keys: [SENSITIVE] })
      );
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.hasPermissionKey('inventory.items.read')).toBe(true);
    expect(result.current.hasPermissionKey(SENSITIVE)).toBe(false);
  });

  it('fails closed if a snapshot ever answers for a different identity than requested', async () => {
    setAuth({ user: { id: 'user-1' }, currentOrgId: 'org-race-a' });
    // A defensive check, not a reachable client path today: something
    // upstream (session, cache, RPC) hands back the wrong identity's answer.
    rpcMock.mockResolvedValue(
      snapshot({ user_id: 'someone-else', org_id: 'org-race-a', permission_keys: [ORDINARY, SENSITIVE] })
    );

    const { result } = renderHook(() => usePermissions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.hasPermissionKey(ORDINARY)).toBe(false);
    expect(result.current.hasPermissionKey(SENSITIVE)).toBe(false);
  });

  it('coalesces a shared snapshot request across every mounted consumer', async () => {
    setAuth({ currentOrgId: 'org-race-shared' });
    rpcMock.mockResolvedValue(snapshot({ org_id: 'org-race-shared' }));

    const { result: r1 } = renderHook(() => usePermissions());
    const { result: r2 } = renderHook(() => usePermissions());
    await waitFor(() => expect(r1.current.loading).toBe(false));
    await waitFor(() => expect(r2.current.loading).toBe(false));

    rpcMock.mockClear();
    const shared = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation(() => shared.promise);

    // One event, delivered to both consumers' visibilitychange listeners.
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);

    act(() => {
      shared.resolve(snapshot({ org_id: 'org-race-shared', permission_keys: [ORDINARY] }));
    });
    await waitFor(() => expect(r1.current.hasPermissionKey(ORDINARY)).toBe(true));
    await waitFor(() => expect(r2.current.hasPermissionKey(ORDINARY)).toBe(true));
  });
});
