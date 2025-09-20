/**
 * Import Complete Chart of Accounts from WARDAH ERP HANDOVER CSV files
 * This script helps import all 190 accounts with proper hierarchy
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Function to read and parse CSV file
function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    const records = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => records.push(data))
      .on('end', () => resolve(records))
      .on('error', reject);
  });
}

// Function to generate SQL insert statements for gl_accounts
function generateGLAccountsSQL(accounts) {
  const sqlStatements = [];
  
  // Header
  sqlStatements.push('-- SQL Insert Statements for gl_accounts');
  sqlStatements.push('-- Generated from WARDAH Enhanced COA CSV');
  sqlStatements.push('');
  
  // Generate INSERT statements
  sqlStatements.push('INSERT INTO gl_accounts (');
  sqlStatements.push('  code, name, category, subtype, parent_code,');
  sqlStatements.push('  normal_balance, allow_posting, is_active, currency, notes');
  sqlStatements.push(') VALUES');
  
  const values = accounts.map((account, index) => {
    // Escape single quotes in strings
    const escapeString = (str) => str ? str.replace(/'/g, "''") : '';
    
    const line = `  ('${escapeString(account.code)}', '${escapeString(account.name)}', '${escapeString(account.category)}', '${escapeString(account.subtype)}', ${
      account.parent_code ? `'${escapeString(account.parent_code)}'` : 'NULL'
    }, '${escapeString(account.normal_balance)}', ${account.allow_posting.toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE'}, ${
      account.is_active.toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE'
    }, '${escapeString(account.currency)}', '${escapeString(account.notes || '')}')`;
    
    // Add comma if not last item
    return index < accounts.length - 1 ? line + ',' : line;
  });
  
  sqlStatements.push(values.join('\n'));
  sqlStatements.push(';');
  
  return sqlStatements.join('\n');
}

// Function to validate account hierarchy
function validateAccountHierarchy(accounts) {
  const accountMap = new Map();
  const errors = [];
  
  // Create map of all accounts
  accounts.forEach(account => {
    accountMap.set(account.code, account);
  });
  
  // Check for duplicate codes
  const codes = accounts.map(a => a.code);
  const uniqueCodes = [...new Set(codes)];
  if (codes.length !== uniqueCodes.length) {
    errors.push('Duplicate account codes found');
  }
  
  // Check parent-child relationships
  accounts.forEach(account => {
    if (account.parent_code && account.parent_code !== '') {
      if (!accountMap.has(account.parent_code)) {
        errors.push(`Account ${account.code} (${account.name}) references non-existent parent ${account.parent_code}`);
      }
    }
  });
  
  // Check for circular references
  const visited = new Set();
  const visiting = new Set();
  
  function hasCycle(accountCode) {
    if (visiting.has(accountCode)) {
      return true; // Cycle detected
    }
    
    if (visited.has(accountCode)) {
      return false; // Already processed
    }
    
    visiting.add(accountCode);
    const account = accountMap.get(accountCode);
    
    if (account && account.parent_code && account.parent_code !== '') {
      if (hasCycle(account.parent_code)) {
        errors.push(`Circular reference detected involving account ${accountCode}`);
        visiting.delete(accountCode);
        visited.add(accountCode);
        return true;
      }
    }
    
    visiting.delete(accountCode);
    visited.add(accountCode);
    return false;
  }
  
  accounts.forEach(account => {
    if (!visited.has(account.code)) {
      hasCycle(account.code);
    }
  });
  
  return errors;
}

// Function to generate account hierarchy tree
function generateAccountTree(accounts) {
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
    console.log(`${spaces}${account.code} - ${account.name}`);
    if (account.children && account.children.length > 0) {
      printAccountTree(account.children, indent + 1);
    }
  });
}

// Main function
async function main() {
  try {
    // Read the CSV file
    const csvPath = path.join(__dirname, 'wardah_erp_handover', 'wardah_enhanced_coa.csv');
    console.log(`Reading Chart of Accounts from: ${csvPath}`);
    
    const accounts = await readCSV(csvPath);
    console.log(`Loaded ${accounts.length} accounts from CSV`);
    
    // Validate hierarchy
    console.log('\nValidating account hierarchy...');
    const validationErrors = validateAccountHierarchy(accounts);
    if (validationErrors.length > 0) {
      console.log('Validation errors found:');
      validationErrors.forEach(error => console.log(`  - ${error}`));
    } else {
      console.log('✓ Account hierarchy validation passed');
    }
    
    // Generate SQL
    console.log('\nGenerating SQL insert statements...');
    const sqlContent = generateGLAccountsSQL(accounts);
    const sqlPath = path.join(__dirname, 'import-complete-coa.sql');
    fs.writeFileSync(sqlPath, sqlContent);
    console.log(`✓ SQL statements written to: ${sqlPath}`);
    
    // Generate account tree
    console.log('\nGenerating account hierarchy tree...');
    const accountTree = generateAccountTree(accounts);
    
    console.log('\n=== CHART OF ACCOUNTS HIERARCHY ===');
    printAccountTree(accountTree);
    
    // Summary statistics
    console.log('\n=== SUMMARY ===');
    console.log(`Total accounts: ${accounts.length}`);
    console.log(`Root accounts: ${accountTree.length}`);
    
    // Count by category
    const categoryCount = {};
    accounts.forEach(account => {
      categoryCount[account.category] = (categoryCount[account.category] || 0) + 1;
    });
    
    console.log('\nAccount count by category:');
    Object.entries(categoryCount)
      .sort(([,a], [,b]) => b - a)
      .forEach(([category, count]) => {
        console.log(`  ${category}: ${count}`);
      });
      
    // Count by posting permission
    const postingCount = { posting_allowed: 0, posting_not_allowed: 0 };
    accounts.forEach(account => {
      if (account.allow_posting.toUpperCase() === 'TRUE') {
        postingCount.posting_allowed++;
      } else {
        postingCount.posting_not_allowed++;
      }
    });
    
    console.log('\nPosting permissions:');
    console.log(`  Allow posting: ${postingCount.posting_allowed}`);
    console.log(`  No posting: ${postingCount.posting_not_allowed}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  readCSV,
  generateGLAccountsSQL,
  validateAccountHierarchy,
  generateAccountTree,
  printAccountTree
};