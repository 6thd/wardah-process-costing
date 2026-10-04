import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { Toaster } from 'sonner'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en/translation.json'
import '@/globals.css'
import { MaterialIssuePage } from '@/features/manufacturing/material-issue/MaterialIssuePage'
import { QualityControlPage } from '@/features/manufacturing/quality/QualityControlPage'
void i18next.use(initReactI18next).init({lng:'en',resources:{en:{translation:en}},interpolation:{escapeValue:false}})
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
 <BrowserRouter><nav><Link to="/">Materials</Link> <Link to="/quality">Quality</Link></nav>
 <Routes><Route path="/" element={<MaterialIssuePage/>}/><Route path="/quality" element={<QualityControlPage/>}/></Routes>
 <Toaster/></BrowserRouter></QueryClientProvider>)
