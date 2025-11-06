const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load config
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

async function importRawMaterials() {
  try {
    console.log('📖 Reading Raw Materials.xlsx...');
    
    // Read the Excel file
    const workbook = XLSX.readFile('Raw Materials.xlsx');
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(sheet);
    
    console.log(`✅ Found ${data.length} raw materials in Excel file`);
    console.log('Sample row:', data[0]);
    
    // First, get the "Raw Materials" category ID
    const { data: categories, error: catError } = await supabase
      .from('categories')
      .select('id, name, name_ar')
      .or('name.eq.Raw Materials,name_ar.eq.مواد خام');
    
    if (catError) {
      console.error('❌ Error fetching category:', catError);
      return;
    }
    
    let rawMaterialsCategoryId;
    
    if (categories && categories.length > 0) {
      rawMaterialsCategoryId = categories[0].id;
      console.log(`✅ Found Raw Materials category: ${categories[0].name} (${categories[0].id})`);
    } else {
      // Create the category if it doesn't exist
      console.log('📝 Creating Raw Materials category...');
      const { data: newCat, error: createError } = await supabase
        .from('categories')
        .insert({ name: 'Raw Materials', name_ar: 'مواد خام' })
        .select()
        .single();
      
      if (createError) {
        console.error('❌ Error creating category:', createError);
        return;
      }
      
      rawMaterialsCategoryId = newCat.id;
      console.log(`✅ Created Raw Materials category: ${newCat.id}`);
    }
    
    // Prepare products for insertion
    const products = data.map((row, index) => {
      // Handle different possible column names
      const code = row['Code'] || row['code'] || row['كود'] || row['رمز المنتج'] || `RM-${String(index + 1).padStart(3, '0')}`;
      const name = row['Name'] || row['name'] || row['Product Name'] || row['اسم المنتج'] || row['الاسم'];
      const name_ar = row['Name Arabic'] || row['name_ar'] || row['الاسم بالعربية'] || row['اسم المنتج'] || name;
      const unit = row['Unit'] || row['unit'] || row['الوحدة'] || row['وحدة القياس'] || 'كجم';
      const cost_price = parseFloat(row['Cost'] || row['cost_price'] || row['التكلفة'] || row['سعر التكلفة'] || 0);
      const selling_price = parseFloat(row['Price'] || row['selling_price'] || row['السعر'] || row['سعر البيع'] || cost_price * 1.2);
      const stock_quantity = parseInt(row['Stock'] || row['stock_quantity'] || row['المخزون'] || row['الكمية'] || 0);
      const minimum_stock = parseInt(row['Min Stock'] || row['minimum_stock'] || row['الحد الأدنى'] || 50);
      const description = row['Description'] || row['description'] || row['الوصف'] || '';
      
      return {
        code,
        name,
        name_ar,
        category_id: rawMaterialsCategoryId,
        unit,
        cost_price,
        selling_price,
        stock_quantity,
        minimum_stock,
        description,
        price: selling_price // For backward compatibility
      };
    });
    
    console.log('\n📦 Importing raw materials...');
    console.log('Sample product:', products[0]);
    
    // Get existing product codes
    const { data: existingProducts } = await supabase
      .from('products')
      .select('code');
    
    const existingCodes = new Set(existingProducts?.map(p => p.code) || []);
    
    // Filter out products that already exist
    const newProducts = products.filter(p => !existingCodes.has(p.code));
    
    console.log(`⚠️  ${products.length - newProducts.length} products already exist and will be skipped`);
    console.log(`📝 ${newProducts.length} new products to import`);
    
    // Insert products in batches
    const batchSize = 50;
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < newProducts.length; i += batchSize) {
      const batch = newProducts.slice(i, i + batchSize);
      
      const { data: inserted, error: insertError } = await supabase
        .from('products')
        .insert(batch)
        .select();
      
      if (insertError) {
        console.error(`❌ Error inserting batch ${Math.floor(i / batchSize) + 1}:`, insertError.message);
        errorCount += batch.length;
      } else {
        successCount += inserted.length;
        console.log(`✅ Inserted batch ${Math.floor(i / batchSize) + 1}: ${inserted.length} products`);
      }
    }
    
    console.log('\n📊 Import Summary:');
    console.log(`✅ Successfully imported: ${successCount} raw materials`);
    console.log(`❌ Failed: ${errorCount} products`);
    console.log(`⚠️  Skipped (already exist): ${products.length - newProducts.length} products`);
    console.log(`📦 Total processed: ${products.length} products`);
    
    // Verify the import
    const { data: allProducts, error: verifyError } = await supabase
      .from('products')
      .select('id, code, name, name_ar, category_id')
      .eq('category_id', rawMaterialsCategoryId);
    
    if (!verifyError && allProducts) {
      console.log(`\n✅ Verification: ${allProducts.length} raw materials in database`);
      console.log('\nSample imported raw materials:');
      allProducts.slice(0, 10).forEach(p => {
        console.log(`  - ${p.code}: ${p.name_ar || p.name}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Import failed:', error);
  }
}

// Run the import
importRawMaterials();
