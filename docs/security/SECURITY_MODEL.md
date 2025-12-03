# Wardah ERP Security Model

## Overview

This document describes the comprehensive security model for the Wardah ERP system, including authentication, authorization, multi-tenancy, and data protection.

## Architecture

### Multi-Tenant Architecture

The system uses a **shared database, shared schema** approach with Row Level Security (RLS) for tenant isolation.

```
┌─────────────────────────────────────────┐
│         Supabase Auth Layer            │
│  (JWT tokens, user authentication)     │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│      Application Layer (React)          │
│  (Tenant context, permission checks)    │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│      Database Layer (PostgreSQL)        │
│  (RLS policies, tenant isolation)       │
└─────────────────────────────────────────┘
```

## Authentication

### User Authentication Flow

1. **User Login**
   - User provides email/password
   - Supabase Auth validates credentials
   - JWT token issued with user ID

2. **Session Management**
   - JWT stored in secure HTTP-only cookie
   - Token refresh handled automatically
   - Session timeout: 7 days (configurable)

3. **Multi-Organization Support**
   - User can belong to multiple organizations
   - User selects active organization
   - Organization ID stored in session context

### Authentication Methods

- **Email/Password:** Primary method
- **Magic Links:** (Future) Passwordless login
- **OAuth:** (Future) Google, Microsoft, etc.

## Authorization

### Role-Based Access Control (RBAC)

#### Role Hierarchy

```
Super Admin
    │
    ├── Organization Admin
    │       │
    │       ├── Manager
    │       │       │
    │       │       └── User
    │       │
    │       └── Accountant
    │
    └── System Admin
```

#### Roles and Permissions

##### Super Admin
- Full system access
- Manage all organizations
- System configuration
- User management across all orgs

##### Organization Admin
- Full access within their organization
- User management (org level)
- Organization settings
- All modules access

##### Manager
- Operational management
- Manufacturing orders
- Inventory management
- Reports access
- Limited user management

##### Accountant
- Financial data access
- Journal entries
- GL accounts
- Financial reports
- No operational access

##### User
- Basic data entry
- View own data
- Limited reports
- No administrative access

### Permission System

Permissions are granular and module-based:

```
Module: Manufacturing
├── manufacturing.view
├── manufacturing.create
├── manufacturing.edit
├── manufacturing.delete
├── manufacturing.approve
└── manufacturing.cost.view

Module: Inventory
├── inventory.view
├── inventory.edit
├── inventory.adjust
└── inventory.export

Module: Accounting
├── accounting.view
├── accounting.journal.create
├── accounting.journal.edit
├── accounting.reports.view
└── accounting.reports.export
```

## Multi-Tenancy

### Tenant Isolation Strategy

#### Database Level (RLS)

All tables have RLS enabled with tenant isolation policies:

```sql
-- Example policy
CREATE POLICY "table_tenant_isolation" ON table_name
    FOR ALL USING (
        org_id = auth_org_id()
        OR is_super_admin()
    );
```

#### Application Level

- Tenant ID extracted from JWT/session
- All queries automatically filtered by tenant
- Tenant-aware query builder enforces isolation

#### Data Isolation Rules

1. **Strict Isolation:** Users can only see their org's data
2. **Super Admin Exception:** Super admins can see all data
3. **Cross-Tenant Prevention:** No cross-tenant queries allowed
4. **Audit Trail:** All access logged with tenant context

### Tenant Identification

- **Primary Key:** `org_id` (UUID)
- **Lookup:** Via `user_organizations` table
- **Context:** Stored in JWT claims and session

## Data Protection

### Encryption

#### At Rest
- Database: Supabase managed encryption
- Files: Encrypted storage buckets
- Backups: Encrypted backups

#### In Transit
- HTTPS/TLS for all connections
- Encrypted WebSocket for realtime
- Secure API endpoints

### Data Access Controls

#### Row Level Security (RLS)
- Enforced at database level
- Cannot be bypassed by application code
- Policies tested and audited regularly

#### Column Level Security
- Sensitive fields masked in queries
- PII data access logged
- Financial data requires special permissions

### Audit Logging

All critical operations are logged:

- User authentication (login/logout)
- Data access (sensitive tables)
- Data modifications (create/update/delete)
- Permission changes
- Configuration changes

See: `docs/security/AUDIT_LOGGING.md`

## Security Policies

### Password Policy

- Minimum length: 8 characters
- Complexity: Mixed case, numbers, special chars
- Expiration: 90 days (configurable)
- History: Cannot reuse last 5 passwords

### Session Security

- Session timeout: 7 days inactivity
- Concurrent sessions: Limited to 5
- IP tracking: Logged for security
- Suspicious activity: Auto-lock account

### API Security

- Rate limiting: 100 requests/minute
- CORS: Restricted to allowed origins
- API keys: Rotated quarterly
- Request signing: (Future) HMAC signatures

## Threat Mitigation

### SQL Injection

- **Prevention:** Parameterized queries only
- **RLS:** Additional layer of protection
- **Testing:** Regular security scans

### Cross-Site Scripting (XSS)

- **Prevention:** React's built-in escaping
- **CSP:** Content Security Policy headers
- **Sanitization:** Input validation and sanitization

### Cross-Site Request Forgery (CSRF)

- **Prevention:** SameSite cookies
- **Tokens:** CSRF tokens for state-changing operations
- **Headers:** Custom headers for API requests

### Data Leakage

- **Prevention:** RLS policies
- **Monitoring:** Audit logs
- **Testing:** Cross-tenant access tests

## Compliance

### Data Privacy

- **GDPR:** Right to access, deletion, portability
- **Data Retention:** Configurable retention policies
- **Data Export:** User data export functionality

### Audit Requirements

- **Financial:** Complete audit trail for accounting
- **Operational:** Manufacturing process tracking
- **Security:** Access and permission logs

## Security Monitoring

### Active Monitoring

- Failed login attempts
- Unusual access patterns
- Permission changes
- Data export activities

### Alerts

- Multiple failed logins
- Cross-tenant access attempts
- Privilege escalation
- Large data exports

## Incident Response

### Security Incident Procedure

1. **Detection:** Automated alerts or manual reporting
2. **Assessment:** Severity and impact analysis
3. **Containment:** Immediate threat mitigation
4. **Investigation:** Root cause analysis
5. **Recovery:** System restoration
6. **Documentation:** Incident report

### Contact Information

- **Security Team:** security@wardah.sa
- **Emergency:** [Emergency contact]
- **Bug Bounty:** [Program details]

## Security Best Practices

### For Developers

1. Always use tenant-aware queries
2. Never bypass RLS policies
3. Validate all user inputs
4. Use parameterized queries
5. Log security-relevant events
6. Follow principle of least privilege

### For Administrators

1. Regular security audits
2. Keep dependencies updated
3. Monitor audit logs
4. Review access permissions
5. Test backup/restore procedures
6. Document security changes

## References

- [Supabase Security Guide](https://supabase.com/docs/guides/auth)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [PostgreSQL Security](https://www.postgresql.org/docs/current/security.html)
- Internal: `sql/migrations/41_multi_tenant_rls_policies.sql`

## Document History

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-01-XX | 1.0 | Initial document | Security Team |

