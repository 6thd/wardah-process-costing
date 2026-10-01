import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { fileURLToPath } from 'node:url'
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
export default defineConfig({ root: path('./'), plugins: [react()],
  define: { 'import.meta.env.VITE_MATERIAL_ISSUE_ISOLATED': JSON.stringify('true'), 'import.meta.env.VITE_LOCAL_ANON_KEY': JSON.stringify(process.env.WARDAH_LOCAL_ANON_KEY) },
  resolve: { alias: [{ find: '@/lib/supabase', replacement: path('./supabase.ts') },
    { find: '../lib/supabase', replacement: path('./supabase.ts') },
    { find: '@/contexts/AuthContext', replacement: path('./identity.tsx') },
    { find: '@/hooks/usePermissions', replacement: path('./identity.tsx') },
    { find: '@', replacement: path('../../../src') }] },
  server: { host: '127.0.0.1', port: 4177, strictPort: true, proxy: { '/local-supabase/auth/v1': { target: 'http://127.0.0.1:55999', rewrite: value => value.replace('/local-supabase/auth/v1', '') }, '/local-supabase/rest/v1': { target: 'http://127.0.0.1:55998', rewrite: value => value.replace('/local-supabase/rest/v1', '') }, '/fixture-grants': 'http://127.0.0.1:4178', '/call': 'http://127.0.0.1:4178', '/state': 'http://127.0.0.1:4178' }, fs: { allow: [path('../../../')] } },
})
