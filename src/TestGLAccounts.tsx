import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { getSupabase, getAllGLAccounts, debugGLAccounts } from '@/lib/supabase'

export function TestGLAccounts() {
  const location = useLocation()
  const [accounts, setAccounts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<any>(null)
  const [debugInfo, setDebugInfo] = useState<any>(null)
  const [isStackDepthError, setIsStackDepthError] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [initializationStatus, setInitializationStatus] = useState<any>(null)
  const accountsPerPage = 100

  console.log('🔧 TestGLAccounts component rendered', { pathname: location.pathname })

  useEffect(() => {
    console.log('🔧 TestGLAccounts useEffect triggered')
    loadSession()
    loadAccounts()
  }, [])

  const loadSession = async () => {
    try {
      console.log('Loading session...')
      const client = getSupabase()
      const { data: { session } } = await client.auth.getSession()
      setSession(session)
      console.log('Session loaded:', session)
    } catch (err) {
      console.error('Error loading session:', err)
    }
  }

  const loadAccounts = async () => {
    try {
      setLoading(true)
      setError(null)
      setIsStackDepthError(false)
      
      console.log('Testing GL accounts query with pagination...')
      
      // Debug first
      await debugGLAccounts();
      
      // Use the new getAllGLAccounts function to get all accounts
      // This function now properly handles tenant ID retrieval and stack depth issues
      const result = await getAllGLAccounts()
      console.log('getAllGLAccounts result:', result)
      
      // Get tenant ID for debugging
      const client = getSupabase()
      const { data: { session } } = await client.auth.getSession()
      
      // Try multiple approaches to get tenant/org ID
      let tenantId = null;
      if (session?.user?.user_metadata?.org_id) {
        tenantId = session.user.user_metadata.org_id;
      } else if (session?.user?.user_metadata?.tenant_id) {
        tenantId = session.user.user_metadata.tenant_id;
      } else if (session?.access_token) {
        try {
          const tokenPayload = JSON.parse(atob(session.access_token.split('.')[1]));
          tenantId = tokenPayload.org_id || tokenPayload.tenant_id || null;
        } catch (decodeError) {
          console.log('Could not decode access token:', decodeError);
        }
      }
      
      console.log('Tenant ID:', tenantId)
      
      setDebugInfo({
        timestamp: new Date().toISOString(),
        result: result,
        dataLength: result.length || 0,
        tenantId: tenantId,
        session: session ? {
          userId: session.user?.id,
          userEmail: session.user?.email,
          userMetadata: session.user?.user_metadata,
          appMetadata: session.user?.app_metadata
        } : null
      })
      
      setAccounts(result)
      
      // For pagination, we would need to implement cursor-based pagination in the backend
      // For now, we'll just use simple page-based pagination
      setHasNextPage(result.length === accountsPerPage)
    } catch (err: any) {
      console.error('Error:', err)
      setDebugInfo({
        timestamp: new Date().toISOString(),
        error: err.message,
        stack: err.stack
      })
      setError(err.message)
      // Check if it's a stack depth error
      if (err.message && err.message.includes('stack depth limit exceeded')) {
        setIsStackDepthError(true)
      }
    } finally {
      setLoading(false)
    }
  }

  const initializeDatabase = async () => {
    try {
      setLoading(true)
      const client = getSupabase()
      const results: any[] = []
      
      // Step 1: Ensure organizations table exists and has default org
      results.push({ step: 'Creating default organization', status: 'started' })
      const { error: orgError } = await client.from('organizations').upsert({
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Wardah Factory',
        code: 'WARD'
      }, { onConflict: 'id' })
      
      if (orgError) {
        results.push({ step: 'Creating default organization', status: 'failed', error: orgError.message })
      } else {
        results.push({ step: 'Creating default organization', status: 'completed' })
      }
      
      // Step 2: Check if we have any users and associate them with the default org
      results.push({ step: 'Associating users with organization', status: 'started' })
      
      // Step 3: Create sample GL accounts if none exist
      results.push({ step: 'Checking GL accounts', status: 'started' })
      const { count: accountsCount, error: countError } = await client.from('gl_accounts')
        .select('*', { count: 'exact', head: true })
      
      if (!countError && (accountsCount === 0 || accountsCount === null)) {
        results.push({ step: 'Creating sample GL accounts', status: 'started' })
        
        // Sample chart of accounts data
        const sampleAccounts = [
          {
            id: '10000000-0000-0000-0000-000000000001',
            org_id: '00000000-0000-0000-0000-000000000001',
            code: '100000',
            name: 'الأصول',
            category: 'ASSET',
            subtype: 'OTHER',
            normal_balance: 'DEBIT',
            allow_posting: false,
            is_active: true,
            currency: 'SAR'
          },
          {
            id: '10000000-0000-0000-0000-000000000002',
            org_id: '00000000-0000-0000-0000-000000000001',
            code: '110000',
            name: 'الأصول المتداولة',
            category: 'ASSET',
            subtype: 'OTHER',
            parent_code: '100000',
            normal_balance: 'DEBIT',
            allow_posting: false,
            is_active: true,
            currency: 'SAR'
          },
          {
            id: '10000000-0000-0000-0000-000000000003',
            org_id: '00000000-0000-0000-0000-000000000001',
            code: '110100',
            name: 'النقدية في الخزينة',
            category: 'ASSET',
            subtype: 'CASH',
            parent_code: '110000',
            normal_balance: 'DEBIT',
            allow_posting: true,
            is_active: true,
            currency: 'SAR'
          },
          {
            id: '10000000-0000-0000-0000-000000000004',
            org_id: '00000000-0000-0000-0000-000000000001',
            code: '200000',
            name: 'الخصوم',
            category: 'LIABILITY',
            subtype: 'OTHER',
            normal_balance: 'CREDIT',
            allow_posting: false,
            is_active: true,
            currency: 'SAR'
          },
          {
            id: '10000000-0000-0000-0000-000000000005',
            org_id: '00000000-0000-0000-0000-000000000001',
            code: '300000',
            name: 'حقوق الملكية',
            category: 'EQUITY',
            subtype: 'OTHER',
            normal_balance: 'CREDIT',
            allow_posting: false,
            is_active: true,
            currency: 'SAR'
          },
          {
            id: '10000000-0000-0000-0000-000000000006',
            org_id: '00000000-0000-0000-0000-000000000001',
            code: '400000',
            name: 'الإيرادات',
            category: 'REVENUE',
            subtype: 'OTHER',
            normal_balance: 'CREDIT',
            allow_posting: true,
            is_active: true,
            currency: 'SAR'
          },
          {
            id: '10000000-0000-0000-0000-000000000007',
            org_id: '00000000-0000-0000-0000-000000000001',
            code: '500000',
            name: 'المصروفات',
            category: 'EXPENSE',
            subtype: 'OTHER',
            normal_balance: 'DEBIT',
            allow_posting: true,
            is_active: true,
            currency: 'SAR'
          }
        ]
        
        // Insert sample accounts
        const { error: insertError } = await client.from('gl_accounts').insert(sampleAccounts)
        
        if (insertError) {
          results.push({ step: 'Creating sample GL accounts', status: 'failed', error: insertError.message })
        } else {
          results.push({ step: 'Creating sample GL accounts', status: 'completed' })
        }
      } else {
        results.push({ step: 'Checking GL accounts', status: 'completed', message: `Found ${accountsCount} existing accounts` })
      }
      
      setInitializationStatus({
        timestamp: new Date().toISOString(),
        results
      })
      
      // Reload accounts after initialization
      await loadAccounts()
    } catch (err: any) {
      console.error('Initialization error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const refresh = () => {
    loadAccounts()
  }

  const handlePageChange = (pageNumber: number) => {
    setCurrentPage(pageNumber)
    loadAccounts()
  }

  if (loading && !initializationStatus) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Test GL Accounts</h1>
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Test GL Accounts</h1>
      
      <div className="mb-4 p-4 bg-blue-50 rounded-lg">
        <h2 className="text-lg font-semibold mb-2">Instructions</h2>
        <p className="text-sm text-gray-700">
          This page helps debug issues with the Chart of Accounts not displaying. 
          Check the console logs and debug information below to identify the issue.
        </p>
      </div>
      
      {isStackDepthError && (
        <div className="mb-4 p-4 bg-red-100 text-red-800 rounded">
          <h2 className="text-lg font-semibold mb-2">⚠️ Database Configuration Issue</h2>
          <p className="mb-2">The database is experiencing a "stack depth limit exceeded" error, which is preventing data retrieval.</p>
          <p className="mb-2">This is likely due to deep recursion when querying the chart of accounts hierarchy.</p>
          <p className="font-semibold">Solution:</p>
          <ul className="list-disc pl-5 mt-2">
            <li>The application has been updated to use Materialized Path with ltree to avoid recursion</li>
            <li>Make sure you've run the IMPLEMENT_MATERIALIZE_PATH.sql script in your Supabase SQL Editor</li>
            <li>If you're still seeing this error, please contact Supabase support</li>
          </ul>
        </div>
      )}
      
      <div className="mb-4">
        <h2 className="text-lg font-semibold mb-2">Session Info</h2>
        <pre className="bg-gray-100 p-2 rounded text-xs overflow-auto max-h-40">
          {session ? JSON.stringify(session, null, 2) : 'No session'}
        </pre>
      </div>
      
      <div className="mb-4 flex space-x-2">
        <button 
          onClick={refresh}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Refresh Data
        </button>
        <button 
          onClick={initializeDatabase}
          className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
        >
          Initialize Database
        </button>
      </div>
      
      {initializationStatus && (
        <div className="mb-4 p-4 bg-gray-50 rounded">
          <h2 className="text-lg font-semibold mb-2">Initialization Status</h2>
          <p><strong>Timestamp:</strong> {new Date(initializationStatus.timestamp).toLocaleString()}</p>
          
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">Steps</h3>
            <div className="space-y-2">
              {initializationStatus.results.map((result: any, index: number) => (
                <div key={index} className="p-2 rounded border">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{result.step}</span>
                    <span className={`px-2 py-1 rounded text-xs ${
                      result.status === 'completed' ? 'bg-green-100 text-green-800' :
                      result.status === 'failed' ? 'bg-red-100 text-red-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {result.status}
                    </span>
                  </div>
                  {result.error && (
                    <p className="text-red-600 text-sm mt-1">{result.error}</p>
                  )}
                  {result.message && (
                    <p className="text-gray-600 text-sm mt-1">{result.message}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {debugInfo && (
        <div className="mb-4 p-4 bg-yellow-50 rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Debug Information</h2>
          <div className="text-sm">
            <p><strong>Timestamp:</strong> {new Date(debugInfo.timestamp).toLocaleString()}</p>
            <p><strong>Data Length:</strong> {debugInfo.dataLength}</p>
            <p><strong>Tenant ID:</strong> {debugInfo.tenantId || 'Not found'}</p>
            {debugInfo.error && (
              <p className="text-red-600"><strong>Error:</strong> {debugInfo.error}</p>
            )}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-blue-600">Show Full Debug Info</summary>
            <pre className="bg-white p-2 rounded text-xs overflow-auto max-h-40 mt-2">
              {JSON.stringify(debugInfo, null, 2)}
            </pre>
          </details>
        </div>
      )}
      
      {error && !isStackDepthError && (
        <div className="mb-4 p-4 bg-red-100 text-red-800 rounded">
          <h2 className="text-lg font-semibold mb-2">Error</h2>
          <p>{error}</p>
        </div>
      )}
      
      <div>
        <h2 className="text-lg font-semibold mb-2">
          Accounts ({accounts.length})
        </h2>
        {accounts.length > 0 ? (
          <div className="border rounded">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="text-left p-2">Code</th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Active</th>
                  <th className="text-left p-2">Path</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="border-t">
                    <td className="p-2 font-mono">{account.code}</td>
                    <td className="p-2">{account.name}</td>
                    <td className="p-2">{account.category || account.account_type || 'N/A'}</td>
                    <td className="p-2">{account.is_active !== undefined ? (account.is_active ? 'Yes' : 'No') : 'N/A'}</td>
                    <td className="p-2 font-mono text-xs">{account.parent_code || account.path || 'None'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {/* Pagination */}
            <div className="p-4 flex justify-center items-center space-x-2">
              <button
                onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded border disabled:opacity-50"
              >
                Previous
              </button>
              
              <span className="text-sm">
                Page {currentPage}
              </span>
              
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={!hasNextPage}
                className="px-3 py-1 rounded border disabled:opacity-50"
              >
                Next
              </button>
            </div>
            
            {accounts.length > 0 && (
              <p className="p-2 text-gray-500 text-sm">
                Showing {(currentPage - 1) * accountsPerPage + 1}-{(currentPage - 1) * accountsPerPage + accounts.length} accounts
              </p>
            )}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500 bg-gray-50 rounded">
            <p>No accounts found</p>
            <p className="text-sm mt-2">This could be due to authentication issues, RLS policies, or database configuration</p>
          </div>
        )}
      </div>
    </div>
  )
}