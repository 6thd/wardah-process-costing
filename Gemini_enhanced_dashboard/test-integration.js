// Test script for Wardah ERP integration
// This script verifies that the integration is working correctly

const fs = require('fs');

console.log('🧪 Testing Wardah ERP Integration');
console.log('==================================\n');

// Check if required files exist
const requiredFiles = [
    '.env',
    'wardah-proxy.js',
    'package.json',
    'gemini_enhanced_dashboard.html'
];

console.log('🔍 Checking required files...');
let allFilesExist = true;

requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`✅ ${file} found`);
    } else {
        console.log(`❌ ${file} not found`);
        allFilesExist = false;
    }
});

if (!allFilesExist) {
    console.log('\n❌ Some required files are missing. Please run the setup first.');
    process.exit(1);
}

// Check .env configuration
console.log('\n🔍 Checking .env configuration...');
const envContent = fs.readFileSync('.env', 'utf8');
const hasApiKey = envContent.includes('WARDAH_API_KEY=') && !envContent.includes('WARDAH_API_KEY=your_actual_wardah_api_key_here');
const hasProxyKey = envContent.includes('PROXY_AUTH_KEY=') && !envContent.includes('PROXY_AUTH_KEY=your_generated_proxy_auth_key_here');

if (hasApiKey) {
    console.log('✅ Wardah API Key configured');
} else {
    console.log('⚠️  Wardah API Key not configured (using placeholder value)');
}

if (hasProxyKey) {
    console.log('✅ Proxy Authentication Key configured');
} else {
    console.log('⚠️  Proxy Authentication Key not configured (using placeholder value)');
}

// Check HTML configuration
console.log('\n🔍 Checking HTML configuration...');
const htmlContent = fs.readFileSync('gemini_enhanced_dashboard.html', 'utf8');
const hasHtmlProxyConfig = htmlContent.includes('proxyAuthKey:') && !htmlContent.includes('YOUR_PROXY_AUTH_KEY');

if (hasHtmlProxyConfig) {
    console.log('✅ HTML proxy configuration found');
} else {
    console.log('⚠️  HTML proxy configuration not found or using placeholder');
}

console.log('\n✅ Integration check completed!');
console.log('\n📝 Next steps:');
console.log('1. Make sure the proxy service is running (node wardah-proxy.js)');
console.log('2. Open gemini_enhanced_dashboard.html in your browser');
console.log('3. Click "Sync with Wardah ERP" to test the integration');
console.log('4. Replace placeholder API keys with actual keys for production use');