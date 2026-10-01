import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { fileURLToPath } from 'node:url'
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
export default defineConfig({ root: path('./'), plugins: [react()],
  define: { 'import.meta.env.VITE_MATERIAL_ISSUE_ISOLATED': JSON.stringify('true') },
  resolve: { alias: [{ find: '@/lib/supabase', replacement: path('./supabase.ts') },
    { find: '../lib/supabase', replacement: path('./supabase.ts') },
    { find: '@/contexts/AuthContext', replacement: path('./identity.tsx') },
    { find: '@/hooks/usePermissions', replacement: path('./identity.tsx') },
    { find: '@', replacement: path('../../../src') }] },
  server: { host: '127.0.0.1', port: 4177, strictPort: true, proxy: { '/call': 'http://127.0.0.1:4178', '/state': 'http://127.0.0.1:4178' }, fs: { allow: [path('../../../')] } },
})
