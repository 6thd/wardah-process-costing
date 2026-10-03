import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const here=fileURLToPath(new URL('./',import.meta.url))
const client=process.env.WARDAH_QC_CLIENT
if(!client) throw new Error('PINNED_CLIENT_REQUIRED')
export default defineConfig({root:here,plugins:[react()],
 define:{'import.meta.env.VITE_MATERIAL_ISSUE_ISOLATED':JSON.stringify('true')},
 resolve:{dedupe:['react','react-dom','@tanstack/react-query'],alias:[
  {find:'@/lib/supabase',replacement:resolve(here,'supabase.ts')},
  {find:'../lib/supabase',replacement:resolve(here,'supabase.ts')},
  {find:'@/contexts/AuthContext',replacement:resolve(here,'identity.tsx')},
  {find:'@/hooks/usePermissions',replacement:resolve(here,'identity.tsx')},
  {find:'@',replacement:resolve(client,'src')}]},
 server:{host:'127.0.0.1',port:4177,strictPort:true,proxy:{'/call':'http://127.0.0.1:4178','/state':'http://127.0.0.1:4178','/fixture-grants':'http://127.0.0.1:4178'},fs:{allow:[resolve(here,'../../..'),client]}}})
