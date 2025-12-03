import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

console.log('🔧 Initializing i18n...')

// Safe language detection that doesn't fail if localStorage is unavailable
const safeLanguageDetector = new LanguageDetector(null, {
  order: ['navigator', 'htmlTag'], // Removed localStorage
  caches: [], // Disable caching
  lookupLocalStorage: 'i18nextLng',
});

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

console.log('✅ Translation resources loaded')

i18n
  .use(safeLanguageDetector as any)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'ar',
    debug: process.env.NODE_ENV === 'development',
    
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    
    detection: {
      order: ['navigator', 'htmlTag'], // Removed localStorage to avoid storage access errors
      caches: [], // Disable caching to avoid storage access errors
    },
    
    react: {
      useSuspense: false,
    },
  })
  .then(() => {
    console.log('✅ i18n initialized successfully')
  })
  .catch((error) => {
    console.error('❌ i18n initialization failed:', error)
  })

export default i18n