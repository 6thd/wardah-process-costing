import { describe, expect, it } from 'vitest';
import type { OrganizationProfile } from '@/lib/organization';
import {
  initialCompanySettingsFormState,
  mapOrganizationToCompanySettingsForm,
} from '../companySettingsForm';

describe('mapOrganizationToCompanySettingsForm', () => {
  it('preserves populated organization values', () => {
    const profile = {
      name: 'Wardah',
      name_ar: 'وردة',
      name_en: 'Wardah',
      tax_number: '3100000000',
      commercial_registration: 'CR-1',
      license_number: 'LIC-1',
      phone: '0110000000',
      mobile: '0500000000',
      email: 'info@example.com',
      website: 'https://example.com',
      fax: '0110000001',
      address: 'Factory Road',
      city: 'Riyadh',
      state: 'Riyadh',
      country: 'Saudi Arabia',
      postal_code: '12345',
      logo_url: 'https://example.com/logo.png',
      primary_color: '#112233',
      secondary_color: '#445566',
      currency: 'USD',
      timezone: 'Asia/Dubai',
      fiscal_year_start: 7,
      date_format: 'YYYY-MM-DD',
    } as OrganizationProfile;

    expect(mapOrganizationToCompanySettingsForm(profile)).toEqual({
      ...profile,
    });
  });

  it('retains the original falsey-value fallback behavior', () => {
    const profile = {
      name: '',
      primary_color: null,
      secondary_color: undefined,
      currency: '',
      timezone: null,
      fiscal_year_start: 0,
      date_format: undefined,
    } as unknown as OrganizationProfile;

    expect(mapOrganizationToCompanySettingsForm(profile)).toEqual(
      initialCompanySettingsFormState,
    );
  });
});
