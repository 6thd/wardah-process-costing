// src/features/settings/__tests__/company-settings-write-permission-gating.test.tsx
//
// CompanySettings had ZERO permission checks on save/logo actions — only
// route entry was gated (settings.organization.read), which implicitly
// authorized saving the company profile and uploading/deleting its logo.
// This proves the fix requires settings.organization.update specifically.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => false,
    hasPermissionKey: (key: string) => hasPermissionKeyMock(key),
    isOrgAdmin: false,
    isSuperAdmin: false,
    loading: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en', dir: () => 'ltr' } }),
}));

const orgMocks = vi.hoisted(() => ({
  getOrganizationProfile: vi.fn(),
  updateOrganizationProfile: vi.fn(),
  uploadOrganizationLogo: vi.fn(),
  deleteOrganizationLogo: vi.fn(),
}));
vi.mock('@/lib/organization', () => orgMocks);

import { CompanySettings } from '../CompanySettings';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

const organization = {
  id: 'org-1', code: 'ORG1', name: 'Wardah', name_ar: 'وردة', name_en: 'Wardah',
  logo_url: '', currency: 'SAR', timezone: 'Asia/Riyadh',
};

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  orgMocks.getOrganizationProfile.mockResolvedValue({ success: true, data: organization });
  orgMocks.updateOrganizationProfile.mockResolvedValue({ success: true, data: organization });
});

describe('CompanySettings — save/logo actions require settings.organization.update', () => {
  it('a read-only user (no update key) sees no save button', async () => {
    setPermissions(['settings.organization.read']);
    render(<CompanySettings />);

    await waitFor(() => expect(screen.getByLabelText('Company Name')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Save Changes/ })).not.toBeInTheDocument();
  });

  it('settings.organization.update grants the save button and a real submit calls the update gateway', async () => {
    setPermissions(['settings.organization.read', 'settings.organization.update']);
    render(<CompanySettings />);

    await waitFor(() => expect(screen.getByLabelText('Company Name')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Company Name'), ' Plastics');
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }));

    await waitFor(() => expect(orgMocks.updateOrganizationProfile).toHaveBeenCalled());
  });

  it('revoking update mid-session hides the save button', async () => {
    setPermissions(['settings.organization.read', 'settings.organization.update']);
    const { rerender } = render(<CompanySettings />);

    await waitFor(() => expect(screen.getByLabelText('Company Name')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Save Changes/ })).toBeInTheDocument();

    setPermissions(['settings.organization.read']);
    rerender(<CompanySettings />);

    expect(screen.queryByRole('button', { name: /Save Changes/ })).not.toBeInTheDocument();
  });
});
