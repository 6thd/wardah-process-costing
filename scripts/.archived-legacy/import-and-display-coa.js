/**
 * Import and Display WARDAH ERP Chart of Accounts
 * This script reads the wardah_enhanced_coa.csv file and displays the complete chart of accounts in a tree structure
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Function to read and parse the WARDAH COA CSV file
function readWardahCOA() {
  return new Promise((resolve, reject) => {
    const filePath = path.join(__dirname, 'wardah_erp_handover', 'wardah_enhanced_coa.csv');
    const accounts = [];
    
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        // Convert string boolean values to actual booleans
        const account = {
          ...data,
          allow_posting: data.allow_posting.toLowerCase() === 'true',
          is_active: data.is_active.toLowerCase() === 'true'
        };
        accounts.push(account);
      })
      .on('end', () => resolve(accounts))
      .on('error', reject);
  });
}

// Function to build account hierarchy from CSV data
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

// Function to print account tree to console
function printAccountTree(accounts, indent = 0) {
  accounts.forEach(account => {
    const spaces = '  '.repeat(indent);
    const status = account.is_active ? ' ✓' : ' ✗';
    const posting = account.allow_posting ? ' (P)' : ' (NP)';
    console.log(`${spaces}${account.code} - ${account.name}${status}${posting}`);
    
    if (account.children && account.children.length > 0) {
      printAccountTree(account.children, indent + 1);
    }
  });
}

// Function to print detailed account tree
function printAccountTreeDetailed(accounts, indent = 0) {
  accounts.forEach(account => {
    const spaces = '  '.repeat(indent);
    const status = account.is_active ? ' [ACTIVE]' : ' [INACTIVE]';
    const posting = account.allow_posting ? ' [POSTING]' : ' [NO POSTING]';
    console.log(`${spaces}${account.code} - ${account.name}${status}${posting}`);
    console.log(`${spaces}  Category: ${account.category}, Subtype: ${account.subtype || 'N/A'}`);
    console.log(`${spaces}  Balance: ${account.normal_balance}, Currency: ${account.currency}`);
    if (account.notes) {
      console.log(`${spaces}  Notes: ${account.notes}`);
    }
    
    if (account.children && account.children.length > 0) {
      printAccountTreeDetailed(account.children, indent + 1);
    }
  });
}

// Function to generate statistics
function generateStatistics(accounts) {
  const stats = {
    total: 0,
    byCategory: {},
    bySubtype: {},
    postingAllowed: 0,
    notPosting: 0,
    active: 0,
    inactive: 0,
    levels: {}
  };
  
  function traverse(account, level = 0) {
    // Count total accounts
    stats.total++;
    
    // Count by level
    stats.levels[level] = (stats.levels[level] || 0) + 1;
    
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
      account.children.forEach(child => traverse(child, level + 1));
    }
  }
  
  accounts.forEach(account => traverse(account, 0));
  
  return stats;
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
  
  // Check for circular references would be complex, so we'll skip it for now
  
  return errors;
}

// Function to generate SQL insert statements
function generateSQLInserts(accounts) {
  const sqlStatements = [];
  
  sqlStatements.push('-- SQL Insert Statements for gl_accounts');
  sqlStatements.push('-- Generated from wardah_enhanced_coa.csv');
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
      account.parent_code && account.parent_code !== '' ? `'${escapeString(account.parent_code)}'` : 'NULL'
    }, '${escapeString(account.normal_balance)}', ${account.allow_posting ? 'TRUE' : 'FALSE'}, ${
      account.is_active ? 'TRUE' : 'FALSE'
    }, '${escapeString(account.currency)}', '${escapeString(account.notes || '')}')`;
    
    // Add comma if not last item
    return index < accounts.length - 1 ? line + ',' : line;
  });
  
  sqlStatements.push(values.join('\n'));
  sqlStatements.push(';');
  
  return sqlStatements.join('\n');
}

// Main function
async function main() {
  try {
    console.log('Reading WARDAH ERP Chart of Accounts from CSV...');
    const accounts = await readWardahCOA();
    
    console.log(`Loaded ${accounts.length} accounts from wardah_enhanced_coa.csv`);
    
    // Validate hierarchy
    console.log('\nValidating account hierarchy...');
    const validationErrors = validateAccountHierarchy(accounts);
    if (validationErrors.length > 0) {
      console.log('Validation errors found:');
      validationErrors.forEach(error => console.log(`  - ${error}`));
    } else {
      console.log('✓ Account hierarchy validation passed');
    }
    
    // Build hierarchy
    const accountTree = buildAccountHierarchy(accounts);
    
    // Display summary
    console.log('\n=== WARDAH ERP CHART OF ACCOUNTS HIERARCHY ===');
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
      
    console.log('\nAccounts by level:');
    Object.entries(stats.levels)
      .sort(([a], [b]) => a - b)
      .forEach(([level, count]) => {
        console.log(`  Level ${level}: ${count} accounts`);
      });
    
    // Generate SQL
    console.log('\nGenerating SQL insert statements...');
    const sqlContent = generateSQLInserts(accounts);
    const sqlPath = path.join(__dirname, 'import-wardah-coa.sql');
    fs.writeFileSync(sqlPath, sqlContent);
    console.log(`✓ SQL statements written to: ${sqlPath}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  readWardahCOA,
  buildAccountHierarchy,
  printAccountTree,
  printAccountTreeDetailed,
  generateStatistics,
  validateAccountHierarchy,
  generateSQLInserts
};