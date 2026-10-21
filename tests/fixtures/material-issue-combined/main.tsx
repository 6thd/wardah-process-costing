import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en/translation.json'
import '@/globals.css'
import { MaterialIssuePage } from '@/features/manufacturing/material-issue/MaterialIssuePage'
import { changeIdentity } from './identity'
// Test-only permission snapshot control. Production imports never reference this entry point.
Object.assign(window, { __setFixtureKeys: changeIdentity })
void i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><MaterialIssuePage /></QueryClientProvider>)
