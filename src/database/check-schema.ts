import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load config
const configPath = path.join(__dirname, '../../..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Initialize Supabase client
const supabaseUrl = config.SUPABASE_URL;
const supabaseAnonKey = config.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkFunctionsExist() {
  try {
    console.log('Checking if required database functions exist...');
    
    // Check if calculate_material_variances function exists
    const { data: materialFunc, error: materialError } = await supabase
      .from('pg_proc')
      .select('proname')
      .eq('proname', 'calculate_material_variances');
    
    if (materialError) {
      console.error('Error checking for material variances function:', materialError);
    } else {
      console.log('Material variances function exists:', materialFunc && materialFunc.length > 0);
    }
    
    // Check if calculate_labor_variances function exists
    const { data: laborFunc, error: laborError } = await supabase
      .from('pg_proc')
      .select('proname')
      .eq('proname', 'calculate_labor_variances');
    
    if (laborError) {
      console.error('Error checking for labor variances function:', laborError);
    } else {
      console.log('Labor variances function exists:', laborFunc && laborFunc.length > 0);
    }
    
    // Check if wip_by_stage view exists
    const { data: viewExists, error: viewError } = await supabase
      .from('pg_views')
      .select('viewname')
      .eq('viewname', 'wip_by_stage');
    
    if (viewError) {
      console.error('Error checking for wip_by_stage view:', viewError);
    } else {
      console.log('WIP by stage view exists:', viewExists && viewExists.length > 0);
    }
    
  } catch (error) {
    console.error('Error in checkFunctionsExist:', error);
  }
}

async function runCheck() {
  console.log('Running database schema check...');
  await checkFunctionsExist();
  console.log('Schema check completed.');
}

// Run check if this script is executed directly
if (require.main === module) {
  runCheck();
}

export { checkFunctionsExist, runCheck };