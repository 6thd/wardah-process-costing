
import { createClient, type User, type SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from './config';

// Re-export the User type for other modules
export type { User };

// Singleton instance
let supabaseInstance: SupabaseClient | null = null;

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
    quantity: number;
    status: 'pending' | 'in-progress' | 'completed' | 'draft' | 'confirmed';
    created_by?: string; 
    order_number?: string;
    product_name?: string;
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

export const withOrgContext = <T,>(query: T): T => {
    // This is a placeholder function.
    console.log('withOrgContext called, but it is a placeholder.');
    return query;
};


// --- END NEW TYPE DEFINITIONS ---


// Ensure this file is imported only on the client-side
if (typeof window === 'undefined') {
  throw new Error('Supabase client should only be used on the client-side.');
}

const config = await loadConfig();

const supabaseUrl = config.SUPABASE_URL;
const supabaseAnonKey = config.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Supabase URL or Anon Key is missing. Please check your environment variables or config.json.");
  throw new Error("Supabase configuration is incomplete.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
});

/**
 * Returns the Supabase client instance (synchronous).
 */
export const getSupabase = () => {
    return supabase;
};

/**
 * Legacy async version for backward compatibility
 */
export const getSupabaseAsync = async () => {
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
