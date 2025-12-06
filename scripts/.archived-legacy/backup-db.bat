@echo off
setlocal EnableDelayedExpansion

:: Configuration
set BACKUP_DIR=db-backups

:: Create backup directory if it doesn't exist
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

:: Get current date and time for filename
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set DATE_STR=%datetime:~0,4%%datetime:~4,2%%datetime:~6,2%_%datetime:~8,2%%datetime:~10,2%%datetime:~12,2%

echo Starting database backup...
echo Target: %BACKUP_DIR%\wardah_backup_%DATE_STR%.sql

:: Run Supabase backup
:: Note: This assumes 'supabase' CLI is in your PATH and you are logged in
call supabase db dump -f "%BACKUP_DIR%\wardah_backup_%DATE_STR%.sql"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ Backup created successfully!
    echo File: %BACKUP_DIR%\wardah_backup_%DATE_STR%.sql
) else (
    echo.
    echo ❌ Error creating backup. Please check if Supabase CLI is installed and running.
)

pause
