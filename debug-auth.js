// Debug script to test Supabase connection and users table
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://uutfztmqvajmsxnrqeiv.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dGZ6dG1xdmFqbXN4bnJxZWl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwOTkzODAsImV4cCI6MjA3MjY3NTM4MH0.1HmcLbScl7oIwICL4WXq3_6WuDDE_1gwsz2eoRlAV7c'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function debugAuth() {
  console.log('🔍 Testing Supabase connection...')
  
  // Test 1: Check connection
  try {
    const { data, error } = await supabase.from('users').select('count').single()
    console.log('✅ Connection successful')
    console.log('📊 Users table exists:', !error)
  } catch (err) {
    console.log('❌ Connection or users table error:', err.message)
  }
  
  // Test 2: Check auth users
  try {
    const { data: authData } = await supabase.auth.getSession()
    console.log('🔐 Current session:', authData.session ? 'Active' : 'None')
  } catch (err) {
    console.log('❌ Auth session error:', err.message)
  }
  
  // Test 3: Try to fetch all users
  try {
    const { data, error } = await supabase.from('users').select('*').limit(5)
    if (error) throw error
    console.log('👥 Users in database:', data?.length || 0)
    console.log('📝 Sample user structure:', data?.[0] || 'No users found')
  } catch (err) {
    console.log('❌ Users table query error:', err.message)
  }
}

debugAuth()