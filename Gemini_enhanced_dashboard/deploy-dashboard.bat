@echo off
TITLE Deploying Gemini AI Enhanced Financial Dashboard with Wardah ERP Integration

echo 🚀 Deploying Gemini AI Enhanced Financial Dashboard with Wardah ERP Integration
echo ==============================================================================

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not installed or not in PATH
    echo Please install Node.js (which includes npm) from https://nodejs.org/
    pause
    exit /b 1
)

echo ✅ Node.js and npm found

REM Run the deployment script
echo 📦 Installing dependencies and setting up the dashboard...
node deploy-dashboard.js

if %errorlevel% neq 0 (
    echo ❌ Deployment failed
    pause
    exit /b 1
)

echo.
echo 🎉 Deployment completed successfully!
echo.
echo 📝 Next steps:
echo 1. Start the proxy service by running: node deploy-dashboard.js --start
echo 2. Open the dashboard by running: node deploy-dashboard.js --open
echo 3. Use the "Sync with Wardah ERP" button to fetch data
echo.
echo 📝 For production deployment, make sure to:
echo    - Configure proper security settings
echo    - Use HTTPS for all communications
echo    - Set up proper CORS configuration
echo    - Implement authentication and authorization
echo.
pause