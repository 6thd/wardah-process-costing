
import { createClient, type User, type SupabaseClient } from '@supabase/supabase-js';

// Re-export the User type for other modules
export type { User } from '@supabase/supabase-js';

// Singleton instance
const supabaseInstance: SupabaseClient | null = null;

// --- BEGIN NEW TYPE DEFINITIONS ---

export interface Item {
  id: string;
  name: string;
  description?: string;
  price: number;
  category_id: string;
  code: string;
  stock_quantity: number;
  cost_price: number;
  minimum_stock: number;
  unit: string;
  category?: Category;
  valuation_method?: string; // 'Weighted Average' | 'FIFO' | 'LIFO' | 'Moving Average'
}

export interface Category {
  id: string;
  name: string;
  name_ar?: string;
  description?: string;
}

export interface Customer {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    contact_person?: string;
    code?: string;
    address?: string;
}

export interface Supplier {
    id: string;
    name: string;
    name_ar?: string;
    contact_info?: string;
    contact_person?: string;
    phone?: string;
    email?: string;
    code?: string;
    address?: string;
}

export interface ManufacturingOrder {
    id: string;
    item_id: string;
    product_id?: string;
    quantity: number;
    status: 'pending' | 'in-progress' | 'completed' | 'draft' | 'confirmed' | 'cancelled' | 'on-hold' | 'quality-check';
    created_by?: string; 
    order_number?: string;
    product_name?: string;
    notes?: string;
    start_date?: string;
    due_date?: string;
    org_id?: string;
    created_at?: string;
    updated_at?: string;
}

export interface ProcessCost {
    id: string;
    mo_id: string;
    cost_category: string;
    amount: number;
    material_cost?: number;
    labor_cost?: number;
    overhead_cost?: number;
    manufacturing_order_id?: string; 
}

export interface PurchaseOrder {
    id: string;
    supplier_id: string;
    status: 'draft' | 'confirmed' | 'received' | 'cancelled' | 'pending' | 'fulfilled';
    total_amount: number;
    order_number: string;
    order_date: string;
    delivery_date?: string;
    supplier?: Supplier;
}

export interface SalesOrder {
    id: string;
    customer_id: string;
    status: 'pending' | 'shipped';
}

export interface PurchaseOrderItem {
    id: string;
    po_id: string;
    item_id: string;
    quantity: number;
    unit_price?: number; 
}

export interface SalesOrderItem {
    id: string;
    so_id: string;
    item_id: string;
    quantity: number;
    unit_price?: number; 
}

export interface GLAccount {
    id: string;
    code: string;
    name: string;
    name_ar?: string;
    name_en?: string;
    category?: string;
    normal_balance?: 'Debit' | 'Credit';
    allow_posting?: boolean;
    is_active?: boolean;
    children?: GLAccount[];
    parent_code?: string;
    org_id: string;
    parent_id: string | null;
}

// withOrgContext is deprecated - use explicit .eq('org_id', orgId) in queries instead
// Kept for backward compatibility only
export const withOrgContext = <T>(query: T): T => {
    // No-op: org_id filtering should be done explicitly in queries
    // This prevents the "placeholder" warning but doesn't modify queries
    return query;
};


// --- END NEW TYPE DEFINITIONS ---


// Use environment variables for Supabase config (Vite exposes these as import.meta.env)
// SECURITY: NEVER hard-code secrets in source code. Always use environment variables.
// ⚠️ In production, ALWAYS use environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)
// ⚠️ The leaked JWT token has been removed. Generate a new one from Supabase dashboard and set it as an environment variable.

// Priority: Environment variables ONLY (no hardcoded fallbacks for security)
const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

// Debug logging in development
if (import.meta.env?.DEV) {
  console.log('🔍 Environment check:', {
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseAnonKey,
    urlLength: supabaseUrl?.length || 0,
    keyLength: supabaseAnonKey?.length || 0,
    mode: import.meta.env?.MODE,
    isProd: import.meta.env?.PROD
  });
}

// Validate configuration
if (!supabaseUrl || !supabaseAnonKey) {
  const isProduction = import.meta.env?.PROD || import.meta.env?.MODE === 'production';
  const errorMsg = isProduction
    ? "❌ CRITICAL: Supabase configuration missing in production. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables. See .env.example for reference."
    : "❌ Supabase configuration missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables. Copy .env.example to .env and fill in your values. See docs/security/SECRETS_MANAGEMENT.md for details.";
  console.error(errorMsg);
  // Only throw in actual production builds, not in dev mode
  if (isProduction && import.meta.env?.MODE === 'production') {
    throw new Error(errorMsg);
  }
}

// Create client immediately (synchronous)
// SECURITY: Do not use fallback values - fail fast if environment variables are missing
export const supabase: SupabaseClient = createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);

/**
 * Returns the Supabase client instance (synchronous).
 */
