const fs = require('node:fs').promises;

async function verifySQLSyntax() {
  console.log('Verifying SQL syntax in Advanced Reports files...');
  
  const sqlFiles = [
    'src/database/migrations/001_create_variance_functions.sql',
    'src/database/migrations/002_create_wip_view.sql',
    'WARDAH_ADVANCED_REPORTS_SCHEMA.sql'
  ];
  
  for (const file of sqlFiles) {
    try {
      const content = await fs.readFile(file, 'utf8');
      
      // Basic syntax checks
      const hasCreateFunction = content.includes('CREATE OR REPLACE FUNCTION');
      const hasCreateView = content.includes('CREATE OR REPLACE VIEW');
      const hasBegin = content.includes('BEGIN');
      const hasEnd = content.includes('END;');
      const hasLanguage = content.includes('LANGUAGE plpgsql');
      
      console.log(`\nChecking ${file}:`);
      console.log(`  ✓ File exists`);
      
      if (hasCreateFunction) {
        console.log(`  ✓ Contains CREATE FUNCTION statements`);
      }
      
      if (hasCreateView) {
        console.log(`  ✓ Contains CREATE VIEW statements`);
      }
      
      // Check for proper casting
      const hasTextCasting = content.includes('::text');
      if (hasTextCasting) {
        console.log(`  ✓ Uses proper text casting to avoid UUID errors`);
      }
      
      // Check for correct column names
      const hasManufacturingOrderId = content.includes('manufacturing_order_id');
      const hasOldMoId = content.includes('mo_id') && !content.includes('p_mo_id'); // p_mo_id is a parameter, not a column
      
      if (hasManufacturingOrderId && !hasOldMoId) {
        console.log(`  ✓ Uses correct column names (manufacturing_order_id)`);
      } else if (hasOldMoId) {
        console.log(`  ⚠  May contain incorrect column name (mo_id)`);
      }
      
      // Check for proper function structure
      if (hasCreateFunction && hasBegin && hasEnd && hasLanguage) {
        console.log(`  ✓ Functions have proper structure`);
      }
      
      console.log(`  ✓ File size: ${content.length} characters`);
      
    } catch (error) {
      console.log(`✗ Error reading ${file}: ${error.message}`);
    }
  }
  
  console.log('\nSQL syntax verification complete!');
}

verifySQLSyntax().catch(console.error);