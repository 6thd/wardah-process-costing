const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: require('node:path').join(__dirname, '.env') })

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

async function testVendorsCustomers() {
  console.log('🧪 Testing vendors and customers queries...\n')

  try {
    // Test vendors
    console.log('1️⃣ Testing vendors.code order...')
    const { data: vendors, error: vendorsError } = await supabase
      .from('vendors')
      .select('*')
      .order('code')
      .limit(3)
    
    if (vendorsError) {
      console.log('❌ Vendors error:', vendorsError.message)
    } else {
      console.log('✅ Vendors loaded:', vendors.length)
      if (vendors.length > 0) {
        console.log('   Sample:', vendors[0].code, '-', vendors[0].name)
      }
    }

    // Test customers
    console.log('\n2️⃣ Testing customers.code order...')
    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('*')
      .order('code')
      .limit(3)
    
    if (customersError) {
      console.log('❌ Customers error:', customersError.message)
    } else {
      console.log('✅ Customers loaded:', customers.length)
      if (customers.length > 0) {
        console.log('   Sample:', customers[0].code, '-', customers[0].name)
      }
    }

    // Test purchase orders with vendor name
    console.log('\n3️⃣ Testing purchase_orders with vendor.name...')
    const { data: pos, error: posError } = await supabase
      .from('purchase_orders')
      .select('order_number, vendor:vendors(name)')
      .limit(3)
    
    if (posError) {
      console.log('❌ Purchase orders error:', posError.message)
    } else {
      console.log('✅ Purchase orders loaded:', pos.length)
      if (pos.length > 0) {
        console.log('   Sample:', pos[0].order_number, '-', pos[0].vendor?.name)
      }
    }

    // Test sales invoices with customer name
    console.log('\n4️⃣ Testing sales_invoices with customer.name...')
    const { data: invoices, error: invoicesError } = await supabase
      .from('sales_invoices')
      .select('invoice_number, customer:customers(name)')
      .limit(3)
    
    if (invoicesError) {
      console.log('❌ Sales invoices error:', invoicesError.message)
    } else {
      console.log('✅ Sales invoices loaded:', invoices.length)
      if (invoices.length > 0) {
        console.log('   Sample:', invoices[0].invoice_number, '-', invoices[0].customer?.name)
      }
    }

    console.log('\n✅ All tests completed!')

  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

testVendorsCustomers()
