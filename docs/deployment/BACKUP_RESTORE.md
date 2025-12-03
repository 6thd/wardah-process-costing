# Backup and Restore Procedures

## Overview

This document describes the backup and restore procedures for the Wardah ERP database. Regular backups are critical for data protection and disaster recovery.

## Backup Strategy

### Backup Schedule

- **Daily Backups:** Automatic at 2:00 AM (Riyadh time)
- **Before Migrations:** Automatic backup before any schema migration
- **Manual Backups:** On-demand before major changes

### Backup Retention

- **Daily Backups:** Kept for 30 days
- **Monthly Backups:** Kept for 12 months
- **Yearly Backups:** Kept for 5 years

### Backup Storage

- **Primary:** Local storage in `./backups` directory
- **Secondary:** (Optional) Cloud storage (S3, etc.)

## Backup Procedures

### Automated Daily Backup

The system uses a cron job to run daily backups:

```bash
# Add to crontab
0 2 * * * /path/to/scripts/backup/backup-database.sh
```

### Manual Backup

To create a manual backup:

```bash
# Set environment variables
export SUPABASE_DB_URL="postgresql://user:password@host:port/database"

# Run backup script
./scripts/backup/backup-database.sh
```

### Pre-Migration Backup

Always backup before running migrations:

```bash
# Backup before migration
./scripts/backup/backup-database.sh

# Run migration
psql $SUPABASE_DB_URL -f sql/migrations/XX_new_migration.sql

# Verify migration success
# If failed, restore from backup
```

## Restore Procedures

### Full Database Restore

**WARNING:** This will overwrite all existing data!

```bash
# List available backups
ls -lh backups/

# Restore from backup
./scripts/backup/restore-database.sh backups/wardah_backup_20250101_020000.sql.gz
```

### Selective Restore

To restore specific tables:

```bash
# Extract specific table from backup
pg_restore -t table_name backup_file.sql > table_backup.sql

# Restore table
psql $SUPABASE_DB_URL < table_backup.sql
```

## Recovery Objectives

### RTO (Recovery Time Objective)

- **Target:** < 4 hours
- **Maximum Acceptable:** < 24 hours

### RPO (Recovery Point Objective)

- **Target:** < 1 hour (data loss)
- **Maximum Acceptable:** < 24 hours

## Backup Verification

### Automated Testing

Weekly automated restore test:

```bash
# Test restore to staging database
./scripts/backup/test-restore.sh
```

### Manual Verification

1. Check backup file exists and has content
2. Verify backup size is reasonable
3. Test restore to staging environment
4. Verify data integrity after restore

## Backup Monitoring

### Health Checks

- **Backup Age:** Alert if last backup > 26 hours old
- **Backup Size:** Alert if size changes significantly
- **Backup Success:** Alert on backup failure

### Monitoring Script

```bash
# Check backup health
./scripts/backup/check-backup-health.sh
```

## Disaster Recovery Plan

### Scenario 1: Database Corruption

1. **Detect:** Monitoring alerts or user reports
2. **Assess:** Determine extent of corruption
3. **Restore:** Restore from most recent backup
4. **Verify:** Test system functionality
5. **Document:** Record incident and resolution

### Scenario 2: Accidental Data Deletion

1. **Detect:** User reports missing data
2. **Assess:** Identify affected tables/records
3. **Restore:** Restore specific tables from backup
4. **Merge:** Merge restored data with current data
5. **Verify:** Confirm data integrity

### Scenario 3: Complete System Failure

1. **Assess:** Determine failure scope
2. **Restore:** Full database restore from backup
3. **Reconfigure:** Restore application configuration
4. **Test:** Full system testing
5. **Go Live:** Resume operations

## Backup Best Practices

### Do's

- ✅ Backup before any migration
- ✅ Test restore procedures regularly
- ✅ Store backups in multiple locations
- ✅ Encrypt sensitive backups
- ✅ Document backup procedures
- ✅ Monitor backup success/failure

### Don'ts

- ❌ Don't skip backups
- ❌ Don't store backups on same server
- ❌ Don't forget to test restores
- ❌ Don't delete backups prematurely
- ❌ Don't ignore backup failures

## Configuration

### Environment Variables

```bash
# Database connection
export SUPABASE_DB_URL="postgresql://..."

# Or individual parameters
export SUPABASE_DB_HOST="db.example.com"
export SUPABASE_DB_NAME="wardah_db"
export SUPABASE_DB_USER="wardah_user"
export SUPABASE_DB_PASSWORD="secure_password"

# Backup settings
export BACKUP_DIR="./backups"
export RETENTION_DAYS=30
```

### Configuration File

Edit `scripts/backup/backup-config.json` for detailed settings.

## Troubleshooting

### Backup Fails

1. Check database connectivity
2. Verify disk space
3. Check permissions
4. Review error logs
5. Test manual backup

### Restore Fails

1. Verify backup file integrity
2. Check database connectivity
3. Ensure sufficient disk space
4. Review error messages
5. Try restoring to staging first

## References

- Backup Script: `scripts/backup/backup-database.sh`
- Restore Script: `scripts/backup/restore-database.sh`
- Configuration: `scripts/backup/backup-config.json`
- Supabase Backup Guide: [Link]

## Document History

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-01-XX | 1.0 | Initial document | DevOps Team |

