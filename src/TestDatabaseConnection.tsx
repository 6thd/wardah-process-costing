import { useState, useEffect } from 'react'
import { getSupabase } from '@/lib/supabase'

export function TestDatabaseConnection() {
  const [testResults, setTestResults] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    runTests()
  }, [])

  const runTests = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const client = await getSupabase()
      
      // Test 1: Check if we can connect to the database
      const connectionTest = await client.from('gl_accounts').select('count').limit(1)
      
      // Test 2: Check what columns exist in the gl_accounts table
      const columnsTest = await client.from('gl_accounts').select('*').limit(1)
      
      // Test 3: Check if there are any records
      const countTest = await client.from('gl_accounts').select('count', { count: 'exact' })
      
      // Test 4: Try to get a few records with different column combinations
      const dataTests = []
      
      // Try with org_id
      try {
        const orgIdTest = await client.from('gl_accounts').select('*').eq('org_id', '00000000-0000-0000-0000-000000000001').limit(5)
        dataTests.push({ name: 'org_id filter', result: orgIdTest })
      } catch (e) {
        dataTests.push({ name: 'org_id filter', error: e })
      }
      
      // Try with tenant_id
      try {
        const tenantIdTest = await client.from('gl_accounts').select('*').eq('tenant_id', '00000000-0000-0000-0000-000000000001').limit(5)
        dataTests.push({ name: 'tenant_id filter', result: tenantIdTest })
      } catch (e) {
        dataTests.push({ name: 'tenant_id filter', error: e })
      }
      
      // Try without filters
      try {
        const noFilterTest = await client.from('gl_accounts').select('*').limit(5)
        dataTests.push({ name: 'no filter', result: noFilterTest })
      } catch (e) {
        dataTests.push({ name: 'no filter', error: e })
      }
      
      setTestResults({
        timestamp: new Date().toISOString(),
        connectionTest,
        columnsTest,
        countTest,
        dataTests
      })
    } catch (err: any) {
      console.error('Test error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Database Connection Test</h1>
        <p>Running tests...</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Database Connection Test</h1>
      
      <div className="mb-4">
        <button 
          onClick={runTests}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Run Tests Again
        </button>
      </div>
      
      {error && (
        <div className="mb-4 p-4 bg-red-100 text-red-800 rounded">
          <h2 className="text-lg font-semibold mb-2">Error</h2>
          <p>{error}</p>
        </div>
      )}
      
      {testResults && (
        <div className="mb-4 p-4 bg-gray-50 rounded">
          <h2 className="text-lg font-semibold mb-2">Test Results</h2>
          <p><strong>Timestamp:</strong> {new Date(testResults.timestamp).toLocaleString()}</p>
          
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">Connection Test</h3>
            <pre className="bg-white p-2 rounded text-xs overflow-auto max-h-40">
              {JSON.stringify(testResults.connectionTest, null, 2)}
            </pre>
          </div>
          
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">Columns Test</h3>
            <pre className="bg-white p-2 rounded text-xs overflow-auto max-h-40">
              {JSON.stringify(testResults.columnsTest, null, 2)}
            </pre>
          </div>
          
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">Count Test</h3>
            <pre className="bg-white p-2 rounded text-xs overflow-auto max-h-40">
              {JSON.stringify(testResults.countTest, null, 2)}
            </pre>
          </div>
          
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">Data Tests</h3>
            {testResults.dataTests.map((test: any, index: number) => (
              <div key={index} className="mb-3">
                <h4 className="font-medium">{test.name}</h4>
                <pre className="bg-white p-2 rounded text-xs overflow-auto max-h-40">
                  {JSON.stringify(test.result || test.error, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}