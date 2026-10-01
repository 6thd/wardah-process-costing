import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en/translation.json'
import '@/globals.css'
import { MaterialIssuePage } from '@/features/manufacturing/material-issue/MaterialIssuePage'
import { supabase } from './supabase'
import { useAuth, refreshIdentity } from './identity'
Object.assign(window, { __fixtureRefreshIdentity: refreshIdentity, __fixtureReadIssueContext: (id: string) => supabase.rpc('rpc_get_material_issue_context', { p_mo_id: id }) })
void i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
function App() {
  const auth = useAuth(); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('')
  if (!auth.user) return <form onSubmit={event => { event.preventDefault(); void supabase.auth.signInWithPassword({ email, password }).then(result => {
    if (result.error) setError(result.error.message); else void refreshIdentity()
  }) }}>
    <label>Local fixture email<input aria-label="Local fixture email" value={email} onChange={event => setEmail(event.target.value)} /></label>
    <label>Local fixture password<input type="password" aria-label="Local fixture password" value={password} onChange={event => setPassword(event.target.value)} /></label>
    <button>Sign in locally</button>{error && <p role="alert">{error}</p>}
  </form>
  return <><p>Verified local Auth actor: {auth.user.id}</p><button onClick={() => void supabase.auth.signOut()}>Sign out locally</button><MaterialIssuePage /></>
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>)
