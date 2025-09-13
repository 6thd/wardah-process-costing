# Accounting Services

This directory contains services for handling accounting integration with the process costing system.

## Services Overview

### Posting Service (`posting-service.ts`)
Handles all General Ledger posting operations:
- Event journal entries
- Work center overhead postings
- Inventory movement linking to journal entries
- Account balance inquiries
- Trial balance generation

### Variance Monitoring Service (`variance-monitoring-service.ts`)
Manages variance analysis and monitoring:
- Process costing variance analysis
- Overhead variance analysis
- Variance alert generation
- Journal entry posting for significant variances

### Notification Service (`notification-service.ts`)
Handles real notification capabilities:
- In-app notifications
- Email notifications (placeholder)
- SMS notifications (placeholder)
- Push notifications (placeholder)
- Notification preferences management

## Usage Examples

### Posting an Event Journal Entry
```typescript
import { PostingService } from '@/services/accounting/posting-service'

// Post a scrap to finished goods journal entry
const journalId = await PostingService.postEventJournal({
  event: 'SCRAP_TO_FG',
  amount: 1500,
  memo: 'Convert scrap to finished goods',
  refType: 'BATCH',
  refId: 'batch-123',
  idempotencyKey: 'SCRAP_TO_FG:batch-123:1500:2024-01-15',
  jvDate: '2024-01-15'
})
```

### Performing Variance Analysis
```typescript
import { equivalentUnitsService } from '@/domain/manufacturing/equivalentUnits'

// Perform variance analysis for a manufacturing order stage
const variance = await equivalentUnitsService.performVarianceAnalysis(
  'mo-123',
  20
)

// The service automatically posts to GL and sends notifications
// for significant variances
```

### Setting up Scheduled Jobs
```typescript
// In your job scheduler (e.g., using node-cron)
import varianceMonitoringJob from '@/jobs/variance-monitoring-job'

// Run daily at midnight
cron.schedule('0 0 * * *', async () => {
  await varianceMonitoringJob()
})
```

## Security and Best Practices

1. **Tenant Isolation**: All services respect tenant boundaries using RLS
2. **Idempotency**: All posting operations support idempotency keys to prevent duplicate entries
3. **Period Validation**: All postings are validated against open accounting periods
4. **Balance Validation**: Journal entries are automatically validated for balance
5. **Audit Trail**: All operations are logged for audit purposes

## Integration with UI Components

The services are designed to be used directly by React components:

```typescript
// In a React component
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { equivalentUnitsService } from '@/domain/manufacturing/equivalentUnits'

function VarianceAlertsComponent() {
  const queryClient = useQueryClient()
  
  const { data: varianceAlerts, isLoading } = useQuery({
    queryKey: ['variance-alerts'],
    queryFn: () => equivalentUnitsService.getVarianceAlerts('MEDIUM')
  })
  
  const handleAnalyzeVariances = async () => {
    await equivalentUnitsService.performVarianceAnalysis(selectedMO, selectedStage)
    queryClient.invalidateQueries(['variance-alerts'])
  }
  
  // Render UI with varianceAlerts data
}
```

## Error Handling

All services throw descriptive errors that can be caught and handled appropriately:

```typescript
try {
  const journalId = await PostingService.postEventJournal(request)
  console.log('Successfully posted journal entry:', journalId)
} catch (error) {
  if (error.message.includes('GL period closed')) {
    // Handle closed period error
  } else if (error.message.includes('Unauthorized tenant')) {
    // Handle authorization error
  } else {
    // Handle other errors
  }
}
```