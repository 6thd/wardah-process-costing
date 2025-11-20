import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oobdeuhczdjmlfjkvdel.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vYmRldWhjemRqbWxmamt2ZGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzEzNTE1NjcsImV4cCI6MjA0NjkyNzU2N30.RwrRxCPzqQJkjDz_Sk5gww_Kw1r2uAaKzw-I58MR3Ww';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
  console.log('=== Checking Database ===\n');

  // 1. Check gl_entries
  const { data: entries, error: entriesError } = await supabase
    .from('gl_entries')
    .select('*')
    .limit(5);
  
  console.log('1. GL Entries:');
  if (entriesError) {
    console.error('   ❌ Error:', entriesError.message);
  } else {
    console.log(`   ✅ Found: ${entries?.length || 0} rows`);
    if (entries?.length) {
      console.log('   Sample:', {
        entry_number: entries[0].entry_number,
        entry_date: entries[0].entry_date,
        status: entries[0].status,
        total_debit: entries[0].total_debit,
        total_credit: entries[0].total_credit
      });
    }
  }

  // 2. Check gl_entry_lines
  const { data: lines, error: linesError } = await supabase
    .from('gl_entry_lines')
    .select('*')
    .limit(5);
  
  console.log('\n2. GL Entry Lines:');
  if (linesError) {
    console.error('   ❌ Error:', linesError.message);
  } else {
    console.log(`   ✅ Found: ${lines?.length || 0} rows`);
    if (lines?.length) {
      console.log('   Sample:', {
        account_code: lines[0].account_code,
        account_name: lines[0].account_name,
        debit_amount: lines[0].debit_amount,
        credit_amount: lines[0].credit_amount
      });
    }
  }

  // 3. Check purchase_orders
  const { data: pos, error: posError } = await supabase
    .from('purchase_orders')
    .select('*')
    .limit(5);
  
  console.log('\n3. Purchase Orders:');
  if (posError) {
    console.error('   ❌ Error:', posError.message);
  } else {
    console.log(`   ✅ Found: ${pos?.length || 0} rows`);
    if (pos?.length) {
      console.log('   Sample:', {
        order_number: pos[0].order_number,
        order_date: pos[0].order_date,
        status: pos[0].status,
        total_amount: pos[0].total_amount
      });
    }
  }

  // 4. Check sales_invoices
  const { data: invoices, error: invoicesError } = await supabase
    .from('sales_invoices')
    .select('*')
    .limit(5);
  
  console.log('\n4. Sales Invoices:');
  if (invoicesError) {
    console.error('   ❌ Error:', invoicesError.message);
  } else {
    console.log(`   ✅ Found: ${invoices?.length || 0} rows`);
    if (invoices?.length) {
      console.log('   Sample:', {
        invoice_number: invoices[0].invoice_number,
        invoice_date: invoices[0].invoice_date,
        status: invoices[0].status,
        total_amount: invoices[0].total_amount
      });
    }
  }

  // 5. Check products
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('*')
    .eq('product_code', 'pp500')
    .single();
  
  console.log('\n5. Product pp500:');
  if (productsError) {
    console.error('   ❌ Error:', productsError.message);
  } else if (products) {
    console.log('   ✅ Found:', {
      product_name: products.product_name,
      stock_quantity: products.stock_quantity,
      cost_price: products.cost_price
    });
  }

  console.log('\n=========================');
}

checkData().catch(console.error);
