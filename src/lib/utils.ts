import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import {
  formatRuntimeDate,
  formatRuntimeDateTime,
  formatRuntimeNumber,
  getRuntimeLocaleSettings,
} from '@/lib/runtime-locale-settings'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency?: string): string {
  const settings = getRuntimeLocaleSettings()
  const effectiveCurrency = currency || settings.currency || 'SAR'
  const formattedAmount = formatRuntimeNumber(amount, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })

  // Preserve the established application contract (amount then label) while
  // allowing the active organization to control the displayed digits.
  return `${formattedAmount} ${effectiveCurrency === 'SAR' ? 'ريال' : effectiveCurrency}`
}

export function formatNumber(number: number, options?: Intl.NumberFormatOptions): string {
  return formatRuntimeNumber(number, options)
}

export function formatDate(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return formatRuntimeDate(date, options)
}

export function formatDateTime(date: Date | string): string {
  return formatRuntimeDateTime(date)
}

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func(...args), delay)
  }
}

export function generateId(): string {
  // Use crypto API for secure ID generation
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(9);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(36)).join('').substring(0, 9);
  } else {
    // Fallback - Use timestamp only (not secure, but better than Math.random)
    return `id_${Date.now()}_${performance.now()}`;
  }
}
