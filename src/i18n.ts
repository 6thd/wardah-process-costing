import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

console.log('🔧 Initializing i18n...')

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
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'ar',
    debug: process.env.NODE_ENV === 'development',
    
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
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