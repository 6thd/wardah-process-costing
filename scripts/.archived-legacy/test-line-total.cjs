const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://uutfztmqvajmsxnrqeiv.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dGZ6dG1xdmFqbXN4bnJxZWl2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzA5OTM4MCwiZXhwIjoyMDcyNjc1MzgwfQ.le_6nb8rO8_WvBqP_BXycSP79MURAaNVSkHAkxZ-0gM'

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
