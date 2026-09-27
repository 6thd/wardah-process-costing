// src/pages/org-admin/__tests__/users-read-failures.test.tsx
//
// Regression tests for F2: the Users page's role-assignment editor.
//
// rpc_replace_user_roles replaces a user's complete role set. Before this fix,
// getOrgUsers ignored a returned user_roles error and reported every listed
// user as holding zero roles, so opening "إدارة الأدوار" and saving silently
// revoked all of that user's roles. These tests mount the real page and the
// real org-admin + rbac services over a mocked Supabase client.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResolver } from '../../../../tests/rbac/supabase-query-mock';

const rpcMock = vi.fn();
let resolver: QueryResolver;

vi.mock('@/lib/supabase', async () => {
  const { makeFrom } = await import('../../../../tests/rbac/supabase-query-mock');
  return {
    getSupabase: () => ({ rpc: rpcMock, from: makeFrom(() => resolver) }),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentOrgId: 'org-1', user: { id: 'admin-user' }, isAuthenticated: true }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: unknown }) => children,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import OrgAdminUsers from '../users';
import { toast } from 'sonner';

const ROLE_A = {
  id: 'role-a', org_id: 'org-1', name: 'Accountant', name_ar: 'محاسب',
  is_system_role: false, is_active: true, created_at: '2026-09-01T00:00:00Z',
};
const ROLE_B = {
  id: 'role-b', org_id: 'org-1', name: 'Storekeeper', name_ar: 'أمين مخزن',
  is_system_role: false, is_active: true, created_at: '2026-09-01T00:00:00Z',
};

const MEMBERSHIPS = [
  { id: 'm-1', user_id: 'user-1', org_id: 'org-1', is_active: true, is_org_admin: false, created_at: '2026-09-02T00:00:00Z' },
  { id: 'm-2', user_id: 'user-2', org_id: 'org-1', is_active: true, is_org_admin: false, created_at: '2026-09-01T00:00:00Z' },
];

const PROFILES = [
  { user_id: 'user-1', full_name: 'Sara', full_name_ar: 'سارة', email: 'sara@example.test' },
  { user_id: 'user-2', full_name: 'Omar', full_name_ar: 'عمر', email: 'omar@example.test' },
];

type Result = { data: unknown; error: unknown };
const ok = (data: unknown): Result => ({ data, error: null });

let userRolesRead: () => Result;
let roleListRead: () => Result;

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockReset();

  // Default: user-1 holds both roles, user-2 holds none (a successful empty read).
  userRolesRead = () =>
    ok([
      { user_id: 'user-1', role: ROLE_A },
      { user_id: 'user-1', role: ROLE_B },
    ]);
  roleListRead = () => ok([ROLE_A, ROLE_B]);

  resolver = (table) => {
    switch (table) {
      case 'user_organizations':
        return ok(MEMBERSHIPS);
      case 'user_roles':
        return userRolesRead();
      case 'user_profiles':
        return ok(PROFILES);
      case 'roles':
        return roleListRead();
      case 'role_permissions':
        return ok([]);
      default:
        throw new Error(`unexpected table ${table}`);
    }
  };

  rpcMock.mockImplementation(async () => ({ data: { sensitive_keys_granted: [] }, error: null }));
});

function replaceCalls() {
  return rpcMock.mock.calls.filter(c => c[0] === 'rpc_replace_user_roles');
}

async function renderPage() {
  render(<OrgAdminUsers />);
  await waitFor(() => expect(screen.getByText('سارة')).toBeInTheDocument());
}

function rowFor(name: string): HTMLElement {
  const heading = screen.getByText(name);
  const row = heading.closest('.p-4.flex') as HTMLElement | null;
  if (!row) throw new Error(`row for ${name} not found`);
  return row;
}

async function openManageRoles(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(rowFor(name)).getByRole('button', { name: 'إجراءات المستخدم' }));
  await user.click(await screen.findByRole('menuitem', { name: /إدارة الأدوار/ }));
}

function roleDialog() {
  return screen.queryByRole('dialog', { name: 'إدارة أدوار المستخدم' });
}

