#!/bin/bash

# =====================================
# Implementation Verification Script
# =====================================
# This script verifies that all implementation steps were successful

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Functions
log_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
}

log_fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

log_info() {
    echo -e "  $1"
}

echo "======================================"
echo "Implementation Verification"
echo "======================================"
echo ""

# Check 1: Security Audit Scripts
echo "1. Checking Security Audit Scripts..."
if [ -f "sql/migrations/58_security_audit_report.sql" ]; then
    log_pass "Security audit script exists"
else
    log_fail "Security audit script missing"
fi

if [ -f "scripts/security/test_rls_policies.sql" ]; then
    log_pass "RLS test script exists"
else
    log_fail "RLS test script missing"
fi

# Check 2: Backup Scripts
echo ""
echo "2. Checking Backup Scripts..."
if [ -f "scripts/backup/backup-database.sh" ]; then
    if [ -x "scripts/backup/backup-database.sh" ]; then
        log_pass "Backup script exists and is executable"
    else
        log_warn "Backup script exists but not executable (run: chmod +x)"
    fi
else
    log_fail "Backup script missing"
fi

if [ -f "scripts/backup/restore-database.sh" ]; then
    log_pass "Restore script exists"
else
    log_fail "Restore script missing"
fi

# Check 3: Environment Validation
echo ""
echo "3. Checking Environment Validation..."
if [ -f "scripts/env/validate-env.ts" ]; then
    log_pass "Environment validation script exists"
else
    log_fail "Environment validation script missing"
fi

# Check 4: RLS Policy Fixes
echo ""
echo "4. Checking RLS Policy Fixes..."
if [ -f "sql/migrations/59_fix_rls_policies.sql" ]; then
    log_pass "RLS policy fixes migration exists"
else
    log_fail "RLS policy fixes migration missing"
fi

# Check 5: Audit Logs
echo ""
echo "5. Checking Audit Log System..."
if [ -f "sql/migrations/60_create_audit_logs_table.sql" ]; then
    log_pass "Audit logs migration exists"
else
    log_fail "Audit logs migration missing"
fi

if [ -f "src/lib/audit/AuditLogger.ts" ]; then
    log_pass "AuditLogger service exists"
else
    log_fail "AuditLogger service missing"
fi

if [ -f "src/hooks/useAuditLog.ts" ]; then
    log_pass "useAuditLog hook exists"
else
    log_fail "useAuditLog hook missing"
fi

# Check 6: Error Handling
echo ""
echo "6. Checking Error Handling..."
ERROR_FILES=(
    "src/lib/errors/AppError.ts"
    "src/lib/errors/ValidationError.ts"
    "src/lib/errors/NotFoundError.ts"
    "src/lib/errors/ErrorHandler.ts"
)

for file in "${ERROR_FILES[@]}"; do
    if [ -f "$file" ]; then
        log_pass "$(basename $file) exists"
    else
        log_fail "$(basename $file) missing"
    fi
done

# Check 7: Transactions
echo ""
echo "7. Checking Transaction System..."
if [ -f "src/lib/db-transaction.ts" ]; then
    log_pass "Transaction wrapper exists"
else
    log_fail "Transaction wrapper missing"
fi

if [ -f "sql/functions/transaction_helpers.sql" ]; then
    log_pass "Transaction helper functions exist"
else
    log_fail "Transaction helper functions missing"
fi

# Check 8: Material Reservations
echo ""
echo "8. Checking Material Reservation System..."
if [ -f "sql/migrations/61_add_material_reservations.sql" ]; then
    log_pass "Material reservations migration exists"
else
    log_fail "Material reservations migration missing"
fi

if [ -f "src/services/inventory-transaction-service.ts" ]; then
    log_pass "Inventory transaction service exists"
else
    log_fail "Inventory transaction service missing"
fi

# Check 9: Tenant Client
echo ""
echo "9. Checking Tenant-Aware Client..."
if [ -f "src/lib/tenant-client.ts" ]; then
    log_pass "Tenant client exists"
else
    log_fail "Tenant client missing"
fi

if [ -f "src/lib/tenant-validator.ts" ]; then
    log_pass "Tenant validator exists"
else
    log_fail "Tenant validator missing"
fi

# Check 10: Testing
echo ""
echo "10. Checking Test Files..."
TEST_FILES=(
    "src/domain/__tests__/process-costing.test.ts"
    "src/domain/__tests__/inventory.test.ts"
    "src/integration/__tests__/manufacturing-workflow.test.ts"
    "tests/security/cross-tenant-access.test.ts"
)

for file in "${TEST_FILES[@]}"; do
    if [ -f "$file" ]; then
        log_pass "$(basename $file) exists"
    else
        log_warn "$(basename $file) missing (optional)"
    fi
done

# Check 11: Monitoring
echo ""
echo "11. Checking Monitoring..."
if [ -f "src/lib/monitoring/sentry.ts" ]; then
    log_pass "Sentry integration exists"
else
    log_fail "Sentry integration missing"
fi

if [ -f "src/lib/monitoring/performance.ts" ]; then
    log_pass "Performance monitoring exists"
else
    log_fail "Performance monitoring missing"
fi

# Check 12: Documentation
echo ""
echo "12. Checking Documentation..."
DOC_FILES=(
    "docs/security/RLS_POLICIES_AUDIT.md"
    "docs/security/SECURITY_MODEL.md"
    "docs/security/PERMISSIONS_MAP.md"
    "docs/deployment/BACKUP_RESTORE.md"
    "docs/deployment/ENVIRONMENTS.md"
    "docs/RISK_ASSESSMENT.md"
)

for file in "${DOC_FILES[@]}"; do
    if [ -f "$file" ]; then
        log_pass "$(basename $file) exists"
    else
        log_warn "$(basename $file) missing"
    fi
done

# Summary
echo ""
echo "======================================"
echo "Verification Summary"
echo "======================================"
echo -e "${GREEN}Passed:${NC} $PASSED"
echo -e "${RED}Failed:${NC} $FAILED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All critical checks passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some checks failed. Please review above.${NC}"
    exit 1
fi

