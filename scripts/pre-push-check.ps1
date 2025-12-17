# pre-push-check.ps1 - Run all quality checks before pushing (PowerShell version)

Write-Host "🔍 Running code quality checks..." -ForegroundColor Cyan
Write-Host ""

$hasErrors = $false

# 1. TypeScript Type Check
Write-Host "📘 TypeScript Type Check..." -ForegroundColor Yellow
npm run type-check 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ TypeScript check failed!" -ForegroundColor Red
    $hasErrors = $true
} else {
    Write-Host "✅ TypeScript check passed" -ForegroundColor Green
}
Write-Host ""

# 2. ESLint (with warning threshold)
Write-Host "🔎 Running ESLint..." -ForegroundColor Yellow
$lintOutput = npm run lint 2>&1
$errorCount = ($lintOutput | Select-String -Pattern "^\s+\d+:\d+\s+error" | Measure-Object).Count
Write-Host "Found $errorCount errors"
if ($errorCount -gt 0) {
    Write-Host "❌ ESLint check failed! $errorCount errors found." -ForegroundColor Red
    $hasErrors = $true
} else {
    Write-Host "✅ ESLint check passed (0 errors)" -ForegroundColor Green
}
Write-Host ""

# 3. Tests
Write-Host "🧪 Running tests..." -ForegroundColor Yellow
npm test 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Tests failed!" -ForegroundColor Red
    $hasErrors = $true
} else {
    Write-Host "✅ Tests passed" -ForegroundColor Green
}
Write-Host ""

# 4. Build
Write-Host "🏗️ Building..." -ForegroundColor Yellow
npm run build 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    $hasErrors = $true
} else {
    Write-Host "✅ Build succeeded" -ForegroundColor Green
}
Write-Host ""

Write-Host "======================================" -ForegroundColor Cyan
if ($hasErrors) {
    Write-Host "❌ Some quality checks failed!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "✅ All quality checks passed!" -ForegroundColor Green
}
Write-Host "======================================" -ForegroundColor Cyan
