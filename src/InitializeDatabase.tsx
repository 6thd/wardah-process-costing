import { useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import {
  createDefaultOrganization,
  associateUsersWithOrganization,
  createSampleGLAccounts,
  type InitializationResult
} from './InitializeDatabase/services/initializationSteps'

export function InitializeDatabase() {
  const [initializationStatus, setInitializationStatus] = useState<{
    timestamp: string;
    results: InitializationResult[];
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initializeDatabase = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const client = getSupabase()
      const results: InitializationResult[] = []
      
      await createDefaultOrganization(client, results)
      await associateUsersWithOrganization(client, results)
      await createSampleGLAccounts(client, results)
      
      setInitializationStatus({
        timestamp: new Date().toISOString(),
        results
      })
    } catch (err: any) {
      console.error('Initialization error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Database Initialization</h1>
      
      <div className="mb-4 p-4 bg-blue-50 rounded-lg">
        <h2 className="text-lg font-semibold mb-2">⚠️ Important</h2>
        <p className="text-sm text-gray-700">
          This tool will initialize your database with default data if it's empty. 
          This includes creating a default organization, associating users, and 
          creating sample chart of accounts if none exist.
        </p>
      </div>
      
      <div className="mb-4">
        <button 
          onClick={initializeDatabase}
          disabled={loading}
          className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:opacity-50"
        >
          {loading ? 'Initializing...' : 'Initialize Database'}
        </button>
      </div>
      
      {error && (
        <div className="mb-4 p-4 bg-red-100 text-red-800 rounded">
          <h2 className="text-lg font-semibold mb-2">Error</h2>
          <p>{error}</p>
        </div>
      )}
      
      {initializationStatus && (
        <div className="mb-4 p-4 bg-gray-50 rounded">
          <h2 className="text-lg font-semibold mb-2">Initialization Status</h2>
          <p><strong>Timestamp:</strong> {new Date(initializationStatus.timestamp).toLocaleString()}</p>
          
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">Steps</h3>
            <div className="space-y-2">
              {initializationStatus.results.map((result) => {
                let statusClass = 'bg-blue-100 text-blue-800';
                if (result.status === 'completed') {
                  statusClass = 'bg-green-100 text-green-800';
                } else if (result.status === 'failed') {
                  statusClass = 'bg-red-100 text-red-800';
                }
                
                return (
                  <div key={`${result.step}-${result.status}`} className="p-2 rounded border">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{result.step}</span>
                      <span className={`px-2 py-1 rounded text-xs ${statusClass}`}>
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
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}