export const getSupabase = (): SupabaseClient => {
  return supabase;
};

/**
 * Legacy async version for backward compatibility
 */
export const getSupabaseAsync = async (): Promise<SupabaseClient> => {
  return supabase;
};

/**
 * A simple diagnostic function to check the Supabase connection.
 */
export const checkSupabaseConnection = async () => {
    try {
        const { error } = await supabase.from('gl_accounts').select('id').limit(1);

        if (error && error.code !== '42P01') { 
            console.error("Supabase connection check failed with an unexpected error:", error);
            return { status: 'error', message: error.message };
        }
        
        console.log("Supabase connection appears to be working.");
        return { status: 'ok', message: 'Supabase connection is active.' };
    } catch (e: any) {
        console.error("An exception occurred while checking Supabase connection:", e.message);
        return { status: 'error', message: e.message };
    }
};


/**
 * ============================================================================
 * Application-Specific Data Fetching Functions
 * ============================================================================
 */


/**
 * Fetches all GL accounts across all organizations.
 */
export const getAllGLAccounts = async (): Promise<GLAccount[]> => {
    console.log("Fetching all GL accounts.");

    try {
        const { data, error } = await supabase
            .from('gl_accounts')
            .select('*')
            .order('code', { ascending: true });

        if (error) {
            console.error("Error fetching all GL accounts:", error);
            throw error;
        }

        console.log(`Successfully fetched ${data?.length || 0} accounts.`);
        return data || [];
        
    } catch (err) {
        console.error("An unexpected exception occurred in getAllGLAccounts:", err);
        throw new Error("A critical error occurred while fetching account data.");
    }
};

/**
 * Fetches the chart of accounts for a given organization.
 */
export const getChartOfAccounts = async (orgId: string): Promise<GLAccount[]> => {
    console.log(`Fetching chart of accounts for org_id: ${orgId}`);
    
    if (!orgId || typeof orgId !== 'string') {
        console.error("Invalid orgId provided to getChartOfAccounts.");
        throw new Error("A valid organization ID is required to fetch accounts.");
    }

    try {
        const { data, error } = await supabase
            .from('gl_accounts')
            .select('*')
            .eq('org_id', orgId)
            .order('code', { ascending: true })
            .limit(2000); 

        if (error) {
            if (error.message.includes('relation "gl_accounts" does not exist')) {
                 console.error("Critical Error: The table 'gl_accounts' was not found. Check permissions and RLS policies.", error);
                 throw new Error("The accounts table could not be accessed. Please contact support.");
            }
            console.error("Error fetching GL accounts:", error);
            throw error;
        }

        console.log(`Successfully fetched ${data?.length || 0} accounts.`);
        return data || [];
        
    } catch (err) {
        console.error("An unexpected exception occurred in getChartOfAccounts:", err);
        throw new Error("A critical error occurred while fetching account data.");
    }
};

/**
 * Fetches a single GL account by its ID.
 */
export const getAccountById = async (accountId: string): Promise<GLAccount | null> => {
    if (!accountId) {
        console.warn("getAccountById called with a null or undefined accountId.");
        return null;
    }

    try {
        const { data, error } = await supabase
            .from('gl_accounts')
            .select('*')
            .eq('id', accountId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                console.log(`Account with ID ${accountId} not found.`);
                return null;
            }
            console.error(`Error fetching account ${accountId}:`, error);
            throw error;
        }
        
        return data;
    } catch (err) {
        console.error(`Unexpected exception in getAccountById for ID ${accountId}:`, err);
        throw new Error("An error occurred while fetching the specific account.");
    }
};

export const queryGLAccounts = async (query: string): Promise<GLAccount[]> => {
    const { data, error } = await supabase.from('gl_accounts').select().textSearch('name', query);
    if (error) {
        console.error('Error querying GL accounts:', error);
        return [];
    }
    return data || [];
};

export const getAccountHierarchy = async (): Promise<any[]> => {
    const { data, error } = await supabase.rpc('get_account_hierarchy');
    if (error) {
        console.error('Error fetching account hierarchy:', error);
        return [];
    }
    return data || [];
};

export const getAccountChildren = async (parentId: string): Promise<any[]> => {
    const { data, error } = await supabase.rpc('get_account_children', { parent_id: parentId });
    if (error) {
        console.error('Error fetching account children:', error);
        return [];
    }
    return data || [];
};

export const debugGLAccounts = async () => {
    const { data, error } = await supabase.from('gl_accounts').select('*').limit(10);
    console.log('Debug GL Accounts:', data, error);
};

// ===================================================================
// GL ACCOUNT CRUD OPERATIONS
// عمليات إدارة دليل الحسابات
// ===================================================================

export interface CreateGLAccountInput {
    code: string;
    name: string;
    name_ar?: string;
    name_en?: string;
    account_type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
    subtype?: string;
    parent_id?: string | null;
    description?: string;
    is_active?: boolean;
    opening_balance?: number;
    opening_balance_type?: 'DEBIT' | 'CREDIT';
}

