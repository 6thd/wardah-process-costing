# =====================================
# Implementation Verification Script (PowerShell)
# =====================================
# This script verifies that all implementation steps were successful

$PASSED = 0
$FAILED = 0
$WARNINGS = 0

function Log-Pass {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
    $script:PASSED++
}

function Log-Fail {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
    $script:FAILED++
}

function Log-Warn {
    param([string]$Message)
    Write-Host "⚠ $Message" -ForegroundColor Yellow
    $script:WARNINGS++
}

Write-Host "======================================"
Write-Host "Implementation Verification"
Write-Host "======================================"
Write-Host ""

# Check 1: Security Audit Scripts
Write-Host "1. Checking Security Audit Scripts..."
if (Test-Path "sql/migrations/58_security_audit_report.sql") {
    Log-Pass "Security audit script exists"
} else {
    Log-Fail "Security audit script missing"
}

if (Test-Path "scripts/security/test_rls_policies.sql") {
    Log-Pass "RLS test script exists"
} else {
    Log-Fail "RLS test script missing"
}

# Check 2: Backup Scripts
Write-Host ""
Write-Host "2. Checking Backup Scripts..."
if (Test-Path "scripts/backup/backup-database.sh") {
    Log-Pass "Backup script exists"
} else {
    Log-Fail "Backup script missing"
}

if (Test-Path "scripts/backup/restore-database.sh") {
    Log-Pass "Restore script exists"
} else {
    Log-Fail "Restore script missing"
}

# Check 3: Environment Validation
Write-Host ""
Write-Host "3. Checking Environment Validation..."
if (Test-Path "scripts/env/validate-env.ts") {
    Log-Pass "Environment validation script exists"
} else {
    Log-Fail "Environment validation script missing"
}

# Check 4: RLS Policy Fixes
Write-Host ""
Write-Host "4. Checking RLS Policy Fixes..."
if (Test-Path "sql/migrations/59_fix_rls_policies.sql") {
    Log-Pass "RLS policy fixes migration exists"
} else {
    Log-Fail "RLS policy fixes migration missing"
}

# Check 5: Audit Logs
Write-Host ""
Write-Host "5. Checking Audit Log System..."
if (Test-Path "sql/migrations/60_create_audit_logs_table.sql") {
    Log-Pass "Audit logs migration exists"
} else {
    Log-Fail "Audit logs migration missing"
}

if (Test-Path "src/lib/audit/AuditLogger.ts") {
    Log-Pass "AuditLogger service exists"
} else {
    Log-Fail "AuditLogger service missing"
}

if (Test-Path "src/hooks/useAuditLog.ts") {
    Log-Pass "useAuditLog hook exists"
} else {
    Log-Fail "useAuditLog hook missing"
}

# Check 6: Error Handling
Write-Host ""
Write-Host "6. Checking Error Handling..."
$errorFiles = @(
    "src/lib/errors/AppError.ts",
    "src/lib/errors/ValidationError.ts",
    "src/lib/errors/NotFoundError.ts",
    "src/lib/errors/ErrorHandler.ts"
)

foreach ($file in $errorFiles) {
    if (Test-Path $file) {
        Log-Pass "$(Split-Path $file -Leaf) exists"
    } else {
        Log-Fail "$(Split-Path $file -Leaf) missing"
    }
}

# Check 7: Transactions
Write-Host ""
Write-Host "7. Checking Transaction System..."
if (Test-Path "src/lib/db-transaction.ts") {
    Log-Pass "Transaction wrapper exists"
} else {
    Log-Fail "Transaction wrapper missing"
}

if (Test-Path "sql/functions/transaction_helpers.sql") {
    Log-Pass "Transaction helper functions exist"
} else {
    Log-Fail "Transaction helper functions missing"
}

# Check 8: Material Reservations
Write-Host ""
Write-Host "8. Checking Material Reservation System..."
if (Test-Path "sql/migrations/61_add_material_reservations.sql") {
    Log-Pass "Material reservations migration exists"
} else {
    Log-Fail "Material reservations migration missing"
}

if (Test-Path "src/services/inventory-transaction-service.ts") {
    Log-Pass "Inventory transaction service exists"
} else {
    Log-Fail "Inventory transaction service missing"
}

# Check 9: Tenant Client
Write-Host ""
Write-Host "9. Checking Tenant-Aware Client..."
if (Test-Path "src/lib/tenant-client.ts") {
    Log-Pass "Tenant client exists"
} else {
    Log-Fail "Tenant client missing"
}

if (Test-Path "src/lib/tenant-validator.ts") {
    Log-Pass "Tenant validator exists"
} else {
    Log-Fail "Tenant validator missing"
}

# Check 10: Testing
Write-Host ""
Write-Host "10. Checking Test Files..."
$testFiles = @(
    "src/domain/__tests__/process-costing.test.ts",
    "src/domain/__tests__/inventory.test.ts",
    "src/integration/__tests__/manufacturing-workflow.test.ts",
    "tests/security/cross-tenant-access.test.ts"
)

foreach ($file in $testFiles) {
    if (Test-Path $file) {
        Log-Pass "$(Split-Path $file -Leaf) exists"
    } else {
        Log-Warn "$(Split-Path $file -Leaf) missing (optional)"
    }
}

# Check 11: Monitoring
Write-Host ""
Write-Host "11. Checking Monitoring..."
if (Test-Path "src/lib/monitoring/sentry.ts") {
    Log-Pass "Sentry integration exists"
} else {
    Log-Fail "Sentry integration missing"
}

if (Test-Path "src/lib/monitoring/performance.ts") {
    Log-Pass "Performance monitoring exists"
} else {
    Log-Fail "Performance monitoring missing"
}

# Check 12: Documentation
Write-Host ""
Write-Host "12. Checking Documentation..."
$docFiles = @(
    "docs/security/RLS_POLICIES_AUDIT.md",
    "docs/security/SECURITY_MODEL.md",
    "docs/security/PERMISSIONS_MAP.md",
    "docs/deployment/BACKUP_RESTORE.md",
    "docs/deployment/ENVIRONMENTS.md",
    "docs/RISK_ASSESSMENT.md"
)

foreach ($file in $docFiles) {
    if (Test-Path $file) {
        Log-Pass "$(Split-Path $file -Leaf) exists"
    } else {
        Log-Warn "$(Split-Path $file -Leaf) missing"
    }
}

# Summary
Write-Host ""
Write-Host "======================================"
Write-Host "Verification Summary"
Write-Host "======================================"
Write-Host "Passed: $PASSED" -ForegroundColor Green
Write-Host "Failed: $FAILED" -ForegroundColor Red
Write-Host "Warnings: $WARNINGS" -ForegroundColor Yellow
Write-Host ""

if ($FAILED -eq 0) {
    Write-Host "✓ All critical checks passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "✗ Some checks failed. Please review above." -ForegroundColor Red
    exit 1
}

