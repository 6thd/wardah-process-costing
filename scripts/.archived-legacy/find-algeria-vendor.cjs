const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: require('path').join(__dirname, '.env') })

// ⚠️ SECURITY: Load Supabase configuration from environment variables
// Never hardcode API keys in source code!
// Note: This script uses SERVICE_KEY for admin operations
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR: Missing Supabase configuration!')
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file')
  console.error('See .env.example for reference')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function findAlgeriaVendor() {
  console.log('🔍 Searching for Algeria vendor...\n')

  try {
    // Search for vendors with "جزائر" in name
    const { data: vendors, error } = await supabase
      .from('vendors')
      .select('*')
      .ilike('name', '%جزائر%')

    if (error) throw error

    if (vendors.length === 0) {
      console.log('❌ No vendor found with "جزائر" in name')
      
      // Show all vendors
      console.log('\n📋 All vendors:')
      const { data: allVendors } = await supabase
        .from('vendors')
        .select('id, code, name')
        .order('code')

      allVendors.forEach(v => {
        console.log(`   ${v.code} - ${v.name}`)
        console.log(`      ID: ${v.id}`)
      })
    } else {
      console.log('✅ Found vendors with "جزائر":')
      vendors.forEach(v => {
        console.log(`   ${v.code} - ${v.name}`)
        console.log(`      ID: ${v.id}`)
      })

      // Check POs for each
      for (const vendor of vendors) {
        const { data: pos } = await supabase
          .from('purchase_orders')
          .select('order_number, status')
          .eq('vendor_id', vendor.id)

        console.log(`      POs: ${pos?.length || 0}`)
        if (pos && pos.length > 0) {
          pos.forEach(po => console.log(`         - ${po.order_number} (${po.status})`))
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

findAlgeriaVendor()
