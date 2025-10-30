/**
 * التحقق من حالة قاعدة البيانات
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('public/config.json', 'utf8'));
const SUPABASE_URL = config.SUPABASE_URL;
const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkDatabase() {
  console.log('🔍 فحص قاعدة البيانات...\n');
  
  // التحقق من الجداول
  const tables = [
    'organizations',
    'gl_accounts', 
    'gl_mappings',
    'products',
    'manufacturing_orders',
    'stock_quants'
  ];
  
  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`❌ ${table}: ${error.message}`);
      } else {
        console.log(`✅ ${table}: ${count} سجل`);
      }
    } catch (err) {
      console.log(`❌ ${table}: ${err.message}`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  
  // التحقق من المؤسسة
  console.log('\n📋 التحقق من مؤسسة Wardah...');
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single();
    
    if (error) {
      console.log(`❌ خطأ: ${error.message}`);
      console.log('💡 الحل: يجب إنشاء المؤسسة في SQL Editor:');
      console.log(`
INSERT INTO organizations (id, name, code, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'وردة البيان',
  'WARDAH',
  true
)
ON CONFLICT (id) DO NOTHING;
      `);
    } else if (data) {
      console.log(`✅ المؤسسة موجودة: ${data.name} (${data.code})`);
    } else {
      console.log('❌ المؤسسة غير موجودة');
    }
  } catch (err) {
    console.log(`❌ خطأ: ${err.message}`);
  }
}

checkDatabase().catch(console.error);