describe('F2 — failed user_roles read never becomes an editable empty assignment', () => {
  it.each([
    ['returned Supabase error', () => ({ data: null, error: { message: 'permission denied for table user_roles', code: '42501' } })],
    ['thrown read error', () => { throw new Error('network down'); }],
  ])('%s: every listed user is marked unknown and no replacement is sent', async (_label, failure) => {
    userRolesRead = failure as () => Result;
    const user = userEvent.setup();
    await renderPage();

    // Both users are affected by the one failed query, and both are shown as
    // "unknown", not as holding zero roles.
    expect(within(rowFor('سارة')).getByText('تعذر تحميل الأدوار')).toBeInTheDocument();
    expect(within(rowFor('عمر')).getByText('تعذر تحميل الأدوار')).toBeInTheDocument();

    for (const name of ['سارة', 'عمر']) {
      await openManageRoles(user, name);
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('تعذر تحميل أدوار هذا المستخدم'))
      );
      expect(roleDialog()).not.toBeInTheDocument();
    }

    expect(replaceCalls()).toHaveLength(0);
  });

  it('an assignment whose role cannot be resolved blocks only that user', async () => {
    userRolesRead = () =>
      ok([
        { user_id: 'user-1', role: ROLE_A },
        { user_id: 'user-1', role: null },
      ]);
    const user = userEvent.setup();
    await renderPage();

    expect(within(rowFor('سارة')).getByText('تعذر تحميل الأدوار')).toBeInTheDocument();
    expect(within(rowFor('عمر')).queryByText('تعذر تحميل الأدوار')).not.toBeInTheDocument();

    await openManageRoles(user, 'سارة');
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(roleDialog()).not.toBeInTheDocument();

    // The other user is unaffected and remains editable.
    await openManageRoles(user, 'عمر');
    await waitFor(() => expect(roleDialog()).toBeInTheDocument());
    await user.click(within(roleDialog()!).getByRole('button', { name: 'حفظ التغييرات' }));

    await waitFor(() => expect(replaceCalls()).toHaveLength(1));
    expect(replaceCalls()[0][1].p_payload).toMatchObject({ user_id: 'user-2', role_ids: [] });
  });
});

describe('controls — successful reads keep full-set replacement semantics', () => {
  it('keeps assignments across two saves when the role catalogue read fails', async () => {
    roleListRead = () => ({ data: null, error: { message: 'role list unavailable' } });
    const user = userEvent.setup();
    await renderPage();

    for (let attempt = 1; attempt <= 2; attempt++) {
      await openManageRoles(user, 'سارة');
      await waitFor(() => expect(roleDialog()).toBeInTheDocument());
      await user.click(within(roleDialog()!).getByRole('button', { name: 'حفظ التغييرات' }));
      await waitFor(() => expect(replaceCalls()).toHaveLength(attempt));
      await waitFor(() => expect(roleDialog()).not.toBeInTheDocument());
    }

    expect(replaceCalls().map(call => call[1].p_payload.role_ids)).toEqual([
      ['role-a', 'role-b'], ['role-a', 'role-b'],
    ]);
  });

  it('keeps an assigned inactive role across two unchanged saves', async () => {
    const inactiveRole = { ...ROLE_B, id: 'role-z', is_active: false, name_ar: 'دور غير نشط' };
    userRolesRead = () => ok([
      { user_id: 'user-1', role: ROLE_A },
      { user_id: 'user-1', role: inactiveRole },
    ]);
    roleListRead = () => ok([ROLE_A]);
    const user = userEvent.setup();
    await renderPage();

    for (let attempt = 1; attempt <= 2; attempt++) {
      await openManageRoles(user, 'سارة');
      await waitFor(() => expect(roleDialog()).toBeInTheDocument());
      await user.click(within(roleDialog()!).getByRole('button', { name: 'حفظ التغييرات' }));
      await waitFor(() => expect(replaceCalls()).toHaveLength(attempt));
      await waitFor(() => expect(roleDialog()).not.toBeInTheDocument());
    }

    expect(replaceCalls().map(call => call[1].p_payload.role_ids)).toEqual([
      ['role-a', 'role-z'], ['role-a', 'role-z'],
    ]);
  });

  it('successful non-empty read saves the complete assigned set', async () => {
    const user = userEvent.setup();
    await renderPage();
    await openManageRoles(user, 'سارة');
    await waitFor(() => expect(roleDialog()).toBeInTheDocument());

    await user.click(within(roleDialog()!).getByRole('button', { name: 'حفظ التغييرات' }));

    await waitFor(() => expect(replaceCalls()).toHaveLength(1));
    expect(replaceCalls()[0][1].p_payload).toMatchObject({
      org_id: 'org-1',
      user_id: 'user-1',
      role_ids: ['role-a', 'role-b'],
    });
  });

  it('successful empty read permits an intentional empty save', async () => {
    const user = userEvent.setup();
    await renderPage();
    await openManageRoles(user, 'عمر');
    await waitFor(() => expect(roleDialog()).toBeInTheDocument());

    await user.click(within(roleDialog()!).getByRole('button', { name: 'حفظ التغييرات' }));

    await waitFor(() => expect(replaceCalls()).toHaveLength(1));
    expect(replaceCalls()[0][1].p_payload).toMatchObject({ user_id: 'user-2', role_ids: [] });
  });

  it('admin can deliberately remove every role after a successful read', async () => {
    const user = userEvent.setup();
    await renderPage();
    await openManageRoles(user, 'سارة');
    await waitFor(() => expect(roleDialog()).toBeInTheDocument());

    const dialog = roleDialog()!;
    await user.click(within(dialog).getByText('محاسب'));
    await user.click(within(dialog).getByText('أمين مخزن'));
    await user.click(within(dialog).getByRole('button', { name: 'حفظ التغييرات' }));

    await waitFor(() => expect(replaceCalls()).toHaveLength(1));
    expect(replaceCalls()[0][1].p_payload).toMatchObject({ user_id: 'user-1', role_ids: [] });
  });
});
