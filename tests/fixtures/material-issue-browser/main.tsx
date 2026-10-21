import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en/translation.json'
import '@/globals.css'
import { MaterialIssuePage } from '@/features/manufacturing/material-issue/MaterialIssuePage'
import { MaterialIssuePolicyPage } from '@/features/manufacturing/material-issue/MaterialIssuePolicyPage'
import { changeIdentity, ids } from './identity'
import { manageMaterialIssueSetup, recoverMaterialIssueSetup, reconcileMaterialIssueSetup, listPendingMaterialIssueSetup } from '@/services/manufacturing/materialIssueMaintenance'
Object.assign(window, { __fixture: { changeIdentity, ids, setup: {
  manage: manageMaterialIssueSetup, recover: recoverMaterialIssueSetup,
  reconcile: reconcileMaterialIssueSetup, pending: listPendingMaterialIssueSetup,
} } })
void i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
function App() { const [policy, setPolicy] = useState(false); return <>
 <nav><button onClick={() => setPolicy(false)}>Employee page</button> <button onClick={() => setPolicy(true)}>Policy page</button></nav>
 {policy ? <MaterialIssuePolicyPage /> : <MaterialIssuePage />}</> }
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider></React.StrictMode>)
