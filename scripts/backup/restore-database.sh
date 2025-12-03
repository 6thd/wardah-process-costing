#!/bin/bash

# =====================================
# Wardah ERP - Database Restore Script
# =====================================
# This script restores a database backup
# WARNING: This will overwrite existing data!

set -e  # Exit on error

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_FILE="${1:-}"

# Supabase configuration
SUPABASE_DB_URL="${SUPABASE_DB_URL:-}"
SUPABASE_DB_HOST="${SUPABASE_DB_HOST:-}"
SUPABASE_DB_NAME="${SUPABASE_DB_NAME:-}"
SUPABASE_DB_USER="${SUPABASE_DB_USER:-}"
SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if backup file is provided
if [ -z "$BACKUP_FILE" ]; then
    log_error "Backup file not specified!"
    echo "Usage: $0 <backup_file>"
    echo "Example: $0 backups/wardah_backup_20250101_020000.sql.gz"
    exit 1
fi

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    log_error "Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Check if psql is available
if ! command -v psql &> /dev/null; then
    log_error "psql is not installed. Please install PostgreSQL client tools."
    exit 1
fi

# Confirm restore
log_warn "WARNING: This will overwrite all existing data in the database!"
read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    log_info "Restore cancelled."
    exit 0
fi

log_info "Starting database restore..."
log_info "Backup file: $BACKUP_FILE"

# Decompress if needed
RESTORE_FILE="$BACKUP_FILE"
if [[ "$BACKUP_FILE" == *.gz ]]; then
    log_info "Decompressing backup..."
    RESTORE_FILE="${BACKUP_FILE%.gz}"
    gunzip -c "$BACKUP_FILE" > "$RESTORE_FILE"
fi

# Perform restore
if [ -n "$SUPABASE_DB_URL" ]; then
    log_info "Using connection string..."
    psql "$SUPABASE_DB_URL" < "$RESTORE_FILE"
else
    log_info "Using connection parameters..."
    PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
        -h "$SUPABASE_DB_HOST" \
        -U "$SUPABASE_DB_USER" \
        -d "$SUPABASE_DB_NAME" \
        < "$RESTORE_FILE"
fi

# Check if restore was successful
if [ $? -eq 0 ]; then
    log_info "Restore completed successfully!"
    
    # Clean up temporary file if we decompressed
    if [[ "$BACKUP_FILE" == *.gz ]] && [ -f "$RESTORE_FILE" ]; then
        rm "$RESTORE_FILE"
    fi
    
    log_info "Please verify the restored data before using the system."
    exit 0
else
    log_error "Restore failed!"
    exit 1
fi

