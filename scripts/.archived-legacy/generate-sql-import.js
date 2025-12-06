import fs from 'fs';
import path from 'path';

// Organization ID (using the default one from the setup)
const ORG_ID = '00000000-0000-0000-0000-000000000001';

// Function to generate SQL for chart of accounts
function generateCOASQL() {
  try {
    // Read the JSON data
    const coaDataPath = path.join(process.cwd(), 'sql', 'wardah_implementation', 'coa_data.json');
    const coaData = JSON.parse(fs.readFileSync(coaDataPath, 'utf8'));
    
    console.log(`Generating SQL for ${coaData.length} chart of accounts records...`);
    
    // Generate SQL INSERT statements
    let sql = `-- Import Chart of Accounts\n`;
    sql += `SELECT import_chart_of_accounts('${ORG_ID}', '` + JSON.stringify(coaData).replace(/'/g, "''") + `'::JSONB);\n`;
    
    // Write to file
    const outputPath = path.join(process.cwd(), 'sql', 'wardah_implementation', 'import-coa-generated.sql');
    fs.writeFileSync(outputPath, sql);
    
    console.log(`✅ SQL generated successfully: ${outputPath}`);
    return coaData.length;
  } catch (error) {
    console.error('❌ Error generating COA SQL:', error);
    throw error;
  }
}

// Function to generate SQL for GL mappings
function generateMappingsSQL() {
  try {
    // Read the JSON data
    const mappingsDataPath = path.join(process.cwd(), 'sql', 'wardah_implementation', 'gl_mappings_data.json');
    const mappingsData = JSON.parse(fs.readFileSync(mappingsDataPath, 'utf8'));
    
    console.log(`Generating SQL for ${mappingsData.length} GL mappings records...`);
    
    // Generate SQL INSERT statements
    let sql = `-- Import GL Mappings\n`;
    sql += `SELECT import_gl_mappings('${ORG_ID}', '` + JSON.stringify(mappingsData).replace(/'/g, "''") + `'::JSONB);\n`;
    
    // Write to file
    const outputPath = path.join(process.cwd(), 'sql', 'wardah_implementation', 'import-mappings-generated.sql');
    fs.writeFileSync(outputPath, sql);
    
    console.log(`✅ SQL generated successfully: ${outputPath}`);
    return mappingsData.length;
  } catch (error) {
    console.error('❌ Error generating Mappings SQL:', error);
    throw error;
  }
}

// Main function
function main() {
  console.log('🔄 Generating SQL import scripts...');
  
  try {
    // Generate SQL for Chart of Accounts
    const coaCount = generateCOASQL();
    
    // Generate SQL for GL Mappings
    const mappingsCount = generateMappingsSQL();
    
    console.log('✅ All SQL scripts generated successfully!');
    console.log(`📊 Summary:`);
    console.log(`   - Chart of Accounts: ${coaCount} records`);
    console.log(`   - GL Mappings: ${mappingsCount} records`);
    console.log('');
    console.log('📋 Next steps:');
    console.log('1. Copy the contents of sql/wardah_implementation/import-coa-generated.sql');
    console.log('2. Paste it into the Supabase SQL Editor and run it');
    console.log('3. Copy the contents of sql/wardah_implementation/import-mappings-generated.sql');
    console.log('4. Paste it into the Supabase SQL Editor and run it');
    
  } catch (error) {
    console.error('❌ SQL generation failed:', error);
    process.exit(1);
  }
}

// Run the script
main();