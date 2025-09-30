// Script to run database migrations
// This script reads SQL files from the migrations directory and executes them

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load config
const configPath = path.join(process.cwd(), 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Initialize Supabase client
const supabaseUrl = config.SUPABASE_URL;
const supabaseServiceKey = config.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase configuration in config.json');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration(filePath) {
  try {
    console.log(`Running migration: ${filePath}`);
    
    // Read the SQL file
    const sql = fs.readFileSync(filePath, 'utf8');
    
    // Split by semicolon to handle multiple statements
    const statements = sql.split(';').filter(stmt => stmt.trim() !== '');
    
    for (const statement of statements) {
      if (statement.trim() !== '') {
        console.log('Executing statement:', statement.substring(0, 100) + '...');
        
        // Execute the statement
        const { error } = await supabase.rpc('execute_sql', { sql: statement.trim() });
        
        if (error) {
          console.error('Error executing statement:', error);
          throw error;
        }
      }
    }
    
    console.log(`Migration ${filePath} completed successfully`);
  } catch (error) {
    console.error(`Error running migration ${filePath}:`, error);
    throw error;
  }
}

async function runAllMigrations() {
  try {
    console.log('Starting database migrations...');
    
    // Get all migration files
    const migrationsDir = path.join(process.cwd(), 'src', 'database', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    console.log(`Found ${files.length} migration files`);
    
    // Run each migration
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      await runMigration(filePath);
    }
    
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration process failed:', error);
    process.exit(1);
  }
}

// Run migrations if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllMigrations();
}

export { runMigration, runAllMigrations };