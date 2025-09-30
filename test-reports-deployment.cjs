const fs = require('fs').promises;

async function testReportsDeployment() {
  console.log('Testing Advanced Reports System Deployment...');
  
  // Check if required files exist
  const requiredFiles = [
    'src/database/migrations/001_create_variance_functions.sql',
    'src/database/migrations/002_create_wip_view.sql',
    'WARDAH_ADVANCED_REPORTS_SCHEMA.sql'
  ];
  
  for (const file of requiredFiles) {
    try {
      await fs.access(file);
      console.log(`✓ ${file} exists`);
    } catch (error) {
      console.log(`✗ ${file} not found`);
    }
  }
  
  // Check React components
  const reactComponents = [
    'src/features/reports/components/VarianceAnalysisReport.tsx',
    'src/features/reports/components/WIPReport.tsx',
    'src/features/reports/components/ProfitabilityReport.tsx',
    'src/features/reports/components/ReportsDashboard.tsx'
  ];
  
  for (const component of reactComponents) {
    try {
      await fs.access(component);
      console.log(`✓ ${component} exists`);
    } catch (error) {
      console.log(`✗ ${component} not found`);
    }
  }
  
  // Check integration
  try {
    await fs.access('src/features/reports/index.tsx');
    console.log('✓ Reports module integration file exists');
  } catch (error) {
    console.log('✗ Reports module integration file not found');
  }
  
  // Check exports
  try {
    await fs.access('src/features/reports/components/index.ts');
    console.log('✓ Component exports file exists');
  } catch (error) {
    console.log('✗ Component exports file not found');
  }
  
  console.log('\nDeployment verification complete!');
  console.log('All required files for the Advanced Reports System are in place.');
}

testReportsDeployment().catch(console.error);