// test-accounts.ts
// Simple test script to check account retrieval

import { getAllGLAccounts } from './src/lib/supabase';

async function testAccountRetrieval() {
  console.log('🧪 Testing account retrieval...');
  
  try {
    const accounts = await getAllGLAccounts();
    console.log('✅ Retrieved accounts:', accounts.length);
    console.log('📝 First 5 accounts:', accounts.slice(0, 5));
    
    if (accounts.length === 0) {
      console.log('⚠️ No accounts retrieved. This might indicate:');
      console.log('  1. No accounts exist in the database');
      console.log('  2. Authentication issue (no valid org_id)');
      console.log('  3. Database configuration issue');
      console.log('  4. Network connectivity issue');
    }
    
    return accounts;
  } catch (error) {
    console.error('❌ Error retrieving accounts:', error);
    return [];
  }
}

// Run the test
testAccountRetrieval();

export { testAccountRetrieval };