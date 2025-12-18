# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x.x   | :white_check_mark: |
| 1.x.x   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please send an email to security@wardah.com.sa. 
Please do not report security vulnerabilities through public GitHub issues.

We will acknowledge receipt within 48 hours and provide a detailed response within 7 days.

## Known Vulnerability Exceptions

### xlsx Package (SheetJS Community Edition)

**CVEs**: CVE-2023-30533, CVE-2024-22363  
**Severity**: High  
**Status**: Accepted Risk  

#### Risk Assessment

| Factor | Assessment |
|--------|------------|
| Vulnerability Type | Prototype Pollution, ReDoS |
| Attack Vector | Parsing malicious spreadsheet files |
| Our Usage | **Export only** (write operations) |
| User File Parsing | **None** |
| Risk Level | **LOW** |

#### Justification

1. **Write-Only Usage**: The xlsx library is used exclusively for **exporting** data to Excel format:
   - `XLSX.utils.json_to_sheet()` - Converting JSON data to worksheet
   - `XLSX.utils.book_new()` - Creating new workbook
   - `XLSX.writeFile()` - Writing Excel file for download

2. **No Parsing of Untrusted Input**: The application does not:
   - Accept user-uploaded spreadsheet files
   - Parse external spreadsheet data
   - Use `XLSX.read()` or `XLSX.readFile()` on user content

3. **Archived Legacy Scripts**: The only `readFile` usage exists in `scripts/.archived-legacy/` which contains deprecated import scripts not used in production.

4. **No Available Fix**: SheetJS versions 0.19.3+ and 0.20.2+ (which contain the fixes) are only available through their commercial "SheetJS Pro" offering and are not published to npm. The latest npm version is 0.18.5.

#### Affected Files (Export Only)
- `src/features/reports/components/utils/salesReportsExport.ts`
- `src/features/general-ledger/index.tsx`
- `src/features/accounting/account-statement/index.tsx`
- `src/features/accounting/trial-balance/utils/trialBalanceExport.ts`

#### Mitigation Measures
1. Regular review of xlsx usage patterns
2. Monitoring for npm package updates
3. Consideration of alternative libraries (exceljs) if parsing functionality is needed in the future
4. Input validation on all data before export

#### Future Considerations
- If file upload/parsing functionality is required, migrate to `exceljs` (v4.4.0+) which does not have these vulnerabilities
- Continue monitoring SheetJS community edition for security updates

---

*Last Reviewed: 2025-01-16*  
*Next Review: 2025-04-16*