export interface UpdateGLAccountInput extends Partial<CreateGLAccountInput> {
    id: string;
}

/**
 * Create new GL Account
 * إنشاء حساب جديد في دليل الحسابات
 */
export const createGLAccount = async (input: CreateGLAccountInput): Promise<{ success: boolean; data?: GLAccount; error?: string }> => {
    try {
        const orgId = await getEffectiveTenantId();
        if (!orgId) throw new Error('Organization ID not found');

        // Prepare account data
        const accountData = {
            org_id: orgId,
            code: input.code,
            name: input.name,
            name_ar: input.name_ar || input.name,
            name_en: input.name_en || input.name,
            account_type: input.account_type,
            subtype: input.subtype,
            parent_id: input.parent_id || null,
            description: input.description,
            is_active: input.is_active !== false,
            opening_balance: input.opening_balance || 0,
            opening_balance_type: input.opening_balance_type || 'DEBIT',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('gl_accounts')
            .insert(accountData)
            .select()
            .single();

        if (error) throw error;

        return { success: true, data };
    } catch (error: any) {
        console.error('Error creating GL account:', error);
        return { success: false, error: error.message || 'Failed to create account' };
    }
};

/**
 * Update existing GL Account
 * تحديث حساب موجود
 */
export const updateGLAccount = async (input: UpdateGLAccountInput): Promise<{ success: boolean; data?: GLAccount; error?: string }> => {
    try {
        const { id, ...updates } = input;
        
        const updateData: any = {
            ...updates,
            updated_at: new Date().toISOString()
        };

        // Remove undefined values
        Object.keys(updateData).forEach(key => {
            if (updateData[key] === undefined) {
                delete updateData[key];
            }
        });

        const { data, error } = await supabase
            .from('gl_accounts')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return { success: true, data };
    } catch (error: any) {
        console.error('Error updating GL account:', error);
        return { success: false, error: error.message || 'Failed to update account' };
    }
};

/**
 * Delete GL Account (soft delete - set is_active to false)
 * حذف حساب (حذف ناعم - تعطيل الحساب)
 */
export const deleteGLAccount = async (id: string): Promise<{ success: boolean; error?: string }> => {
    try {
        // Check if account has children
        const { data: children } = await supabase
            .from('gl_accounts')
            .select('id')
            .eq('parent_id', id)
            .limit(1);

        if (children && children.length > 0) {
            return { success: false, error: 'Cannot delete account with child accounts' };
        }

        // Check if account has transactions
        const { data: transactions } = await supabase
            .from('journal_entry_lines')
            .select('id')
            .eq('account_id', id)
            .limit(1);

        if (transactions && transactions.length > 0) {
            // If has transactions, only deactivate
            const { error } = await supabase
                .from('gl_accounts')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;
            
            return { success: true };
        }

        // If no transactions, can safely delete
        const { error } = await supabase
            .from('gl_accounts')
            .delete()
            .eq('id', id);

        if (error) throw error;

        return { success: true };
    } catch (error: any) {
        console.error('Error deleting GL account:', error);
        return { success: false, error: error.message || 'Failed to delete account' };
    }
};

/**
 * Get GL Account by ID
 * الحصول على حساب محدد
 */
export const getGLAccountById = async (id: string): Promise<GLAccount | null> => {
    try {
        const { data, error } = await supabase
            .from('gl_accounts')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error fetching GL account:', error);
        return null;
    }
};

/**
 * Check if account code exists
 * التحقق من وجود رمز الحساب
 */
export const checkAccountCodeExists = async (code: string, excludeId?: string): Promise<boolean> => {
    try {
        const orgId = await getEffectiveTenantId();
        let query = supabase
            .from('gl_accounts')
            .select('id')
            .eq('org_id', orgId)
            .eq('code', code);

        if (excludeId) {
            query = query.neq('id', excludeId);
        }

        const { data, error } = await query.limit(1);

        if (error) throw error;
        return (data && data.length > 0);
    } catch (error) {
        console.error('Error checking account code:', error);
        return false;
    }
};

export const getTenantId = async (): Promise<string | null> => {
    try {
        // ✅ Use org_id instead of tenant_id (this project uses organizations)
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;
        
        // Get user's organization
        const { data, error } = await supabase
            .from('user_organizations')
            .select('org_id')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .single();
            
        if (error) {
            console.error('Error fetching org ID:', error);
            return null;
        }
        return data?.org_id || null;
    } catch (error) {
        console.error('Unexpected error fetching org ID:', error);
        return null;
    }
};

export const getEffectiveTenantId = async (): Promise<string | null> => {
    try {
        // ✅ Reuse getTenantId - they're the same in this project
        return await getTenantId();
    } catch (error) {
        console.error('Unexpected error fetching effective org ID:', error);
        return null;
    }
};
