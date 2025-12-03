#!/bin/bash

# =====================================
# Wardah ERP - Database Backup Script
# =====================================
# This script creates automated backups of the Supabase database
# Run this script via cron job for daily backups

set -e  # Exit on error

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/wardah_backup_${DATE}.sql"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Supabase configuration (from environment variables)
SUPABASE_DB_URL="${SUPABASE_DB_URL:-}"
SUPABASE_DB_HOST="${SUPABASE_DB_HOST:-}"
SUPABASE_DB_NAME="${SUPABASE_DB_NAME:-}"
SUPABASE_DB_USER="${SUPABASE_DB_USER:-}"
SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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

# Check if pg_dump is available
if ! command -v pg_dump &> /dev/null; then
    log_error "pg_dump is not installed. Please install PostgreSQL client tools."
    exit 1
fi

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Validate configuration
if [ -z "$SUPABASE_DB_URL" ] && [ -z "$SUPABASE_DB_HOST" ]; then
    log_error "Database connection details not provided."
    log_error "Set SUPABASE_DB_URL or SUPABASE_DB_HOST, SUPABASE_DB_NAME, etc."
    exit 1
fi

log_info "Starting database backup..."
log_info "Backup file: $BACKUP_FILE"

# Perform backup
if [ -n "$SUPABASE_DB_URL" ]; then
    # Use connection string
    log_info "Using connection string..."
    pg_dump "$SUPABASE_DB_URL" \
        --verbose \
        --clean \
        --if-exists \
        --no-owner \
        --no-acl \
        --format=plain \
        > "$BACKUP_FILE"
else
    # Use individual parameters
    log_info "Using connection parameters..."
    PGPASSWORD="$SUPABASE_DB_PASSWORD" pg_dump \
        -h "$SUPABASE_DB_HOST" \
        -U "$SUPABASE_DB_USER" \
        -d "$SUPABASE_DB_NAME" \
        --verbose \
        --clean \
        --if-exists \
        --no-owner \
        --no-acl \
        --format=plain \
        > "$BACKUP_FILE"
fi

# Check if backup was successful
if [ $? -eq 0 ] && [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log_info "Backup completed successfully!"
    log_info "Backup size: $BACKUP_SIZE"
    
    # Compress backup
    log_info "Compressing backup..."
    gzip "$BACKUP_FILE"
    BACKUP_FILE="${BACKUP_FILE}.gz"
    COMPRESSED_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log_info "Compressed size: $COMPRESSED_SIZE"
    
    # Create backup metadata
    METADATA_FILE="${BACKUP_FILE}.meta"
    cat > "$METADATA_FILE" <<EOF
{
  "backup_date": "$(date -Iseconds)",
  "backup_file": "$(basename $BACKUP_FILE)",
  "backup_size": "$COMPRESSED_SIZE",
  "database": "$SUPABASE_DB_NAME",
  "host": "$SUPABASE_DB_HOST",
  "retention_days": $RETENTION_DAYS
}
EOF
    
    log_info "Backup metadata saved to: $METADATA_FILE"
    
    # Clean up old backups
    log_info "Cleaning up backups older than $RETENTION_DAYS days..."
    find "$BACKUP_DIR" -name "wardah_backup_*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete
    find "$BACKUP_DIR" -name "wardah_backup_*.sql.gz.meta" -type f -mtime +$RETENTION_DAYS -delete
    log_info "Cleanup completed."
    
    # Optional: Upload to cloud storage
    if [ -n "$BACKUP_UPLOAD_COMMAND" ]; then
        log_info "Uploading backup to cloud storage..."
        eval "$BACKUP_UPLOAD_COMMAND $BACKUP_FILE"
    fi
    
    log_info "Backup process completed successfully!"
    exit 0
else
    log_error "Backup failed!"
    if [ -f "$BACKUP_FILE" ]; then
        rm "$BACKUP_FILE"
    fi
    exit 1
fi

