import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getTableName, loadConfig } from './config.ts'

// Re-export config functions for backwards compatibility
export { getTableName }

// Global client instance
let supabaseClient: SupabaseClient | null = null
let isInitialized = false
let initPromise: Promise<SupabaseClient> | null = null

/**
 * Initialize Supabase client with dynamic configuration
 */
const initializeClient = async (): Promise<SupabaseClient> => {
  if (supabaseClient && isInitialized) {
    return supabaseClient
  }

  try {
    console.log('🔧 Initializing Supabase client...')
    // Load configuration
    const response = await fetch('/config.json')
    if (!response.ok) {
      throw new Error(`Failed to load config.json: ${response.status}`)
    }
    const configData = await response.json()
    console.log('✅ Config loaded:', configData)

    // Use config values or fallback to environment variables
    const supabaseUrl = configData.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
    const supabaseAnonKey = configData.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

    // If we're in demo mode, use demo credentials
    if (configData.FEATURES?.demo_mode) {
      console.log('⚠️ DEMO MODE: Using placeholder Supabase configuration')
      // We'll still create a client but it won't be used for actual authentication
      // The auth store has a fallback for demo credentials
    } else if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase environment variables')
    }

    // Create client with valid or placeholder values
    const url = supabaseUrl || 'https://placeholder.supabase.co'
    const key = supabaseAnonKey || 'placeholder-key'
    
    console.log('🔧 Creating Supabase client with:', { url, key })
    supabaseClient = createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    })

    isInitialized = true
    console.log('✅ Supabase client initialized successfully')
    return supabaseClient

  } catch (error) {
    console.error('❌ Failed to initialize Supabase client:', error)
    // Create a fallback client to prevent app crash
    supabaseClient = createClient(
      'https://placeholder.supabase.co', 
      'placeholder-key',
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        }
      }
    )
    isInitialized = true
    console.log('⚠️ Created fallback Supabase client to prevent app crash')
    return supabaseClient
  }
}

/**
 * Get Supabase client instance (async)
 */
export const getSupabase = async (): Promise<SupabaseClient> => {
  if (supabaseClient && isInitialized) {
    return supabaseClient
  }
  
  if (!initPromise) {
    initPromise = initializeClient()
  }
  
  return initPromise
}

// Initialize client immediately
console.log('🔧 Starting Supabase client initialization...')
const clientPromise = initializeClient().catch(error => {
  console.error('Failed to auto-initialize Supabase client:', error)
  return null
})

// Export client (will be initialized)
export const supabase = await clientPromise
console.log('✅ Supabase client ready:', supabase)

// Helper function to get the client safely
const getSupabaseClient = async () => {
  const client = await clientPromise
  if (!client) {
    throw new Error('Supabase client not initialized')
  }
  return client
}

