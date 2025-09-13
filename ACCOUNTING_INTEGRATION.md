# Accounting Integration for Process Costing System

This document explains the complete accounting integration for the process costing system, including how equivalent units calculations, variance analysis, and GL posting work together.

## System Architecture

The accounting integration consists of several interconnected components:

1. **Database Schema** - Enhanced GL foundation with proper controls
2. **RPC Functions** - Secure, idempotent posting functions
3. **Services Layer** - TypeScript services connecting UI to backend
4. **UI Components** - React components for user interaction
5. **Scheduled Jobs** - Automated variance monitoring
6. **Notification System** - Real-time alerts for significant events

## Database Schema Enhancements

### GL Accounts Table
```sql
CREATE TABLE IF NOT EXISTS gl_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS','WIP','RM','FG')),
    parent_id UUID REFERENCES gl_accounts(id),
    is_active BOOLEAN DEFAULT true,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### GL Mappings Table
```sql
CREATE TABLE IF NOT EXISTS gl_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_type TEXT NOT NULL CHECK (key_type IN ('EVENT','WORK_CENTER','MATERIAL','STAGE')),
    key_value TEXT NOT NULL,
    debit_account_code TEXT NOT NULL,
    credit_account_code TEXT NOT NULL,
    notes TEXT,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (key_type, key_value, tenant_id)
);
```

### Accounting Periods
```sql
CREATE TABLE IF NOT EXISTS gl_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED')),
    tenant_id UUID NOT NULL,
    UNIQUE (tenant_id, period_start, period_end)
);
```

### Journal Headers and Lines
```sql
CREATE TABLE IF NOT EXISTS gl_journal_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jv_no TEXT UNIQUE NOT NULL,
    jv_date DATE NOT NULL DEFAULT CURRENT_DATE,
    memo TEXT,
    source_ref_type TEXT,
    source_ref_id UUID,
    idempotency_key TEXT,
    total_amount NUMERIC(18,4) DEFAULT 0,
    currency_code TEXT DEFAULT 'SAR',
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS gl_journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    header_id UUID NOT NULL REFERENCES gl_journal_headers(id) ON DELETE CASCADE,
    line_no INT NOT NULL,
    account_code TEXT NOT NULL,
    dr NUMERIC(18,4) DEFAULT 0 CHECK (dr>=0),
    cr NUMERIC(18,4) DEFAULT 0 CHECK (cr>=0),
    description TEXT,
    tenant_id UUID NOT NULL,
    UNIQUE (header_id, line_no)
);
```

## RPC Functions

### Event Journal Posting
```sql
CREATE OR REPLACE FUNCTION rpc_post_event_journal(
    p_event TEXT,
    p_amount NUMERIC,
    p_memo TEXT,
    p_ref_type TEXT,
    p_ref_id UUID,
    p_tenant UUID,
    p_idempotency_key TEXT DEFAULT NULL,
    p_jv_date DATE DEFAULT CURRENT_DATE
) 
RETURNS UUID
```

### Work Center Overhead Posting
```sql
CREATE OR REPLACE FUNCTION rpc_post_work_center_oh(
    p_work_center TEXT,
    p_amount NUMERIC,
    p_memo TEXT,
    p_ref_type TEXT,
    p_ref_id UUID,
    p_tenant UUID,
    p_idempotency_key TEXT DEFAULT NULL,
    p_jv_date DATE DEFAULT CURRENT_DATE
) 
RETURNS UUID
```

### Variance Analysis Functions
```sql
CREATE OR REPLACE FUNCTION get_variance_alerts(
  p_severity_threshold TEXT DEFAULT 'MEDIUM'
)
RETURNS TABLE(...)

CREATE OR REPLACE FUNCTION analyze_overhead_variances()
RETURNS TABLE(...)

