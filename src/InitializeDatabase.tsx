import { useState } from 'react'
import { getSupabase } from '@/lib/supabase'

export function InitializeDatabase() {
  const [initializationStatus, setInitializationStatus] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initializeDatabase = async () => {
    try {
      setLoading(true)
      setError(null)
      
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
      const { data: authUsers, error: authUsersError } = await client.rpc('auth.users').select('*')
      
      if (!authUsersError && authUsers && authUsers.length > 0) {
        for (const user of authUsers) {
          // Create user profile if it doesn't exist
          const { error: userError } = await client.from('users').upsert({
            id: user.id,
            email: user.email,
            full_name: user.email?.split('@')[0] || 'User',
            role: 'admin',
            tenant_id: '00000000-0000-0000-0000-000000000001'
          }, { onConflict: 'id' })
          
          if (userError) {
            results.push({ step: `Creating user profile for ${user.email}`, status: 'failed', error: userError.message })
          } else {
            results.push({ step: `Creating user profile for ${user.email}`, status: 'completed' })
          }
          
          // Associate user with organization
          const { error: userOrgError } = await client.from('user_organizations').upsert({
            user_id: user.id,
            org_id: '00000000-0000-0000-0000-000000000001',
            role: 'admin'
          }, { onConflict: 'user_id,org_id' })
          
          if (userOrgError) {
            results.push({ step: `Associating ${user.email} with organization`, status: 'failed', error: userOrgError.message })
          } else {
            results.push({ step: `Associating ${user.email} with organization`, status: 'completed' })
          }
        }
      }
      
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
    </div>
  )
}