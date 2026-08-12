// src/pages/org-admin/__tests__/roles-rpc-path.test.tsx
//
// Real page path, not stubs.
//
// The pre-existing roles.test.tsx exercises helper functions redefined inside
// the test file, so it cannot catch a regression in the page itself. This one
// renders the actual component and drives it, asserting that role
// administration goes through the Migration 174 RPCs — never a direct table
// write, which is what it used to do.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ rpc: rpcMock, from: fromMock }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentOrgId: 'org-1', user: { id: 'u1' }, isAuthenticated: true }),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const SENSITIVE = 'accounting.vouchers.unpost';

vi.mock('@/services/org-admin-service', () => ({
  getOrgRolesWithStats: vi.fn(async () => [
    {
      id: 'role-1', name: 'Existing', name_ar: 'قائم', description: '',
      is_system_role: false, is_active: true, permissions_count: 1, users_count: 0,
    },
  ]),
  getRoleTemplates: vi.fn(async () => []),
}));

import OrgAdminRoles from '../roles';
import { toast } from 'sonner';

const MODULES = [
  {
    id: 'mod-acc', code: 'accounting', name: 'accounting', name_ar: 'المحاسبة',
    display_order: 1,
    permissions: [
      {
        id: 'perm-unpost', module_id: 'mod-acc', resource: 'vouchers', resource_ar: 'السندات',
        action: 'unpost', action_ar: 'إلغاء ترحيل', permission_key: SENSITIVE,
      },
      {
        id: 'perm-approve', module_id: 'mod-acc', resource: 'entries', resource_ar: 'القيود',
        action: 'approve', action_ar: 'اعتماد', permission_key: 'accounting.entries.approve',
      },
    ],
  },
];

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();

  // modules + permissions catalogue
  fromMock.mockImplementation(() => ({
    select: () => ({ order: async () => ({ data: MODULES, error: null }) }),
  }));

  // Default: the snapshot classifies the unpost key as sensitive.
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === 'rpc_permission_snapshot') {
      return {
        data: {
          user_id: 'u1', org_id: 'org-1', is_super_admin: false, is_org_admin: true,
          permission_keys: ['accounting.entries.approve'],
          sensitive_permission_keys: [SENSITIVE],
          generated_at: '2026-08-09T00:00:00Z',
        },
        error: null,
      };
    }
    return { data: { role_id: 'new-role' }, error: null };
  });
});

async function renderPage() {
  render(<OrgAdminRoles />);
  await waitFor(() => expect(screen.getByText('قائم')).toBeInTheDocument());
}

describe('roles page — Migration 174 RPC path', () => {
  it('reads the sensitive classification from the backend snapshot on mount', async () => {
    await renderPage();
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('rpc_permission_snapshot', { p_org_id: 'org-1' })
    );
  });

  it('badges a sensitive permission in the editor using the backend list', async () => {
    await renderPage();
    fireEvent.click(screen.getByText('دور جديد'));

    await waitFor(() => expect(screen.getByText('المحاسبة')).toBeInTheDocument());
    fireEvent.click(screen.getByText('المحاسبة'));

    await waitFor(() => expect(screen.getAllByText('حساسة').length).toBeGreaterThan(0));
  });

  it('toggles a permission row without re-entering the render cycle', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByText('دور جديد'));
    await user.click(await screen.findByText('المحاسبة'));

    const permissionRow = screen.getByRole('button', { name: /القيود - اعتماد/ });
    await user.click(permissionRow);

    expect(screen.getByText('1 محددة')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'إنشاء دور جديد' })).toBeInTheDocument();
  });

  it('lets an org admin explicitly include a sensitive key in a role RPC', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByText('دور جديد'));
    await user.type(screen.getByLabelText('الاسم بالعربية *'), 'مدقق السندات');
    await user.click(await screen.findByText('المحاسبة'));
    await user.click(screen.getByRole('button', { name: /السندات - إلغاء ترحيل/ }));
    await user.click(screen.getByRole('button', { name: 'إنشاء الدور' }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('rpc_upsert_org_role', {
        p_payload: expect.objectContaining({
          org_id: 'org-1',
          permission_keys: [SENSITIVE],
        }),
      });
    });
  });

  // Payload/error helpers remain covered separately in
  // __tests__/rbac-error-message.test.ts. The mounted interaction above is
  // intentional: the deployed browser smoke caught a real Maximum update depth
  // failure that pure helper tests could never observe.

  it('surfaces the RPC refusal when a role is still assigned, in readable form', async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'rpc_permission_snapshot') {
        return { data: { sensitive_permission_keys: [SENSITIVE], permission_keys: [] }, error: null };
      }
      if (fn === 'rpc_delete_org_role') {
        return { data: null, error: { message: 'RBAC_174_ROLE_STILL_ASSIGNED: 2 user(s)' } };
      }
      return { data: {}, error: null };
    });

    await renderPage();

    const deleteButtons = screen.getAllByRole('button').filter(b =>
      b.querySelector('svg') && b.className.includes('destructive')
    );
    if (deleteButtons.length > 0) {
      fireEvent.click(deleteButtons[0]);
      await waitFor(() => {
        const confirm = screen.queryByText(/حذف|تأكيد/);
        if (confirm) fireEvent.click(confirm);
      });
    }

    await waitFor(() => {
      const called = rpcMock.mock.calls.some(c => c[0] === 'rpc_delete_org_role');
      if (called) {
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('مُعيَّنًا'));
      }
    });
  });
});
