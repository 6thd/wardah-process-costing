/**
 * Display Complete Chart of Accounts
 * This script displays all 190 accounts in a hierarchical tree structure
 */

const { createClient } = require('@supabase/supabase-js');

// Configuration - Update with your Supabase credentials
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'your-anon-key';

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Function to fetch all accounts from database
async function fetchAllAccounts() {
  try {
    const { data, error } = await supabase
      .from('gl_accounts')
      .select('id, code, name, category, subtype, parent_code, normal_balance, allow_posting, is_active')
      .order('code');
    
    if (error) {
      throw error;
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return [];
  }
}

// Function to build account hierarchy
function buildAccountHierarchy(accounts) {
  const accountMap = new Map();
  const rootAccounts = [];
  
  // Create map of all accounts
  accounts.forEach(account => {
    accountMap.set(account.code, { ...account, children: [] });
  });
  
  // Build hierarchy
  accounts.forEach(account => {
    if (account.parent_code && account.parent_code !== '') {
      const parent = accountMap.get(account.parent_code);
      if (parent) {
        parent.children.push(accountMap.get(account.code));
      }
    } else {
      rootAccounts.push(accountMap.get(account.code));
    }
  });
  
  // Sort children by code
  function sortChildren(accounts) {
    accounts.forEach(account => {
      account.children.sort((a, b) => a.code.localeCompare(b.code));
      sortChildren(account.children);
    });
  }
  
  rootAccounts.sort((a, b) => a.code.localeCompare(b.code));
  sortChildren(rootAccounts);
  
  return rootAccounts;
}

// Function to print account tree
function printAccountTree(accounts, indent = 0) {
  accounts.forEach(account => {
    const spaces = '  '.repeat(indent);
    const postingStatus = account.allow_posting ? ' (P)' : ' (NP)';
    console.log(`${spaces}${account.code} - ${account.name}${postingStatus}`);
    if (account.children && account.children.length > 0) {
      printAccountTree(account.children, indent + 1);
    }
  });
}

// Function to print account tree with details
function printAccountTreeDetailed(accounts, indent = 0) {
  accounts.forEach(account => {
    const spaces = '  '.repeat(indent);
    const status = account.is_active ? ' ✓' : ' ✗';
    const posting = account.allow_posting ? ' ✓' : ' ✗';
    console.log(`${spaces}${account.code} - ${account.name}${status}`);
    console.log(`${spaces}  Category: ${account.category}, Subtype: ${account.subtype || 'N/A'}`);
    console.log(`${spaces}  Posting: ${posting}, Balance: ${account.normal_balance}`);
    if (account.children && account.children.length > 0) {
      printAccountTreeDetailed(account.children, indent + 1);
    }
  });
}

// Function to generate statistics
function generateStatistics(accounts) {
  const stats = {
    total: accounts.length,
    byCategory: {},
    bySubtype: {},
    postingAllowed: 0,
    notPosting: 0,
    active: 0,
    inactive: 0
  };
  
  function traverse(account) {
    // Count by category
    stats.byCategory[account.category] = (stats.byCategory[account.category] || 0) + 1;
    
    // Count by subtype
    if (account.subtype) {
      stats.bySubtype[account.subtype] = (stats.bySubtype[account.subtype] || 0) + 1;
    }
    
    // Count posting permissions
    if (account.allow_posting) {
      stats.postingAllowed++;
    } else {
      stats.notPosting++;
    }
    
    // Count active status
    if (account.is_active) {
      stats.active++;
    } else {
      stats.inactive++;
    }
    
    // Traverse children
    if (account.children) {
      account.children.forEach(traverse);
    }
  }
  
  accounts.forEach(traverse);
  
  return stats;
}

// Main function
async function main() {
  try {
    console.log('Fetching all accounts from database...');
    const accounts = await fetchAllAccounts();
    
    if (accounts.length === 0) {
      console.log('No accounts found in database.');
      return;
    }
    
    console.log(`Found ${accounts.length} accounts.`);
    
    // Build hierarchy
    const accountTree = buildAccountHierarchy(accounts);
    
    // Display summary
    console.log('\n=== CHART OF ACCOUNTS HIERARCHY ===');
    printAccountTree(accountTree);
    
    // Display detailed view
    console.log('\n=== DETAILED VIEW ===');
    printAccountTreeDetailed(accountTree);
    
    // Generate statistics
    const stats = generateStatistics(accountTree);
    console.log('\n=== STATISTICS ===');
    console.log(`Total accounts: ${stats.total}`);
    console.log(`Active: ${stats.active}, Inactive: ${stats.inactive}`);
    console.log(`Posting allowed: ${stats.postingAllowed}, No posting: ${stats.notPosting}`);
    
    console.log('\nAccounts by category:');
    Object.entries(stats.byCategory)
      .sort(([,a], [,b]) => b - a)
      .forEach(([category, count]) => {
        console.log(`  ${category}: ${count}`);
      });
      
    if (Object.keys(stats.bySubtype).length > 0) {
      console.log('\nAccounts by subtype:');
      Object.entries(stats.bySubtype)
        .sort(([,a], [,b]) => b - a)
        .forEach(([subtype, count]) => {
          console.log(`  ${subtype}: ${count}`);
        });
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  fetchAllAccounts,
  buildAccountHierarchy,
  printAccountTree,
  printAccountTreeDetailed,
  generateStatistics
};