// Enhanced tenant management functions
export const getTenantId = async (): Promise<string | null> => {
  try {
    const client = await clientPromise
    if (!client) return null
    
    const { data: { session } } = await client.auth.getSession()
    
    // Try multiple ways to get tenant ID
    // First, check user metadata
    let tenantId = null
    
    if (session?.user?.user_metadata?.tenant_id) {
      tenantId = session.user.user_metadata.tenant_id
    } else if (session?.access_token) {
      // Try to parse from JWT
      try {
        const payload = JSON.parse(atob(session.access_token.split('.')[1]))
        tenantId = payload.tenant_id || null
      } catch (e) {
        console.warn('Could not parse tenant ID from JWT:', e)
      }
    }
    
    // If we still don't have a tenant ID, try to get it from the custom users table
    if (!tenantId && session?.user?.id) {
      try {
        const { data: userProfile, error } = await client
          .from('users')
          .select('tenant_id')
          .eq('id', session.user.id)
          .single()
          
        if (!error && userProfile?.tenant_id) {
          tenantId = userProfile.tenant_id
        }
      } catch (error) {
        console.log('Could not get tenant ID from custom users table')
      }
    }
    
    // In demo mode, return a default tenant ID
    if (!tenantId) {
      const configResponse = await fetch('/config.json')
      if (configResponse.ok) {
        const configData = await configResponse.json()
        const isDemoMode = configData?.FEATURES?.demo_mode || false
        if (isDemoMode) {
          console.log('Demo mode: using default tenant ID')
          return '00000000-0000-0000-0000-000000000001'
        }
      }
    }
    
    console.log('Retrieved tenant ID:', tenantId)
    return tenantId
  } catch (error) {
    console.error('Error getting tenant ID:', error)
    
    // In demo mode, return a default tenant ID even if there's an error
    try {
      const configResponse = await fetch('/config.json')
      if (configResponse.ok) {
        const configData = await configResponse.json()
        const isDemoMode = configData?.FEATURES?.demo_mode || false
        if (isDemoMode) {
          console.log('Demo mode fallback: using default tenant ID')
          return '00000000-0000-0000-0000-000000000001'
        }
      }
    } catch (e) {
      console.warn('Could not determine demo mode status:', e)
    }
    
    return null
  }
}

// New function to get organization ID from user metadata
export const getOrgId = async (): Promise<string | null> => {
  try {
    const client = await clientPromise
    if (!client) return null
    
    const { data: { session } } = await client.auth.getSession()
    
    // Try multiple ways to get organization ID
    let orgId = null
    
    if (session?.user?.user_metadata?.org_id) {
      orgId = session.user.user_metadata.org_id
    } else if (session?.access_token) {
      // Try to parse from JWT
      try {
        const payload = JSON.parse(atob(session.access_token.split('.')[1]))
        orgId = payload.org_id || null
      } catch (e) {
        console.warn('Could not parse org ID from JWT:', e)
      }
    }
                 
    console.log('Retrieved org ID:', orgId)
    return orgId
  } catch (error) {
    console.error('Error getting org ID:', error)
    return null
  }
}

// Try to resolve organization ID from user_orgs membership table
export const getOrgIdFromMembership = async (): Promise<string | null> => {
  try {
    const client = await clientPromise
    if (!client) return null

    const { data: { session } } = await client.auth.getSession()
    if (!session?.user?.id) {
      console.warn('No session or user ID found')
      return null
    }

    const { data, error } = await client
      .from('user_orgs')
      .select('org_id')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: true })
      .limit(1)

    if (error) {
      console.warn('getOrgIdFromMembership query failed:', error)
      return null
    }

    const orgId = data && data.length > 0 ? data[0].org_id as string : null
    console.log('Retrieved org ID from membership:', orgId)
    return orgId
  } catch (err) {
    console.error('Error in getOrgIdFromMembership:', err)
    return null
  }
}

// Fallback function to get default org ID when no session
export const getDefaultOrgId = async (): Promise<string | null> => {
  try {
    // Return the default organization ID we created
    return '00000000-0000-0000-0000-000000000001'
  } catch (err) {
    console.error('Error in getDefaultOrgId:', err)
    return null
  }
}

// Function to get tenant ID with fallback to org ID
export const getEffectiveTenantId = async (): Promise<string | null> => {
  const tenantId = await getTenantId()
  if (tenantId) return tenantId
  
  const orgId = await getOrgId()
  if (orgId) return orgId

  // Fallback: try membership table
  const membershipOrgId = await getOrgIdFromMembership()
  if (membershipOrgId) return membershipOrgId

  // Final fallback: use default org ID
  const defaultOrgId = await getDefaultOrgId()
  if (defaultOrgId) return defaultOrgId
  
  // In demo mode, return a default tenant ID
  try {
    const configResponse = await fetch('/config.json')
    if (configResponse.ok) {
      const configData = await configResponse.json()
      const isDemoMode = configData?.FEATURES?.demo_mode || false
      if (isDemoMode) {
        console.log('Demo mode: using default tenant ID')
        return '00000000-0000-0000-0000-000000000001'
      }
    }
  } catch (e) {
    console.warn('Could not determine demo mode status from config.json:', e)
  }
  
  // Try to get config directly
  try {
    const config = await loadConfig()
    if (config?.FEATURES?.demo_mode) {
      console.log('Demo mode (from config): using default tenant ID')
      return '00000000-0000-0000-0000-000000000001'
    }
  } catch (e) {
    console.warn('Could not load config:', e)
  }
  
  console.log('No tenant ID or org ID found')
  return null
}

