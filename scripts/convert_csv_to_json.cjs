const fs = require('fs');
const path = require('path');

// Function to parse CSV data
function parseCSV(csvData) {
  const lines = csvData.trim().split('\n');
  const headers = lines[0].split(',').map(header => header.trim().replace(/^\uFEFF/, '')); // Remove BOM if present
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    
    for (let j = 0; j < headers.length; j++) {
      // Remove quotes if present
      let value = values[j] ? values[j].trim() : '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      row[headers[j]] = value;
    }
    
    rows.push(row);
  }
  
  return rows;
}

// Convert Chart of Accounts CSV to JSON
function convertCOA() {
  const coaCSVPath = path.join(__dirname, '..', 'wardah_erp_handover', 'wardah_enhanced_coa.csv');
  const coaJSONPath = path.join(__dirname, '..', 'sql', 'wardah_implementation', 'coa_data.json');
  
  try {
    const csvData = fs.readFileSync(coaCSVPath, 'utf8');
    const jsonData = parseCSV(csvData);
    
    // Write to JSON file
    fs.writeFileSync(coaJSONPath, JSON.stringify(jsonData, null, 2), 'utf8');
    console.log(`✅ Chart of Accounts converted: ${jsonData.length} records`);
  } catch (error) {
    console.error('❌ Error converting Chart of Accounts:', error.message);
  }
}

// Convert GL Mappings CSV to JSON
function convertGLMappings() {
  const mappingsCSVPath = path.join(__dirname, '..', 'wardah_erp_handover', 'wardah_gl_mappings.csv');
  const mappingsJSONPath = path.join(__dirname, '..', 'sql', 'wardah_implementation', 'gl_mappings_data.json');
  
  try {
    const csvData = fs.readFileSync(mappingsCSVPath, 'utf8');
    const jsonData = parseCSV(csvData);
    
    // Write to JSON file
    fs.writeFileSync(mappingsJSONPath, JSON.stringify(jsonData, null, 2), 'utf8');
    console.log(`✅ GL Mappings converted: ${jsonData.length} records`);
  } catch (error) {
    console.error('❌ Error converting GL Mappings:', error.message);
  }
}

// Main function
function main() {
  console.log('🔄 Converting CSV files to JSON format...');
  
  convertCOA();
  convertGLMappings();
  
  console.log('✅ CSV to JSON conversion complete!');
}

// Run the script
main();