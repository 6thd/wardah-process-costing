// Script to verify design system implementation across modules
// This script checks if components are using the unified design system

const fs = require('fs');
const path = require('path');

// Define the design system classes we're looking for
const designSystemClasses = [
  'wardah-glass-card',
  'wardah-glass-card-hover',
  'wardah-text-gradient-google',
  'wardah-animation-float',
  'wardah-animation-gradient-shift'
];

// Define the modules to check
const modules = [
  'manufacturing',
  'inventory',
  'dashboard',
  'reports'
];

// Function to check if a file contains design system classes
function checkFileForDesignSystem(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const foundClasses = designSystemClasses.filter(cls => content.includes(cls));
    return foundClasses;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return [];
  }
}

// Function to recursively search for .tsx files in a directory
function findTsxFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  
  list.forEach(file => {
    file = path.resolve(dir, file);
    const stat = fs.statSync(file);
    
    if (stat && stat.isDirectory()) {
      results = [...results, ...findTsxFiles(file)];
    } else if (path.extname(file) === '.tsx') {
      results.push(file);
    }
  });
  
  return results;
}

// Main verification function
function verifyDesignSystem() {
  console.log('Verifying Design System Implementation...\n');
  
  modules.forEach(module => {
    const modulePath = path.join(__dirname, '..', 'src', 'features', module);
    
    if (fs.existsSync(modulePath)) {
      console.log(`Checking ${module} module:`);
      
      const tsxFiles = findTsxFiles(modulePath);
      let moduleClasses = new Set();
      let floatAnimationCount = 0;
      
      tsxFiles.forEach(file => {
        const foundClasses = checkFileForDesignSystem(file);
        if (foundClasses.length > 0) {
          console.log(`  ${path.basename(file)}: ${foundClasses.join(', ')}`);
          foundClasses.forEach(cls => {
            moduleClasses.add(cls);
            if (cls === 'wardah-animation-float') {
              floatAnimationCount++;
            }
          });
        }
      });
      
      if (moduleClasses.size > 0) {
        console.log(`  ✓ ${module} module uses ${moduleClasses.size} design system classes`);
        console.log(`  ✓ ${module} module uses floating animation in ${floatAnimationCount} places\n`);
      } else {
        console.log(`  ✗ ${module} module does not use design system classes\n`);
      }
    } else {
      console.log(`Module ${module} not found\n`);
    }
  });
  
  console.log('Design System Verification Complete');
}

// Run the verification
verifyDesignSystem();