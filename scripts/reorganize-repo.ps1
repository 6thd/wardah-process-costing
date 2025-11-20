# Repository Reorganization Script
# سكربت إعادة تنظيم الريبو

Write-Host "🗂️ Starting Repository Reorganization..." -ForegroundColor Cyan

# Phase 1: Move all .md files to docs/archive (except README.md, CONTRIBUTING.md, LICENSE)
Write-Host "`n📄 Phase 1: Moving Markdown files..." -ForegroundColor Yellow
$mdFiles = Get-ChildItem -Path . -Filter "*.md" -File | Where-Object { 
    $_.Name -notin @("README.md", "CONTRIBUTING.md", "LICENSE", "REPOSITORY_REORGANIZATION_PLAN.md")
}
$mdCount = $mdFiles.Count
Write-Host "Found $mdCount markdown files to move" -ForegroundColor Gray
foreach ($file in $mdFiles) {
    Move-Item -Path $file.FullName -Destination "docs/archive/$($file.Name)" -Force -ErrorAction SilentlyContinue
}
Write-Host "✅ Moved $mdCount markdown files to docs/archive/" -ForegroundColor Green

# Phase 2: Move all .sql files to sql/archive (except those already in sql/ subdirectories)
Write-Host "`n🗄️ Phase 2: Moving SQL files..." -ForegroundColor Yellow
$sqlFiles = Get-ChildItem -Path . -Filter "*.sql" -File
$sqlCount = $sqlFiles.Count
Write-Host "Found $sqlCount SQL files to move" -ForegroundColor Gray
foreach ($file in $sqlFiles) {
    Move-Item -Path $file.FullName -Destination "sql/archive/$($file.Name)" -Force -ErrorAction SilentlyContinue
}
Write-Host "✅ Moved $sqlCount SQL files to sql/archive/" -ForegroundColor Green

# Phase 3: Move all .cjs, .js, .html files to scripts/archive
Write-Host "`n📜 Phase 3: Moving script files..." -ForegroundColor Yellow
$cjsFiles = Get-ChildItem -Path . -Filter "*.cjs" -File | Where-Object {
    $_.DirectoryName -notlike "*node_modules*" -and
    $_.DirectoryName -notlike "*src*" -and
    $_.DirectoryName -notlike "*scripts*"
}
$jsFiles = Get-ChildItem -Path . -Filter "*.js" -File | Where-Object {
    $_.DirectoryName -notlike "*node_modules*" -and
    $_.DirectoryName -notlike "*src*" -and
    $_.DirectoryName -notlike "*scripts*" -and
    $_.Name -notlike "*config*" -and
    $_.Name -notlike "*playwright*"
}
$htmlFiles = Get-ChildItem -Path . -Filter "*.html" -File | Where-Object {
    $_.DirectoryName -notlike "*node_modules*" -and
    $_.DirectoryName -notlike "*public*"
}
$scriptFiles = $cjsFiles + $jsFiles + $htmlFiles
$scriptCount = $scriptFiles.Count
Write-Host "Found $scriptCount script files to move" -ForegroundColor Gray
foreach ($file in $scriptFiles) {
    Move-Item -Path $file.FullName -Destination "scripts/archive/$($file.Name)" -Force -ErrorAction SilentlyContinue
}
Write-Host "✅ Moved $scriptCount script files to scripts/archive/" -ForegroundColor Green

# Phase 4: Move .bat, .sh files to scripts/archive
Write-Host "`n🔧 Phase 4: Moving batch/shell files..." -ForegroundColor Yellow
$batFiles = Get-ChildItem -Path . -Filter "*.bat" -File
$shFiles = Get-ChildItem -Path . -Filter "*.sh" -File
$batchFiles = $batFiles + $shFiles
$batchCount = $batchFiles.Count
Write-Host "Found $batchCount batch/shell files to move" -ForegroundColor Gray
foreach ($file in $batchFiles) {
    Move-Item -Path $file.FullName -Destination "scripts/archive/$($file.Name)" -Force -ErrorAction SilentlyContinue
}
Write-Host "✅ Moved $batchCount batch/shell files to scripts/archive/" -ForegroundColor Green

# Phase 5: Move .xlsx, .csv, .json (data files) to docs/assets
Write-Host "`n📊 Phase 5: Moving data files..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "docs/assets" | Out-Null
$xlsxFiles = Get-ChildItem -Path . -Filter "*.xlsx" -File
$csvFiles = Get-ChildItem -Path . -Filter "*.csv" -File | Where-Object {
    $_.DirectoryName -notlike "*node_modules*"
}
$dataFiles = $xlsxFiles + $csvFiles
$dataCount = $dataFiles.Count
Write-Host "Found $dataCount data files to move" -ForegroundColor Gray
foreach ($file in $dataFiles) {
    Move-Item -Path $file.FullName -Destination "docs/assets/$($file.Name)" -Force -ErrorAction SilentlyContinue
}
Write-Host "✅ Moved $dataCount data files to docs/assets/" -ForegroundColor Green

# Summary
Write-Host "`n✅ Reorganization Complete!" -ForegroundColor Green
Write-Host "`n📊 Summary:" -ForegroundColor Cyan
Write-Host "  - Markdown files: $mdCount" -ForegroundColor White
Write-Host "  - SQL files: $sqlCount" -ForegroundColor White
Write-Host "  - Script files: $scriptCount" -ForegroundColor White
Write-Host "  - Batch/Shell files: $batchCount" -ForegroundColor White
Write-Host "  - Data files: $dataCount" -ForegroundColor White
Write-Host "`n🎉 Repository is now organized!" -ForegroundColor Green

