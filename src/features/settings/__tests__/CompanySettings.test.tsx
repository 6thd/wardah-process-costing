import { act, fireEvent, render, screen } from '@/test/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { CompanySettings } from '../CompanySettings';

const mocks = vi.hoisted(() => ({
  getOrganizationProfile: vi.fn(),
  updateOrganizationProfile: vi.fn(),
  uploadOrganizationLogo: vi.fn(),
  deleteOrganizationLogo: vi.fn(),
}));

vi.mock('@/lib/organization', () => mocks);

const organization = {
  id: 'org-1',
  code: 'ORG1',
  name: 'Wardah Plastics',
  name_ar: 'وردة للبلاستيك',
  name_en: 'Wardah Plastics',
  tax_number: null,
  commercial_registration: null,
  license_number: null,
  phone: null,
  mobile: null,
  email: null,
  website: null,
  fax: null,
  address: null,
  city: null,
  state: null,
  country: 'Saudi Arabia',
  postal_code: null,
  logo_url: null,
  favicon_url: null,
  primary_color: '#1e40af',
  secondary_color: '#3b82f6',
  currency: 'SAR',
  timezone: 'Asia/Riyadh',
  fiscal_year_start: 1,
  date_format: 'DD/MM/YYYY',
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const activateTab = (name: string) => {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), {
    button: 0,
    ctrlKey: false,
  });
};

describe('CompanySettings localization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrganizationProfile.mockResolvedValue({ success: true, data: organization });
  });

  it('renders every company settings tab in English', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    render(<CompanySettings />);

    expect(await screen.findByRole('heading', { name: 'Company Profile' })).toBeInTheDocument();
    expect(screen.getByText('Basic Information')).toBeInTheDocument();
    expect(screen.getByText('Tax & Registration Information')).toBeInTheDocument();

    activateTab('Contact');
    expect(screen.getByText('Contact Information')).toBeInTheDocument();
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();

    activateTab('Address');
    expect(screen.getByLabelText('Detailed Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Country')).toBeInTheDocument();

    activateTab('Settings');
    expect(screen.getByText('Visual Identity')).toBeInTheDocument();
    expect(screen.getByLabelText('Default Currency')).toBeInTheDocument();
    expect(screen.getByText('Fiscal Year Start')).toBeInTheDocument();
  });

  it('treats ar-SA as an Arabic RTL locale', async () => {
    await act(async () => {
      await i18n.changeLanguage('ar-SA');
    });

    const { container } = render(<CompanySettings />);

    expect(await screen.findByRole('heading', { name: 'بيانات الشركة' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'الأساسية' })).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).toBeInTheDocument();
  });
});
