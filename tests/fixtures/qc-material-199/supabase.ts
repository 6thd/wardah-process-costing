// Local SQL adapter. Identity is simulated; authorization is executed by PostgreSQL.
import { actor, identity } from './identity'
export const getEffectiveTenantId = async () => identity.org
export const getTenantId = getEffectiveTenantId
const call = async (body: unknown) => {
 const result = await fetch('/call', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({actor,...body as object}) })
 if (!result.ok) throw new Error('DISPOSABLE_BRIDGE_FAILED')
 return result.json()
}
export const supabase = {
 auth: { getUser: async () => ({ data:{user:{id:identity.user}},error:null }) },
 async rpc(name: string, args: Record<string,unknown>) {
  const result = await call({kind:'rpc',name,args})
  const loss = name === 'rpc_consume_material_event' ? 'operator:lose-issue' : name === 'rpc_record_quality_inspection' ? 'operator:lose-inspection' : ''
  if (loss && localStorage.getItem(loss) === 'true' && !result.error) {
   localStorage.removeItem(loss); throw new Error('LOCAL_COMMIT_THEN_LOST_RESPONSE')
  }
  return result
 },
 from(table: string) {
  let id=''; let org=''; let after: string|null=null; let size=500; const filters: Record<string,unknown>={}
  const execute=()=>call({kind:id?'read':'catalog',table,id,org,after,limit:size,filters})
  const query={ select:(_columns:string)=>query,
   eq:(key:string,value:unknown)=>{ if(key==='id') id=String(value); else if(key==='org_id') org=String(value); else filters[key]=value; return query },
   in:(key:string,value:string[])=>{filters[key]=value;return query},
   single:execute, order:(_column:string)=>query,
   gt:(column:string,value:string)=>{if(column!=='id') throw new Error('UNREVIEWED_FIXTURE_READ');after=value;return query},
   limit:(value:number)=>{size=value;return query},
   then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>execute().then(resolve,reject) }
  return query
 }
}
export const getSupabase=()=>supabase
