import { useState, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'

export function CheckDatabaseSetup() {
  const [setupStatus, setSetupStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    checkSetup()
  }, [])

  const checkSetup = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const client = await getSupabase()
      
      // Check 1: Organizations table
      const orgCheck = await client.from('organizations').select('*').limit(5)
      
      // Check 2: Users table
      const userCheck = await client.from('users').select('*').limit(5)
      
      // Check 3: GL Accounts table
      const glAccountsCheck = await client.from('gl_accounts').select('*').limit(5)
      
      // Check 4: Count of records in each table
      const orgCount = await client.from('organizations').select('count', { count: 'exact' })
      const userCount = await client.from('users').select('count', { count: 'exact' })
      const glAccountsCount = await client.from('gl_accounts').select('count', { count: 'exact' })
      
      // Check 5: Check for default organization
      const defaultOrg = await client.from('organizations')
        .select('*')
        .eq('id', '00000000-0000-0000-0000-000000000001')
      
      // Check 6: Check for any GL accounts
      const anyGlAccounts = await client.from('gl_accounts').select('id, code, name').limit(10)
      
      setSetupStatus({
        timestamp: new Date().toISOString(),
        orgCheck,
        userCheck,
        glAccountsCheck,
        orgCount,
        userCount,
        glAccountsCount,
        defaultOrg,
        anyGlAccounts
      })
    } catch (err: any) {
      console.error('Setup check error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Database Setup Check</h1>
        <p>Checking database setup...</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Database Setup Check</h1>
      
      <div className="mb-4">
        <button 
          onClick={checkSetup}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Check Setup Again
        </button>
      </div>
      
      {error && (
        <div className="mb-4 p-4 bg-red-100 text-red-800 rounded">
          <h2 className="text-lg font-semibold mb-2">Error</h2>
          <p>{error}</p>
        </div>
      )}
      
      {setupStatus && (
        <div className="mb-4 p-4 bg-gray-50 rounded">
          <h2 className="text-lg font-semibold mb-2">Setup Status</h2>
          <p><strong>Timestamp:</strong> {new Date(setupStatus.timestamp).toLocaleString()}</p>
          
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">Organizations Table</h3>
            <p>Count: {setupStatus.orgCount?.count?.[0]?.count || 0}</p>
            <pre className="bg-white p-2 rounded text-xs overflow-auto max-h-40">
              {JSON.stringify(setupStatus.orgCheck, null, 2)}
            </pre>
          </div>
          
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">Users Table</h3>
            <p>Count: {setupStatus.userCount?.count?.[0]?.count || 0}</p>
            <pre className="bg-white p-2 rounded text-xs overflow-auto max-h-40">
              {JSON.stringify(setupStatus.userCheck, null, 2)}
            </pre>
          </div>
          
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">GL Accounts Table</h3>
            <p>Count: {setupStatus.glAccountsCount?.count?.[0]?.count || 0}</p>
            <pre className="bg-white p-2 rounded text-xs overflow-auto max-h-40">
              {JSON.stringify(setupStatus.glAccountsCheck, null, 2)}
            </pre>
          </div>
          
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">Default Organization</h3>
            <pre className="bg-white p-2 rounded text-xs overflow-auto max-h-40">
              {JSON.stringify(setupStatus.defaultOrg, null, 2)}
            </pre>
          </div>
          
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">Sample GL Accounts</h3>
            <pre className="bg-white p-2 rounded text-xs overflow-auto max-h-40">
              {JSON.stringify(setupStatus.anyGlAccounts, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}