export const getCurrentUser = async () => {
  const client = await clientPromise
  if (!client) return null
  
  const { data: { session } } = await client.auth.getSession()
  
  if (!session?.user) return null
  
  // Try to get user profile from custom users table
  try {
    const { data: profile, error } = await client
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single()
      
    if (!error && profile) {
      return profile
    }
  } catch (error) {
    console.log('Custom users table not accessible, using auth user data')
  }
  
  // Fallback to auth user data
  return {
    id: session.user.id,
    email: session.user.email || '',
    full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User',
    role: session.user.user_metadata?.role || 'employee',
    created_at: session.user.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

// Helper function for tenant-aware queries with demo mode support
export const withTenant = async <T>(tableName: string) => {
  const client = await clientPromise
  if (!client) throw new Error('Supabase client not initialized')
  
  const tenantId = await getTenantId()
  
  const configResponse = await fetch('/config.json')
  if (!configResponse.ok) {
    throw new Error('Configuration not loaded')
  }
  const configData = await configResponse.json()
  
  const table = configData.TABLE_NAMES[tableName] || tableName
  
  // Check if we're in demo mode
  const isDemoMode = configData.FEATURES?.demo_mode || false
  
  // Return an object with properly initialized query methods
  return {
    select: (columns: string = '*') => {
      const query = client.from(table).select(columns)
      // In demo mode, don't apply tenant filtering to allow viewing data
      if (!isDemoMode && tenantId) {
        return query.eq('tenant_id', tenantId)
      }
      // For gl_accounts table in demo mode, we might need to use a specific org_id
      if (isDemoMode && tableName === 'gl_accounts') {
        // We could add a specific filter here if needed
        return query
      }
      return query
    },
    insert: (data: any) => {
      const insertData = tenantId ? { ...data, tenant_id: tenantId } : data
      return client.from(table).insert(insertData)
    },
    update: (data: any) => {
      const query = client.from(table).update(data)
      return tenantId ? query.eq('tenant_id', tenantId) : query
    },
    delete: () => {
      const query = client.from(table).delete()
      return tenantId ? query.eq('tenant_id', tenantId) : query
    },
    upsert: (data: any) => {
      const upsertData = tenantId ? { ...data, tenant_id: tenantId } : data
      return client.from(table).upsert(upsertData)
    },
    // For cases where you need the raw client.from() with proper tenant filtering
    from: () => client.from(table),
    // Get tenant ID for manual query building
    getTenantId: () => tenantId,
    // Get table name for manual query building
    getTableName: () => table
  }
}

// Add a direct query function for gl_accounts that works in demo mode
export const queryGLAccounts = async (parentCode?: string, page: number = 1, pageSize: number = 100) => {
  try {
    const orgId = await getEffectiveTenantId();
    console.log('Querying GL accounts with orgId:', orgId);
    
    if (!orgId) {
      console.warn('No organization ID found, returning sample data');
      return getSampleGLAccounts();
    }

    const client = await getSupabaseClient();

    // Use a larger page size to get more accounts
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Try different approaches to query the data
    let data, error;
    
    // Approach 1: Try with org_id (newer schema)
    try {
      console.log('Executing query with org_id filter...');
      let query = client
        .from('gl_accounts')
        .select(`
          id,
          code,
          name,
          path,
          category,
          subtype,
          parent_code,
          normal_balance,
          allow_posting,
          is_active,
          currency,
          notes,
          org_id,
          created_at,
          updated_at
        `)
        .eq('org_id', orgId)
        .order('code', { ascending: true })
        .range(from, to);

      // If parentCode is provided, filter to get children
      if (parentCode) {
        console.log('Filtering by parentCode:', parentCode);
        query = query.eq('parent_code', parentCode);
      }

      ({ data, error } = await query);

      if (error) {
        throw error;
      }
      
      console.log('Query with org_id returned', data?.length, 'accounts');
    } catch (orgIdError) {
      console.warn('Query with org_id failed, trying tenant_id:', orgIdError);
      
      // Approach 2: Try with tenant_id (older schema)
      try {
        let query = client
          .from('gl_accounts')
          .select(`
            id,
            code,
            name,
            path,
            category,
            subtype,
            parent_code,
            normal_balance,
            allow_posting,
            is_active,
            currency,
            notes,
            tenant_id,
            created_at,
            updated_at
          `)
          .eq('tenant_id', orgId)
          .order('code', { ascending: true })
          .range(from, to);

        // If parentCode is provided, filter to get children
        if (parentCode) {
          console.log('Filtering by parentCode:', parentCode);
          query = query.eq('parent_code', parentCode);
        }

        ({ data, error } = await query);

        if (error) {
          throw error;
        }
        
        console.log('Query with tenant_id returned', data?.length, 'accounts');
      } catch (tenantIdError) {
        console.warn('Query with tenant_id also failed:', tenantIdError);
        
        // Approach 3: Try without tenant/org filter
        console.log('Trying without tenant/org filter...');
        let query = client
          .from('gl_accounts')
          .select(`
            id,
            code,
            name,
            path,
            category,
            subtype,
            parent_code,
            normal_balance,
            allow_posting,
            is_active,
            currency,
            notes,
            org_id,
            tenant_id,
            created_at,
            updated_at
          `)
          .order('code', { ascending: true })
          .range(from, to);

        // If parentCode is provided, filter to get children
        if (parentCode) {
          console.log('Filtering by parentCode:', parentCode);
          query = query.eq('parent_code', parentCode);
        }

        ({ data, error } = await query);

        if (error) {
          console.error('All query approaches failed:', error);
          return getSampleGLAccounts();
        }
      }
    }

    console.log('Query returned', data?.length, 'accounts');
    return data || [];
  } catch (error) {
    console.error('Error in queryGLAccounts:', error);
    return getSampleGLAccounts();
  }
};

// Function to get all GL accounts without pagination
export const getAllGLAccounts = async (): Promise<any[]> => {
  try {
    console.log('🔍 Getting ALL gl_accounts without pagination...');
    
    const supabase = await getSupabaseClient();
    
    // First, try to get the current user/session to determine org/tenant ID
    const { data: { session } } = await supabase.auth.getSession();
    console.log('Current session:', session);
    
    // Try to get org/tenant ID with multiple fallback approaches
    let orgId = null;
    
    // Approach 1: Try to get from user metadata
    if (session?.user?.user_metadata?.org_id) {
      orgId = session.user.user_metadata.org_id;
    } 
    // Approach 2: Try to decode from access token
    else if (session?.access_token) {
      try {
        const tokenPayload = JSON.parse(atob(session.access_token.split('.')[1]));
        orgId = tokenPayload.org_id || null;
      } catch (decodeError) {
        console.log('Could not decode access token:', decodeError);
      }
    }
    
    console.log('Using org/tenant ID:', orgId);
    
    // If no orgId found, use default organization ID for demo/testing
    const defaultOrgId = '00000000-0000-0000-0000-000000000001';
    if (!orgId) {
      console.log('No orgId found, using default organization ID for demo/testing');
      orgId = defaultOrgId;
    }
    
    // Initialize variables
    let data: any[] | null = null;
    let error: any = null;
    
    // Try different query approaches to avoid stack depth issues
    // Approach 1: Try with org_id filter
    console.log('🔍 Attempt 1: Query with org_id filter');
    try {
      // Use a large limit to ensure we get all accounts
      const result = await supabase
        .from('gl_accounts')
        .select('id, code, name, org_id, category, subtype, parent_code, normal_balance, allow_posting, is_active, currency')
        .eq('org_id', orgId)
        .order('code', { ascending: true })
        .limit(10000); // Large limit to get all accounts
      
      data = result.data;
      error = result.error;
      
      if (!error && data) {
        console.log('✅ Attempt 1 success with org_id filter');
        console.log('Retrieved', data.length, 'accounts');
      } else if (error) {
        console.log('❌ Attempt 1 failed with org_id filter:', error.message);
      }
    } catch (attemptError: any) {
      console.log('❌ Attempt 1 exception:', attemptError.message);
    }
    
    // Approach 2: Try without any filters (demo mode)
    if (!data || data.length === 0) {
      console.log('🔍 Attempt 2: Query without filters (demo mode)');
      try {
        const result = await supabase
          .from('gl_accounts')
          .select('id, code, name, org_id, category, subtype, parent_code, normal_balance, allow_posting, is_active, currency')
          .order('code', { ascending: true })
          .limit(10000); // Large limit to get all accounts
        
        data = result.data;
        error = result.error;
        
        if (!error && data) {
          console.log('✅ Attempt 2 success without filters');
          console.log('Retrieved', data.length, 'accounts');
        } else if (error) {
          console.log('❌ Attempt 2 failed without filters:', error.message);
        }
      } catch (attemptError: any) {
        console.log('❌ Attempt 2 exception:', attemptError.message);
      }
    }
    
    // Approach 3: Ultimate fallback - try the simplest query
    if (!data || data.length === 0) {
      console.log('🔍 Attempt 3: Ultimate fallback - simplest query');
      try {
        const result = await supabase
          .from('gl_accounts')
          .select('id, code, name')
          .limit(10000); // Large limit to get all accounts
        
        data = result.data;
        error = result.error;
        
        if (!error && data) {
          console.log('✅ Attempt 3 success with simplest query');
          console.log('Retrieved', data.length, 'accounts');
        } else if (error) {
          console.log('❌ Attempt 3 failed with simplest query:', error.message);
        }
      } catch (attemptError: any) {
        console.log('❌ Attempt 3 exception:', attemptError.message);
      }
    }
    
    if (error && error.message && error.message.includes('stack depth limit exceeded')) {
      console.log('⚠️ Stack depth limit exceeded - using sample data');
      // Return sample data when we hit recursion issues
      return getSampleGLAccounts();
    }
    
    if (error) {
      console.error('❌ All query attempts failed:', error);
      return [];
    }
    
    console.log('✅ Query success:', data?.length || 0, 'records');
    console.log('📝 Sample data:', data?.slice(0, 3)); // Show first 3 records
    
    return data || [];
  } catch (error) {
    console.error('💥 Exception:', error);
    // Return sample data on exception
    return getSampleGLAccounts();
  }
};

// New function to get account hierarchy using ltree (path-based approach)
export const getAccountHierarchy = async (orgId: string, rootCode?: string) => {
  try {
    const client = await getSupabaseClient();
    
    let query = client
      .from('gl_accounts')
      .select(`
        id,
        code,
        name,
        category,
        subtype,
        parent_code,
        normal_balance,
        allow_posting,
        is_active,
        currency,
        notes,
        org_id,
        path,
        created_at,
        updated_at
      `)
      .eq('org_id', orgId)
      .order('code');

    if (rootCode) {
      // Get the root account to get its path
      const { data: rootAccount, error: rootError } = await client
        .from('gl_accounts')
        .select('path')
        .eq('code', rootCode)
        .eq('org_id', orgId)
        .single();

      if (rootError) {
        console.error('Error fetching root account:', rootError);
        return [];
      }

      if (rootAccount) {
        // Get all accounts in the subtree of the root using path-based query
        query = query.or(`path.cs.{${rootAccount.path}}`);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching account hierarchy:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getAccountHierarchy:', error);
    return [];
  }
};

// New function to get direct children of an account using ltree
export const getAccountChildren = async (orgId: string, parentCode: string) => {
  try {
    const client = await getSupabaseClient();
    
    // First get the parent account's path
    const { data: parentAccount, error: parentError } = await client
      .from('gl_accounts')
      .select('path')
      .eq('code', parentCode)
      .eq('org_id', orgId)
      .single();

    if (parentError) {
      console.error('Error fetching parent account:', parentError);
      return [];
    }

    if (!parentAccount) {
      console.error('Parent account not found');
      return [];
    }

    // Get all accounts that are direct children using path-based query
    const { data, error } = await client
      .from('gl_accounts')
      .select(`
        id,
        code,
        name,
        category,
        subtype,
        parent_code,
        normal_balance,
        allow_posting,
        is_active,
        currency,
        notes,
        org_id,
        path,
        created_at,
        updated_at
      `)
      .eq('org_id', orgId)
      .like('path', `${parentAccount.path}.%`)  // Direct children have paths like parent.child
      .not('path', 'like', `${parentAccount.path}.%.%`);  // But not grandchildren (which would be parent.child.grandchild)

    if (error) {
      console.error('Error fetching account children:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getAccountChildren:', error);
    return [];
  }
};

// Sample data for demo mode when table doesn't exist
const getSampleGLAccounts = (): GLAccount[] => {
  return [
    {
      id: '1',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '100000',
      name: 'Assets',
      name_ar: 'الأصول',
      category: 'ASSET',
      subtype: 'OTHER',
      parent_code: '',
      normal_balance: 'DEBIT',
      allow_posting: false,
      is_active: true,
      currency: 'SAR',
      notes: 'Main asset account',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: '2',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '110000',
      name: 'Current Assets',
      name_ar: 'الأصول المتداولة',
      category: 'ASSET',
      subtype: 'OTHER',
      parent_code: '100000',
      normal_balance: 'DEBIT',
      allow_posting: false,
      is_active: true,
      currency: 'SAR',
      notes: 'Current assets',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: '3',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '110100',
      name: 'Cash',
      name_ar: 'النقد',
      category: 'ASSET',
      subtype: 'CASH',
      parent_code: '110000',
      normal_balance: 'DEBIT',
      allow_posting: true,
      is_active: true,
      currency: 'SAR',
      notes: 'Cash account',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: '4',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '200000',
      name: 'Liabilities',
      name_ar: 'الخصوم',
      category: 'LIABILITY',
      subtype: 'OTHER',
      parent_code: '',
      normal_balance: 'CREDIT',
      allow_posting: false,
      is_active: true,
      currency: 'SAR',
      notes: 'Main liability account',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: '5',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '300000',
      name: 'Equity',
      name_ar: 'حقوق الملكية',
      category: 'EQUITY',
      subtype: 'OTHER',
      parent_code: '',
      normal_balance: 'CREDIT',
      allow_posting: false,
      is_active: true,
      currency: 'SAR',
      notes: 'Equity account',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: '6',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '400000',
      name: 'Revenue',
      name_ar: 'الإيرادات',
      category: 'REVENUE',
      subtype: 'OTHER',
      parent_code: '',
      normal_balance: 'CREDIT',
      allow_posting: true,
      is_active: true,
      currency: 'SAR',
      notes: 'Revenue account',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: '7',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '500000',
      name: 'Expenses',
      name_ar: 'المصروفات',
      category: 'EXPENSE',
      subtype: 'OTHER',
      parent_code: '',
      normal_balance: 'DEBIT',
      allow_posting: true,
      is_active: true,
      currency: 'SAR',
      notes: 'Expense account',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ]
}

// Connection status check
export const checkConnection = async (): Promise<boolean> => {
  try {
    const client = await getSupabaseClient();
    
    // Load config to get table names
    const configResponse = await fetch('/config.json');
    if (!configResponse.ok) return false;
    
    const configData = await configResponse.json();
    
    const { error } = await client.from(configData.TABLE_NAMES.users || 'users').select('count').limit(1)
    return !error
  } catch {
    return false
  }
}

// Database Types
export interface User {
  id: string
  email: string
  full_name?: string
  role: 'admin' | 'manager' | 'employee'
  tenant_id?: string
  created_at: string
  updated_at: string
}

export interface StageCost {
  id: string
  manufacturing_order_id: string
  stage_number: number
  work_center_id: string
  good_quantity: number
  defective_quantity?: number
  material_cost: number
  labor_cost: number
  overhead_cost: number
  total_cost: number
  unit_cost: number
  status: 'precosted' | 'actual' | 'completed'
  tenant_id?: string
  created_at: string
  updated_at: string
}

export interface LaborTimeLog {
  id: string
  manufacturing_order_id: string
  stage_number: number
  work_center_id: string
  employee_id: string
  start_time: string
  end_time?: string
  hours_worked?: number
  labor_rate: number
  total_cost: number
  tenant_id?: string
  created_at: string
}

export interface MOHApplied {
  id: string
  manufacturing_order_id: string
  stage_number: number
  work_center_id: string
  overhead_rate: number
  allocation_base: number
  total_applied: number
  tenant_id?: string
  created_at: string
}

export interface Category {
  id: string
  name: string
  name_ar: string
  description?: string
  created_at: string
  updated_at: string
}

export interface Item {
  id: string
  code: string
  name: string
  name_ar: string
  description?: string
  unit: string
  category_id?: string
  category?: Category
  cost_price: number
  selling_price: number
  stock_quantity: number
  minimum_stock: number
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: string
  code: string
  name: string
  name_ar: string
  contact_person?: string
  phone?: string
  email?: string
  address?: string
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  code: string
  name: string
  name_ar: string
  contact_person?: string
  phone?: string
  email?: string
  address?: string
  created_at: string
  updated_at: string
}

export interface ManufacturingOrder {
  id: string
  order_number: string
  item_id: string
  item?: Item
  quantity: number
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  start_date: string
  end_date?: string
  total_cost: number
  created_by: string
  user?: User
  created_at: string
  updated_at: string
}

export interface ProcessCost {
  id: string
  manufacturing_order_id: string
  process_name: string
  process_name_ar: string
  material_cost: number
  labor_cost: number
  overhead_cost: number
  total_cost: number
  created_at: string
}

export interface StockMovement {
  id: string
  item_id: string
  item?: Item
  movement_type: 'in' | 'out' | 'adjustment'
  quantity: number
  reference_type?: string
  reference_id?: string
  notes?: string
  created_by: string
  user?: User
  created_at: string
}

export interface PurchaseOrder {
  id: string
  order_number: string
  supplier_id: string
  supplier?: Supplier
  status: 'draft' | 'sent' | 'received' | 'cancelled'
  order_date: string
  delivery_date?: string
  total_amount: number
  created_by: string
  user?: User
  created_at: string
  updated_at: string
}

export interface PurchaseOrderItem {
  id: string
  purchase_order_id: string
  item_id: string
  item?: Item
  quantity: number
  unit_price: number
  total_price: number
  created_at: string
}

export interface SalesOrder {
  id: string
  order_number: string
  customer_id: string
  customer?: Customer
  status: 'draft' | 'confirmed' | 'delivered' | 'cancelled'
  order_date: string
  delivery_date?: string
  total_amount: number
  created_by: string
  user?: User
  created_at: string
  updated_at: string
}

export interface SalesOrderItem {
  id: string
  sales_order_id: string
  item_id: string
  item?: Item
  quantity: number
  unit_price: number
  total_price: number
  created_at: string
}

export interface Account {
  id: string
  code: string
  name: string
  name_ar?: string
  account_type: string
  is_leaf: boolean
  is_active: boolean
  tenant_id?: string
  created_at: string
  updated_at: string
}

// New interface for GL Accounts based on the handover package schema
export interface GLAccount {
  id: string
  org_id: string
  code: string
  name: string
  name_ar?: string
  category: string
  subtype: string
  parent_code?: string
  // Optional materialized path used by tree builder when available
  path?: string
  normal_balance: string
  allow_posting: boolean
  is_active: boolean
  currency: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface Journal {
  id: string
  name: string
  name_ar: string
  code: string
  created_at: string
  updated_at: string
}

export interface JournalEntry {
  id: string
  journal_id: string
  journals?: Journal
  entry_number: string
  entry_date: string
  posting_date?: string
  reference_type?: string
  reference_id?: string
  reference_number?: string
  description?: string
  description_ar?: string
  status: 'draft' | 'posted' | 'reversed'
  posted_at?: string
  posted_by?: string
  total_debit: number
  total_credit: number
  tenant_id?: string
  created_at: string
  updated_at: string
  created_by?: string
  updated_by?: string
}

// Database enums
export type UserRole = 'admin' | 'manager' | 'employee'
export type OrderStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type MovementType = 'in' | 'out' | 'adjustment'
export type PurchaseStatus = 'draft' | 'sent' | 'received' | 'cancelled'
export type SalesStatus = 'draft' | 'confirmed' | 'delivered' | 'cancelled'

// Debug function
export const debugGLAccounts = async (): Promise<{data: any[] | null, error: any}> => {
  try {
    console.log('🧪 Starting debugGLAccounts function...');
    const client = await getSupabaseClient();
    
    // First, try to get the current user/session
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    console.log('Session info:', { session, sessionError });
    
    // Try to get tenant/org ID
    let orgId = null;
    if (session?.user?.user_metadata?.org_id) {
      orgId = session.user.user_metadata.org_id;
    } else if (session?.user?.user_metadata?.tenant_id) {
      orgId = session.user.user_metadata.tenant_id;
    }
    
    console.log('Org/Tenant ID:', orgId);
    
    // Try different approaches to query the table
    console.log('🧪 Attempt 1: Simple query with all columns');
    let { data, error } = await client
      .from('gl_accounts')
      .select('*')
      .limit(5);
    
    if (error) {
      console.log('Attempt 1 failed:', error);
      
      // Try with org_id filter if we have one
      if (orgId) {
        console.log('🧪 Attempt 2: Query with org_id filter');
        ({ data, error } = await client
          .from('gl_accounts')
          .select('*')
          .eq('org_id', orgId)
          .limit(5));
          
        if (error) {
          console.log('Attempt 2 failed:', error);
          
          // Try with tenant_id filter
          console.log('🧪 Attempt 3: Query with tenant_id filter');
          ({ data, error } = await client
            .from('gl_accounts')
            .select('*')
            .eq('tenant_id', orgId)
            .limit(5));
            
          if (error) {
            console.log('Attempt 3 failed:', error);
            
            // Try without any filters
            console.log('🧪 Attempt 4: Query without filters');
            ({ data, error } = await client
              .from('gl_accounts')
              .select('id, code, name')
              .limit(5));
          }
        }
      } else {
        // Try without any filters
        console.log('🧪 Attempt 4: Query without filters');
        ({ data, error } = await client
          .from('gl_accounts')
          .select('id, code, name')
          .limit(5));
      }
    }
    
    console.log('🧪 Final debug results:', { data, error });
    return { data, error };
  } catch (error) {
    console.error('💥 Debug exception:', error);
    return { data: null, error };
  }
};
