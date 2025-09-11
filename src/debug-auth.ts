// Debug authentication issues
import { supabase } from './lib/supabase'

export async function debugAuthentication() {
  console.log('🔍 Starting authentication debug...')
  
  // Test 1: Check Supabase connection
  try {
    console.log('📡 Testing Supabase connection...')
    const { data, error } = await supabase.from('users').select('count').limit(1)
    if (error) {
      console.log('❌ Users table error:', error.message)
      console.log('📋 Error details:', error)
    } else {
      console.log('✅ Supabase connection successful')
    }
  } catch (err) {
    console.log('❌ Connection failed:', err)
  }
  
  // Test 2: Check current session
  try {
    console.log('🔐 Checking current session...')
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) {
      console.log('❌ Session error:', error.message)
    } else {
      console.log('👤 Current session user:', session?.user?.email || 'None')
    }
  } catch (err) {
    console.log('❌ Session check failed:', err)
  }
  
  // Test 3: Try demo login
  try {
    console.log('🧪 Testing demo login...')
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'admin@wardah.sa',
      password: 'admin123'
    })
    
    if (error) {
      console.log('❌ Demo login failed:', error.message)
      console.log('📋 Error code:', error.status)
      console.log('📋 Full error:', error)
    } else {
      console.log('✅ Demo login successful')
      console.log('👤 User:', data.user?.email)
      
      // Now test users table query
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user?.id)
        .single()
        
      if (profileError) {
        console.log('❌ Users table query failed:', profileError.message)
        console.log('📋 Profile error details:', profileError)
      } else {
        console.log('✅ User profile found:', profile)
      }
    }
  } catch (err) {
    console.log('❌ Demo login test failed:', err)
  }
  
  console.log('🏁 Debug complete')
}

// Auto-run debug when imported
if (typeof window !== 'undefined') {
  debugAuthentication()
}