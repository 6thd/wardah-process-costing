const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

async function findCategoryItems() {
  console.log('🔍 البحث عن عناصر الفئات في جدول المنتجات...\n');

  try {
    // Get all products
    const { data: allProducts, error } = await supabase
      .from('products')
      .select('id, code, name, name_ar, category_id')
      .order('name');

    if (error) {
      console.error('❌ خطأ:', error.message);
      return;
    }

    console.log(`📊 إجمالي المنتجات: ${allProducts.length}\n`);

    // Get all categories
    const { data: categories, error: catError } = await supabase
      .from('categories')
      .select('*')
      .order('name');

    if (catError) {
      console.error('❌ خطأ في تحميل الفئات:', catError.message);
      return;
    }

    console.log(`📁 إجمالي الفئات: ${categories.length}\n`);

    // Find products that look like categories
    console.log('=== المنتجات التي تشبه الفئات ===\n');
    
    const suspiciousPatterns = [
      /All \//i,
      /\(\d+\)$/,  // ends with (number)
      /^Raw Materials?$/i,
      /^Finished Goods?$/i,
      /^Packaging$/i,
    ];

    const suspiciousProducts = allProducts.filter(p => {
      return suspiciousPatterns.some(pattern => pattern.test(p.name));
    });

    console.log(`🚨 وجدنا ${suspiciousProducts.length} منتج يشبه فئة:\n`);
    suspiciousProducts.forEach(p => {
      console.log(`  - [${p.code}] ${p.name}`);
      if (p.name_ar) console.log(`    عربي: ${p.name_ar}`);
      console.log(`    Category ID: ${p.category_id}`);
      console.log('');
    });

    // Show category names for reference
    console.log('\n=== أسماء الفئات الحقيقية ===\n');
    categories.forEach(cat => {
      console.log(`  - ${cat.name} (${cat.name_ar || 'N/A'})`);
    });

    // Find products that match category names exactly
    console.log('\n=== منتجات بنفس أسماء الفئات ===\n');
    
    const categoryNames = categories.map(c => c.name.toLowerCase());
    const matchingProducts = allProducts.filter(p => 
      categoryNames.includes(p.name.toLowerCase())
    );

    if (matchingProducts.length > 0) {
      console.log(`⚠️  وجدنا ${matchingProducts.length} منتج بنفس أسماء الفئات:\n`);
      matchingProducts.forEach(p => {
        console.log(`  - ${p.name} (ID: ${p.id})`);
      });
    } else {
      console.log('✅ لا يوجد منتجات بنفس أسماء الفئات تماماً');
    }

  } catch (error) {
    console.error('❌ خطأ عام:', error.message);
  }
}

findCategoryItems();