CREATE OR REPLACE FUNCTION generate_variance_report(
  p_start_date DATE,
  p_end_date DATE,
  p_mo_id UUID DEFAULT NULL
)
RETURNS TABLE(...)
```

## Services Layer

### Posting Service
Located in `src/services/accounting/posting-service.ts`, this service provides a clean interface for posting to the GL:

```typescript
export class PostingService {
  static async postEventJournal(request: PostingRequest): Promise<string>
  static async postWorkCenterOH(request: WorkCenterOHRequest): Promise<string>
  static async linkInventoryMoveToJournal(request: LinkInventoryMoveRequest): Promise<void>
  static async getAccountBalance(request: AccountBalanceRequest): Promise<number>
  static async getTrialBalance(request: TrialBalanceRequest): Promise<any[]>
}
```

### Variance Monitoring Service
Located in `src/services/accounting/variance-monitoring-service.ts`, this service handles variance analysis:

```typescript
export class VarianceMonitoringService {
  static async performVarianceAnalysis(moId: string, stageNo: number): Promise<VarianceAnalysis>
  static async getVarianceAlerts(severityThreshold: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'): Promise<VarianceAnalysis[]>
  static async analyzeOverheadVariances(): Promise<OverheadVariance[]>
  static async generateVarianceReport(startDate: string, endDate: string, moId?: string): Promise<VarianceAnalysis[]>
  static async postOverheadVarianceJournal(variance: OverheadVariance, memo: string, refId: string): Promise<string>
  static async scheduleVarianceMonitoring(): Promise<void>
}
```

### Notification Service
Located in `src/services/accounting/notification-service.ts`, this service handles user notifications:

```typescript
export class NotificationService {
  static async sendVarianceAlert(userId: string, variance: VarianceAnalysis, preferences: NotificationPreferences): Promise<void>
  static async sendOverheadVarianceAlert(userId: string, variance: OverheadVariance, preferences: NotificationPreferences): Promise<void>
  static async createInAppNotification(userId: string, notification: Omit<NotificationMessage, 'id'>): Promise<string>
  static async getUnreadNotifications(userId: string): Promise<NotificationMessage[]>
  static async markAsRead(notificationId: string): Promise<void>
  static async markAllAsRead(userId: string): Promise<void>
  static async deleteNotification(notificationId: string): Promise<void>
  static async getNotificationPreferences(userId: string): Promise<NotificationPreferences>
  static async updateNotificationPreferences(userId: string, preferences: Partial<NotificationPreferences>): Promise<void>
}
```

## UI Integration

### Equivalent Units Dashboard
The dashboard in `src/features/manufacturing/equivalent-units-dashboard.tsx` connects to the backend services:

```typescript
const handleCalculateEquivalentUnits = async () => {
  await equivalentUnitsService.calculateEquivalentUnits(
    selectedMO,
    selectedStage,
    beginningWip,
    unitsStarted,
    unitsCompleted,
    endingWip,
    materialCompletion,
    conversionCompletion
  )
}

const handlePerformVarianceAnalysis = async () => {
  await equivalentUnitsService.performVarianceAnalysis(selectedMO, selectedStage)
}
```

## Scheduled Jobs

### Variance Monitoring Job
Located in `src/jobs/variance-monitoring-job.ts`, this job runs periodically to check for significant variances:

```typescript
export class VarianceMonitoringJob {
  static async run(): Promise<void>
  static async runOverheadAnalysis(): Promise<void>
  static async runReportGeneration(): Promise<void>
}
```

## Security Features

1. **Tenant Isolation** - All operations are scoped to the current tenant
2. **Idempotency** - Prevents duplicate postings with idempotency keys
3. **Period Validation** - Ensures postings are only made to open periods
4. **Balance Validation** - Automatically validates journal entry balance
5. **RLS Policies** - Row-level security ensures data isolation

## Best Practices Implemented

1. **Proper Tenant Context** - All RPC functions validate tenant access
2. **Accounting Periods** - Prevents posting to closed periods
3. **Journal Balance** - Ensures all journal entries are balanced
4. **Reliable Sequences** - Uses database sequences for journal numbers
5. **Idempotency** - Prevents duplicate processing
6. **Generalized Mapping** - Flexible account mapping by event, work center, etc.
7. **AVCO Integration** - Links inventory movements to GL entries
8. **Hardening** - Proper search paths, indexes, constraints, and validation

## Example Workflow

1. **User calculates equivalent units** in the dashboard
2. **System stores calculation** in the database
3. **User performs variance analysis** for a manufacturing order stage
4. **System compares standard vs actual costs** and calculates variances
5. **If variance is significant**, system:
   - Posts journal entry to GL using `rpc_post_event_journal`
   - Sends notifications to users based on their preferences
6. **Scheduled job runs daily** to check for new variances
7. **Overhead analysis runs weekly** to compare applied vs actual overhead
8. **Monthly reports are generated** summarizing all variances

## Testing Scenarios

1. **Scrap to Finished Goods**
   - Post WIP-SCRAP → FG-SCRAP journal entry
   - Sell scrap and post COGS-SCRAP → FG-SCRAP
   - Verify FG-SCRAP balance is zero after sale

2. **Regrind Processing**
   - Convert WIP-ROLLS → WIP-PP/PS/PET
   - Apply labor/overhead to new WIP accounts
   - Verify account balances

3. **External Processing**
   - Send WIP → External processing account (500)
   - Receive materials and invoice
   - Close to raw materials inventory
   - Consume in production

4. **Overhead Variance Analysis**
   - Apply overhead during production
   - Record actual overhead from invoices
   - Run variance analysis to identify differences
   - Post variance to OH Variance account (5250)

5. **Period Management**
   - Attempt to post to closed period (should fail)
   - Post to open period (should succeed)
   - Verify period status changes

6. **Idempotency Testing**
   - Submit same request twice with same idempotency key
   - Verify only one journal entry is created