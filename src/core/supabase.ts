/**
 * Supabase Client with Dynamic Configuration and Security
 * Zero-hardcode approach using secure config management
 */

// Re-export from lib/supabase.ts to prevent duplicate instances
export { 
  supabase, 
  getSupabase
} from '@/lib/supabase'

// Re-export functions that exist in lib/supabase.ts
export { 
  getTenantId
} from '@/lib/supabase'

// Export types
export type { User } from '@/lib/supabase'