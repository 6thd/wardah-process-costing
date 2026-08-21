import type { OrganizationProfile } from '@/lib/organization';

export interface CompanySettingsFormState {
  name: string;
  name_ar: string;
  name_en: string;
  tax_number: string;
  commercial_registration: string;
  license_number: string;
  phone: string;
  mobile: string;
  email: string;
  website: string;
  fax: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  logo_url: string;
  primary_color: string;
  secondary_color: string;
  currency: string;
  timezone: string;
  fiscal_year_start: number;
  date_format: string;
}

export const initialCompanySettingsFormState: CompanySettingsFormState = {
  name: '',
  name_ar: '',
  name_en: '',
  tax_number: '',
  commercial_registration: '',
  license_number: '',
  phone: '',
  mobile: '',
  email: '',
  website: '',
  fax: '',
  address: '',
  city: '',
  state: '',
  country: '',
  postal_code: '',
  logo_url: '',
  primary_color: '#1e40af',
  secondary_color: '#3b82f6',
  currency: 'SAR',
  timezone: 'Asia/Riyadh',
  fiscal_year_start: 1,
  date_format: 'DD/MM/YYYY',
};

function valueOrFallback<T>(value: T | null | undefined, fallback: T): T {
  return value || fallback;
}

export function mapOrganizationToCompanySettingsForm(
  data: OrganizationProfile,
): CompanySettingsFormState {
  return {
    name: valueOrFallback(data.name, ''),
    name_ar: valueOrFallback(data.name_ar, ''),
    name_en: valueOrFallback(data.name_en, ''),
    tax_number: valueOrFallback(data.tax_number, ''),
    commercial_registration: valueOrFallback(data.commercial_registration, ''),
    license_number: valueOrFallback(data.license_number, ''),
    phone: valueOrFallback(data.phone, ''),
    mobile: valueOrFallback(data.mobile, ''),
    email: valueOrFallback(data.email, ''),
    website: valueOrFallback(data.website, ''),
    fax: valueOrFallback(data.fax, ''),
    address: valueOrFallback(data.address, ''),
    city: valueOrFallback(data.city, ''),
    state: valueOrFallback(data.state, ''),
    country: valueOrFallback(data.country, initialCompanySettingsFormState.country),
    postal_code: valueOrFallback(data.postal_code, ''),
    logo_url: valueOrFallback(data.logo_url, ''),
    primary_color: valueOrFallback(
      data.primary_color,
      initialCompanySettingsFormState.primary_color,
    ),
    secondary_color: valueOrFallback(
      data.secondary_color,
      initialCompanySettingsFormState.secondary_color,
    ),
    currency: valueOrFallback(data.currency, initialCompanySettingsFormState.currency),
    timezone: valueOrFallback(data.timezone, initialCompanySettingsFormState.timezone),
    fiscal_year_start: valueOrFallback(
      data.fiscal_year_start,
      initialCompanySettingsFormState.fiscal_year_start,
    ),
    date_format: valueOrFallback(data.date_format, initialCompanySettingsFormState.date_format),
  };
}
