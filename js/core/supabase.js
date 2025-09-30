import { loadConfig } from './config.js';

let client;

/**
 * Initialize and get Supabase client (singleton)
 */
export async function getSupabase() {
  if (client) return client;
  
  try {
    const cfg = await loadConfig();
    
    if (!window.supabase?.createClient) {
      throw new Error('Supabase library not loaded. Make sure to include Supabase CDN script.');
    }
    
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    console.log('✅ Supabase client initialized');
    return client;
  } catch (error) {
    console.error('Supabase initialization error:', error);
    throw error;
  }
}

/**
 * Test Supabase connection
 */
export async function testConnection() {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.from('items').select('count').limit(1);
    if (error) throw error;
    console.log('✅ Supabase connection test successful');
    return true;
  } catch (error) {
    console.error('❌ Supabase connection test failed:', error);
    return false;
  }
}