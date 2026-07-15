/**
 * logger — سجلّ مشروط بالبيئة (P4-C4)
 * =====================================
 * debug/info تصمت في الإنتاج (كانت 976 console.* تتدفق للمستخدم النهائي)
 * warn/error تعمل دائماً — الأخطاء الحقيقية يجب أن تبقى مرئية ولـ Sentry.
 * الاعتماد تدريجي: الملفات تتحول له عند لمسها — لا حملة استبدال شاملة.
 */
/* eslint-disable no-console */

const isDev = import.meta.env.DEV

export const logger = {
  debug: (...args: unknown[]): void => {
    if (isDev) console.debug(...args)
  },
  info: (...args: unknown[]): void => {
    if (isDev) console.info(...args)
  },
  log: (...args: unknown[]): void => {
    if (isDev) console.log(...args)
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args)
  },
  error: (...args: unknown[]): void => {
    console.error(...args)
  },
}

export default logger
