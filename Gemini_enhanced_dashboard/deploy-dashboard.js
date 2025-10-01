// Deployment script for Gemini AI Enhanced Financial Dashboard with Wardah ERP integration
// This script helps deploy the complete solution

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Function to check if required files exist
function checkRequiredFiles() {
    const requiredFiles = [
        'gemini_enhanced_dashboard.html',
        'wardah-proxy.js',
        'package.json',
        '.env'
    ];
    
    const missingFiles = [];
    
    requiredFiles.forEach(file => {
        if (!fs.existsSync(file)) {
            missingFiles.push(file);
        }
    });
    
    return missingFiles;
}

// Function to install dependencies
function installDependencies() {
    return new Promise((resolve, reject) => {
        console.log('📦 Installing dependencies...');
        
        exec('npm install', (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Error installing dependencies:', error);
                reject(error);
                return;
            }
            
            if (stderr) {
                console.log('⚠️  Warning during installation:', stderr);
            }
            
            console.log('✅ Dependencies installed successfully');
            console.log(stdout);
            resolve();
        });
    });
}

// Function to start the proxy service
function startProxyService() {
    return new Promise((resolve, reject) => {
        console.log('🚀 Starting Wardah proxy service...');
        
        // Check if pm2 is installed (optional, for process management)
        exec('pm2 --version', (error) => {
            if (error) {
                // Use npm start if pm2 is not available
                console.log('ℹ️  Starting service with npm start...');
                exec('npm start', (error, stdout, stderr) => {
                    if (error) {
                        console.error('❌ Error starting proxy service:', error);
                        reject(error);
                        return;
                    }
                    
                    console.log('✅ Proxy service started successfully');
                    console.log('📝 Note: The service will run in the foreground. Press Ctrl+C to stop.');
                    console.log('📝 For production, consider using a process manager like PM2.');
                    resolve();
                });
            } else {
                // Use pm2 if available
                console.log('ℹ️  Starting service with PM2...');
                exec('pm2 start wardah-proxy.js --name "wardah-proxy"', (error, stdout, stderr) => {
                    if (error) {
                        console.error('❌ Error starting proxy service with PM2:', error);
                        reject(error);
                        return;
                    }
                    
                    console.log('✅ Proxy service started with PM2');
                    console.log(stdout);
                    resolve();
                });
            }
        });
    });
}

// Function to open the dashboard in browser
function openDashboard() {
    const dashboardPath = path.resolve('gemini_enhanced_dashboard.html');
    
    console.log(`🖥️  Opening dashboard: ${dashboardPath}`);
    
    // Platform-specific commands to open browser
    let command;
    switch (process.platform) {
        case 'win32':
            command = `start "" "${dashboardPath}"`;
            break;
        case 'darwin':
            command = `open "${dashboardPath}"`;
            break;
        case 'linux':
            command = `xdg-open "${dashboardPath}"`;
            break;
        default:
            console.log('ℹ️  Please open the following file in your browser:');
            console.log(`   ${dashboardPath}`);
            return;
    }
    
    exec(command, (error) => {
        if (error) {
            console.log('⚠️  Could not automatically open dashboard in browser.');
            console.log('ℹ️  Please open the following file in your browser:');
            console.log(`   ${dashboardPath}`);
        } else {
            console.log('✅ Dashboard opened in browser');
        }
    });
}

// Main deployment function
async function deploySolution() {
    console.log('🚀 Deploying Gemini AI Enhanced Financial Dashboard with Wardah ERP Integration');
    console.log('==============================================================================\n');
    
    // Check for required files
    console.log('🔍 Checking required files...');
    const missingFiles = checkRequiredFiles();
    
    if (missingFiles.length > 0) {
        console.error('❌ Missing required files:');
        missingFiles.forEach(file => console.error(`   - ${file}`));
        console.log('\nPlease run the setup script first or ensure all files are present.');
        return;
    }
    
    console.log('✅ All required files found\n');
    
    try {
        // Install dependencies
        await installDependencies();
        
        console.log('\n✅ Deployment completed successfully!');
        console.log('\n📝 Next steps:');
        console.log('1. Start the proxy service: node deploy-dashboard.js --start');
        console.log('2. Open the dashboard in your browser');
        console.log('3. Use the "Sync with Wardah ERP" button to fetch data');
        
    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
    }
}

// Function to start the proxy service
async function startService() {
    console.log('🚀 Starting Wardah ERP Proxy Service');
    console.log('====================================\n');
    
    try {
        await startProxyService();
        console.log('\n✅ Service is now running');
        console.log('📝 The proxy service is listening on port 3001 by default');
        console.log('📝 You can now use the dashboard with Wardah ERP integration');
    } catch (error) {
        console.error('❌ Failed to start service:', error.message);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--start')) {
    startService();
} else if (args.includes('--open')) {
    openDashboard();
} else {
    deploySolution();
}