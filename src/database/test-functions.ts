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

async function testMaterialVariances() {
  try {
    console.log('Testing material variances function...');
    
    // First, let's get a sample manufacturing order ID
    const { data: moData, error: moError } = await supabase
      .from('manufacturing_orders')
      .select('id')
      .limit(1);
    
    if (moError) {
      console.error('Error fetching manufacturing order:', moError);
      return;
    }
    
    if (!moData || moData.length === 0) {
      console.log('No manufacturing orders found in database');
      return;
    }
    
    const moId = moData[0].id;
    console.log(`Testing with manufacturing order ID: ${moId}`);
    
    // Test the material variances function
    const { data, error } = await supabase.rpc('calculate_material_variances', {
      p_mo_id: moId
    });
    
    if (error) {
      console.error('Error calling calculate_material_variances:', error);
      return;
    }
    
    console.log('Material variances result:', data);
  } catch (error) {
    console.error('Error in testMaterialVariances:', error);
  }
}

async function testLaborVariances() {
  try {
    console.log('Testing labor variances function...');
    
    // First, let's get a sample manufacturing order ID
    const { data: moData, error: moError } = await supabase
      .from('manufacturing_orders')
      .select('id')
      .limit(1);
    
    if (moError) {
      console.error('Error fetching manufacturing order:', moError);
      return;
    }
    
    if (!moData || moData.length === 0) {
      console.log('No manufacturing orders found in database');
      return;
    }
    
    const moId = moData[0].id;
    console.log(`Testing with manufacturing order ID: ${moId}`);
    
    // Test the labor variances function
    const { data, error } = await supabase.rpc('calculate_labor_variances', {
      p_mo_id: moId
    });
    
    if (error) {
      console.error('Error calling calculate_labor_variances:', error);
      return;
    }
    
    console.log('Labor variances result:', data);
  } catch (error) {
    console.error('Error in testLaborVariances:', error);
  }
}

async function testWIPView() {
  try {
    console.log('Testing WIP view...');
    
    // Test the WIP view
    const { data, error } = await supabase
      .from('wip_by_stage')
      .select('*')
      .limit(5);
    
    if (error) {
      console.error('Error querying wip_by_stage view:', error);
      return;
    }
    
    console.log('WIP view result:', data);
  } catch (error) {
    console.error('Error in testWIPView:', error);
  }
}

async function runAllTests() {
  console.log('Running database function tests...');
  
  await testMaterialVariances();
  await testLaborVariances();
  await testWIPView();
  
  console.log('All tests completed.');
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests();
}

export { testMaterialVariances, testLaborVariances, testWIPView, runAllTests };