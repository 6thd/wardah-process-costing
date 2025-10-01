// Setup script for Wardah ERP integration
// This script helps configure the integration between the dashboard and Wardah ERP

const fs = require('fs');
const readline = require('readline');

// Create interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Function to generate a secure random key
function generateSecureKey(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Function to update .env file
function updateEnvFile(wardahApiKey, proxyAuthKey) {
    const envContent = `# Wardah ERP Proxy Configuration

# Port to run the proxy service on
PORT=3001

# Wardah ERP API Key (obtain from Wardah ERP admin panel)
WARDAH_API_KEY=${wardahApiKey}

# Authentication key for proxy service (generate a secure key)
PROXY_AUTH_KEY=${proxyAuthKey}

# CORS configuration
ALLOWED_ORIGINS=http://localhost:3000,https://your-dashboard-domain.com
`;
    
    fs.writeFileSync('.env', envContent);
    console.log('✅ .env file created successfully');
}

// Function to update HTML file with proxy configuration
function updateHtmlFile(proxyAuthKey) {
    // Read the HTML file
    let htmlContent = fs.readFileSync('gemini_enhanced_dashboard.html', 'utf8');
    
    // Replace the proxy auth key in the JavaScript code
    htmlContent = htmlContent.replace(
        /proxyAuthKey: 'YOUR_PROXY_AUTH_KEY'/g,
        `proxyAuthKey: '${proxyAuthKey}'`
    );
    
    // Write the updated content back to the file
    fs.writeFileSync('gemini_enhanced_dashboard.html', htmlContent);
    console.log('✅ HTML file updated with proxy configuration');
}

// Main setup function
async function setupIntegration() {
    console.log('🔧 Wardah ERP Integration Setup');
    console.log('================================\n');
    
    console.log('This script will help you configure the integration between the dashboard and Wardah ERP.');
    console.log('You will need your Wardah ERP API key to proceed.\n');
    
    // Get Wardah API key from user
    rl.question('Enter your Wardah ERP API key: ', (wardahApiKey) => {
        if (!wardahApiKey) {
            console.log('❌ Wardah API key is required. Setup aborted.');
            rl.close();
            return;
        }
        
        // Generate a secure proxy auth key
        const proxyAuthKey = generateSecureKey();
        console.log(`\n🔐 Generated proxy authentication key: ${proxyAuthKey}\n`);
        
        // Confirm with user before proceeding
        rl.question('Do you want to proceed with these settings? (y/N): ', (confirmation) => {
            if (confirmation.toLowerCase() !== 'y' && confirmation.toLowerCase() !== 'yes') {
                console.log('❌ Setup cancelled by user.');
                rl.close();
                return;
            }
            
            try {
                // Update .env file
                updateEnvFile(wardahApiKey, proxyAuthKey);
                
                // Update HTML file
                updateHtmlFile(proxyAuthKey);
                
                console.log('\n✅ Wardah ERP integration setup completed successfully!');
                console.log('\nNext steps:');
                console.log('1. Install dependencies: npm install');
                console.log('2. Start the proxy service: npm start');
                console.log('3. Open the dashboard in your browser');
                console.log('4. Use the "Sync with Wardah ERP" button to fetch data');
                
                console.log('\n📝 Note: For production use, make sure to:');
                console.log('  - Use HTTPS for all communications');
                console.log('  - Configure proper CORS settings in .env');
                console.log('  - Store API keys securely');
                console.log('  - Implement additional security measures as needed');
                
            } catch (error) {
                console.error('❌ Error during setup:', error.message);
            }
            
            rl.close();
        });
    });
}

// Run the setup
setupIntegration();