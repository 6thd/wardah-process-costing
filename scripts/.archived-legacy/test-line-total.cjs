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

async function testInsert() {
  console.log('🧪 Testing line_total columns...\n')

  try {
    // Test purchase_order_lines
    console.log('1️⃣ Testing purchase_order_lines without line_total...')
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('id')
      .limit(1)
      .single()

    if (po && !poError) {
      const { error } = await supabase
        .from('purchase_order_lines')
        .insert({
          org_id: '00000000-0000-0000-0000-000000000001',
          purchase_order_id: po.id,
          line_number: 999,
          product_id: '00000000-0000-0000-0000-000000000001',
          quantity: 1,
          unit_price: 100,
          discount_percentage: 0,
          tax_percentage: 15
        })
        .select()

      if (error) {
        console.log('❌ Error:', error.message)
      } else {
        console.log('✅ Purchase order line inserted successfully')
        // Clean up
        await supabase
          .from('purchase_order_lines')
          .delete()
          .eq('line_number', 999)
      }
    }

    // Test sales_invoice_lines
    console.log('\n2️⃣ Testing sales_invoice_lines without line_total...')
    const { data: invoice, error: invError } = await supabase
      .from('sales_invoices')
      .select('id')
      .limit(1)
      .single()

    if (invoice && !invError) {
      const { error } = await supabase
        .from('sales_invoice_lines')
        .insert({
          org_id: '00000000-0000-0000-0000-000000000001',
          invoice_id: invoice.id,
          line_number: 999,
          product_id: '00000000-0000-0000-0000-000000000001',
          quantity: 1,
          unit_price: 100,
          discount_percentage: 0,
          tax_rate: 15
        })
        .select()

      if (error) {
        console.log('❌ Error:', error.message)
      } else {
        console.log('✅ Sales invoice line inserted successfully')
        // Clean up
        await supabase
          .from('sales_invoice_lines')
          .delete()
          .eq('line_number', 999)
      }
    }

    // Test supplier_invoice_lines
    console.log('\n3️⃣ Testing supplier_invoice_lines without line_total...')
    const { data: suppInv, error: suppError } = await supabase
      .from('supplier_invoices')
      .select('id')
      .limit(1)
      .single()

    if (suppInv && !suppError) {
      const { error } = await supabase
        .from('supplier_invoice_lines')
        .insert({
          invoice_id: suppInv.id,
          product_id: '00000000-0000-0000-0000-000000000001',
          quantity: 1,
          unit_price: 100,
          discount_amount: 0,
          tax_amount: 15
        })
        .select()

      if (error) {
        console.log('❌ Error:', error.message)
      } else {
        console.log('✅ Supplier invoice line inserted successfully')
        // Clean up
        await supabase
          .from('supplier_invoice_lines')
          .delete()
          .eq('product_id', '00000000-0000-0000-0000-000000000001')
          .eq('quantity', 1)
      }
    } else {
      console.log('⚠️ No supplier invoices found to test')
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

testInsert()
