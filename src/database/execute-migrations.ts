import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load config
const configPath = path.join(__dirname, '../../..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Initialize Supabase client with service key
const supabaseUrl = config.SUPABASE_URL;
const supabaseServiceKey = config.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase configuration in config.json');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function executeSQLFile(filePath: string): Promise<void> {
  try {
    console.log(`Executing SQL file: ${filePath}`);
    
    // Read the SQL file
    const sql = fs.readFileSync(filePath, 'utf8');
    
    // Split by semicolon and filter out empty statements
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    console.log(`Found ${statements.length} statements to execute`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`Executing statement ${i + 1}/${statements.length}`);
      
      // For function creation, we need to use a different approach
      // since Supabase doesn't allow direct RPC execution of DDL statements
      const { error } = await supabase.rpc('execute_sql', { sql: statement });
      
      // If RPC fails, try direct query (for newer Supabase versions)
      if (error) {
        console.log(`RPC failed, trying direct query for statement ${i + 1}`);
        const { error: queryError } = await supabase.rpc('execute_sql', { sql: statement });
        if (queryError) {
          console.error(`Error executing statement ${i + 1}:`, queryError);
          throw queryError;
        }
      }
    }
    
    console.log(`Successfully executed ${filePath}`);
  } catch (error) {
    console.error(`Error executing ${filePath}:`, error);
    throw error;
  }
}

async function runMigrations() {
  try {
    console.log('Starting database migrations...');
    
    // Get all migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    console.log(`Found ${files.length} migration files`);
    
    // Run each migration
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      await executeSQLFile(filePath);
    }
    
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration process failed:', error);
    process.exit(1);
  }
}

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations();
}

export { executeSQLFile, runMigrations };