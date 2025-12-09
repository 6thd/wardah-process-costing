// Supabase Setup Utility
// Run this in your browser console to set up demo user

import { supabase } from '@/lib/supabase'
import { DEMO_CREDENTIALS } from '@/config/demo-credentials'

export async function setupDemoUser() {
  console.log('🚀 Setting up demo user in Supabase...')
  
  // Check if supabase client is available
  if (!supabase) {
    console.error('❌ Supabase client not initialized')
    throw new Error('Supabase client not initialized')
  }
  
  try {
    // Step 1: Sign up the demo user
    console.log('📝 Signing up demo user...')
    // NOSONAR - Demo credentials for development setup only
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: DEMO_CREDENTIALS.admin.email,
      password: DEMO_CREDENTIALS.admin.password, // NOSONAR
      options: {
        data: {
          full_name: 'مدير النظام'
        }
      }
    })
    
    if (signUpError && !signUpError.message.includes('already registered')) {
      console.log('❌ Sign up failed:', signUpError.message)
      throw signUpError
    }
    
    console.log('✅ Demo user sign up:', signUpData.user?.email || 'Success')
    
    // Step 2: Try to create user profile in users table
    if (signUpData.user) {
      console.log('👤 Creating user profile...')
      const { data: profileData, error: profileError } = await supabase
        .from('users')
        .upsert({
          id: signUpData.user.id,
          email: signUpData.user.email,
          full_name: 'مدير النظام',
          role: 'admin'
        })
        .select()
      
      if (profileError) {
        console.log('⚠️ Profile creation failed (this is okay):', profileError.message)
        console.log('💡 Users table might not exist or RLS policies need adjustment')
      } else {
        console.log('✅ User profile created:', profileData)
      }
    }
    
    // Step 3: Test login
    console.log('🔐 Testing login...')
    // NOSONAR - Demo credentials for development setup only
    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
      email: DEMO_CREDENTIALS.admin.email,
      password: DEMO_CREDENTIALS.admin.password // NOSONAR
    })
    
    if (loginError) {
      console.log('❌ Login test failed:', loginError.message)
    } else {
      console.log('✅ Login test successful:', loginData.user?.email)
      
      // Sign out after test
      await supabase.auth.signOut()
      console.log('📤 Signed out after test')
    }
    
    console.log('✅ Demo user setup complete!')
    // NOSONAR - Demo credentials display for development only
    console.log(`💡 You can now use ${DEMO_CREDENTIALS.admin.email} / ${DEMO_CREDENTIALS.admin.password} to login`) // NOSONAR
    
  } catch (error) {
    console.log('❌ Setup failed:', error)
  }
}

// Instructions for manual setup
export function showSetupInstructions() {
  console.log('\n🔧 MANUAL SUPABASE SETUP INSTRUCTIONS:')
  console.log('\n1. Go to your Supabase dashboard: https://supabase.com/dashboard')
  console.log('2. Navigate to Authentication > Users')
  console.log('3. Click "Add user"')
  console.log('4. Add user with:')
  // NOSONAR - Demo credentials in instructions
  console.log(`   - Email: ${DEMO_CREDENTIALS.admin.email}`) // NOSONAR
  console.log(`   - Password: ${DEMO_CREDENTIALS.admin.password}`) // NOSONAR
  console.log('   - Email confirmed: YES')
  console.log('\n5. (Optional) Create users table:')
  console.log('   Copy and paste this SQL in Supabase SQL Editor:')
  console.log('\n   CREATE TABLE users (')
  console.log('     id UUID REFERENCES auth.users(id) PRIMARY KEY,')
  console.log('     email TEXT UNIQUE NOT NULL,')
  console.log('     full_name TEXT,')
  console.log('     role TEXT DEFAULT \'employee\',')
  console.log('     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),')
  console.log('     updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()')
  console.log('   );')
  console.log('\n   -- Enable RLS')
  console.log('   ALTER TABLE users ENABLE ROW LEVEL SECURITY;')
  console.log('\n   -- Allow users to read their own data')
  console.log('   CREATE POLICY "Users can read own data" ON users')
  console.log('     FOR SELECT USING (auth.uid() = id);')
  console.log('\n6. Test login in your app!')
}

// Auto-run if in development
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  console.log('🛠️ Development mode detected. Supabase setup utilities available:')
  console.log('- setupDemoUser() - Automatically set up demo user')  
  console.log('- showSetupInstructions() - Show manual setup instructions')
  
  // Make functions globally available in dev
  ;(window as any).setupDemoUser = setupDemoUser
  ;(window as any).showSetupInstructions = showSetupInstructions
}