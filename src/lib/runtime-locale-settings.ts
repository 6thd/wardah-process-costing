export interface RuntimeLocaleSettings {
  currency: string;
  numberFormat: string;
  dateFormat: string;
}

const STORAGE_KEY = 'wardah-runtime-locale-settings';
const CHANGE_EVENT = 'wardah:locale-settings-changed';

export const DEFAULT_RUNTIME_LOCALE_SETTINGS: RuntimeLocaleSettings = {
  currency: 'SAR',
  numberFormat: 'en-US',
  dateFormat: 'en-US',
};

let currentSettings: RuntimeLocaleSettings = readStoredSettings();

function readStoredSettings(): RuntimeLocaleSettings {
  if (typeof window === 'undefined') return DEFAULT_RUNTIME_LOCALE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RUNTIME_LOCALE_SETTINGS;
    return { ...DEFAULT_RUNTIME_LOCALE_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_RUNTIME_LOCALE_SETTINGS;
  }
}

function numberingSystem(locale: string): 'latn' | 'arab' {
  return locale === 'ar-SA' ? 'arab' : 'latn';
}

export function getRuntimeLocaleSettings(): RuntimeLocaleSettings {
  return currentSettings;
}

export function applyRuntimeLocaleSettings(settings: Partial<RuntimeLocaleSettings>): void {
  currentSettings = { ...currentSettings, ...settings };
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
  document.documentElement.dataset.numberFormat = currentSettings.numberFormat;
  document.documentElement.dataset.dateFormat = currentSettings.dateFormat;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: currentSettings }));
}

export function subscribeRuntimeLocaleSettings(
  listener: (settings: RuntimeLocaleSettings) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    listener((event as CustomEvent<RuntimeLocaleSettings>).detail);
  };
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function getNumberLocale(): string {
  const { numberFormat } = currentSettings;
  return `${numberFormat}-u-nu-${numberingSystem(numberFormat)}`;
}

export function getDateLocale(): string {
  const { dateFormat, numberFormat } = currentSettings;
  const calendar = dateFormat === 'ar-SA' ? 'islamic-umalqura' : 'gregory';
  return `${dateFormat}-u-ca-${calendar}-nu-${numberingSystem(numberFormat)}`;
}

export function formatRuntimeNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getNumberLocale(), options).format(value);
}

export function formatRuntimeDate(
  value: Date | string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(getDateLocale(), options).format(date);
}

export function formatRuntimeDateTime(value: Date | string): string {
  return formatRuntimeDate(value, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
