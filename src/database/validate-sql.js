// Script to validate SQL files
import * as fs from 'fs';
import * as path from 'path';

function validateSQLFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for common SQL syntax issues
    if (content.includes('# ')) {
      console.error(`ERROR: Markdown header found in SQL file: ${filePath}`);
      return false;
    }
    
    if (!content.includes('CREATE OR REPLACE FUNCTION') && 
        !content.includes('CREATE OR REPLACE VIEW') &&
        !content.includes('DROP FUNCTION') &&
        !content.includes('DROP VIEW')) {
      console.error(`WARNING: No CREATE or DROP statements found in: ${filePath}`);
    }
    
    console.log(`✓ ${filePath} appears to be valid`);
    return true;
  } catch (error) {
    console.error(`ERROR: Failed to read ${filePath}: ${error.message}`);
    return false;
  }
}

function validateAllSQLFiles() {
  const migrationsDir = path.join(process.cwd(), 'src', 'database', 'migrations');
  const rootSQLFile = path.join(process.cwd(), 'WARDAH_ADVANCED_REPORTS_SCHEMA.sql');
  
  let isValid = true;
  
  // Validate migration files
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .map(file => path.join(migrationsDir, file));
    
    for (const file of files) {
      if (!validateSQLFile(file)) {
        isValid = false;
      }
    }
  }
  
  // Validate root SQL file
  if (fs.existsSync(rootSQLFile)) {
    if (!validateSQLFile(rootSQLFile)) {
      isValid = false;
    }
  }
  
  if (isValid) {
    console.log('All SQL files appear to be valid!');
  } else {
    console.error('Some SQL files have issues!');
    process.exit(1);
  }
}

// Run validation if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateAllSQLFiles();
}

export { validateSQLFile, validateAllSQLFiles };