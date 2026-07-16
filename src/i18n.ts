import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

if (import.meta.env.DEV) console.log('🔧 Initializing i18n...')

// Import translation files
import arTranslation from './locales/ar/translation.json'
import enTranslation from './locales/en/translation.json'

const resources = {
  ar: {
    translation: arTranslation,
  },
  en: {
    translation: enTranslation,
  },
}

/**
 * مصدر الحقيقة الوحيد للغة هو ui-store (zustand persist بمفتاح ui-storage).
 * كان i18n يقرأ من navigator بينما المخزن يضبط الاتجاه من قيمته المثابرة ⇒
 * انفصام: اتجاه عربي RTL ونصوص إنجليزية (أو العكس) عند كل تحميل.
 */
function detectInitialLanguage(): 'ar' | 'en' {
  // 1) القيمة المثابرة من ui-store
  try {
    const persisted = window.localStorage.getItem('ui-storage')
    if (persisted) {
      const lang = JSON.parse(persisted)?.state?.language
      if (lang === 'ar' || lang === 'en') return lang
    }
  } catch {
    // storage غير متاح (private mode / iframe) — نكمل للمتصفح
  }

  // 2) لغة المتصفح مطبَّعة (ar-SA → ar)
  try {
    if (navigator.language?.toLowerCase().startsWith('ar')) return 'ar'
    if (navigator.language?.toLowerCase().startsWith('en')) return 'en'
  } catch {
    // بيئة بلا navigator (SSR/اختبارات)
  }

  // 3) الافتراضي
  return 'ar'
}

if (import.meta.env.DEV) console.log('✅ Translation resources loaded')

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: detectInitialLanguage(),
    fallbackLng: 'ar',
    // تطبيع أكواد البلدان: ar-SA → ar — المقارنات الصارمة i18n.language === 'ar'
    // منتشرة في عشرات الشاشات ويجب أن تكون موثوقة
    load: 'languageOnly',
    supportedLngs: ['ar', 'en'],
    nonExplicitSupportedLngs: true,
    debug: process.env.NODE_ENV === 'development',

    interpolation: {
      escapeValue: false, // React already escapes values
    },

    react: {
      useSuspense: false,
    },
  })
  .then(() => {
    if (import.meta.env.DEV) console.log('✅ i18n initialized successfully')
  })
  .catch((error) => {
    console.error('❌ i18n initialization failed:', error)
  })

// نقطة مزامنة وحيدة: أي تغيير لغة (من المبدّل أو غيره) يضبط اتجاه الصفحة ولغتها
i18n.on('languageChanged', (lng) => {
  try {
    const normalized = lng.startsWith('ar') ? 'ar' : 'en'
    document.documentElement.lang = normalized
    document.documentElement.dir = normalized === 'ar' ? 'rtl' : 'ltr'
  } catch {
    // بيئة بلا document
  }
})

export default i18n
