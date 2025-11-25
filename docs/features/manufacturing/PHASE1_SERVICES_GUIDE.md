# Phase 1 Services Guide - دليل استخدام Services

## Overview - نظرة عامة

Phase 1 has created three new database tables and corresponding services in `src/services/supabase-service.ts`:

### New Services:
1. **manufacturingStagesService** - Manage manufacturing stages
2. **stageWipLogService** - Track WIP (Work in Process) by stage
3. **standardCostsService** - Manage standard costs per product/stage

---

## 1. Manufacturing Stages Service

### Get All Stages
```typescript
import { manufacturingStagesService } from '@/services/supabase-service'

const stages = await manufacturingStagesService.getAll()
// Returns: Array of stages with work_centers and gl_accounts joined
```

### Get Stage by ID
```typescript
const stage = await manufacturingStagesService.getById('stage-id')
```

### Create Stage
```typescript
const newStage = await manufacturingStagesService.create({
  code: 'MIX',
  name: 'Mixing',
  name_ar: 'الخلط',
  description: 'Initial mixing stage',
  order_sequence: 1,
  is_active: true,
  work_center_id: 'work-center-id', // optional
  wip_gl_account_id: 'gl-account-id' // optional
})
```

### Update Stage
```typescript
const updated = await manufacturingStagesService.update('stage-id', {
  name: 'Updated Name',
  is_active: false
})
```

### Delete Stage
```typescript
await manufacturingStagesService.delete('stage-id')
```

---

## 2. Stage WIP Log Service

### Get All WIP Logs
```typescript
import { stageWipLogService } from '@/services/supabase-service'

// Get all logs
const logs = await stageWipLogService.getAll()

// With filters
const logs = await stageWipLogService.getAll({
  moId: 'manufacturing-order-id',
  stageId: 'stage-id',
  periodStart: '2024-01-01',
  periodEnd: '2024-01-31',
  isClosed: false
})
```

### Get WIP Log by ID
```typescript
const log = await stageWipLogService.getById('log-id')
```

### Create WIP Log
```typescript
const newLog = await stageWipLogService.create({
  mo_id: 'manufacturing-order-id',
  stage_id: 'stage-id',
  period_start: '2024-01-01',
  period_end: '2024-01-31',
  units_beginning_wip: 100,
  units_started: 500,
  units_completed: 450,
  units_ending_wip: 150,
  units_transferred_out: 450,
  material_completion_pct: 100,
  conversion_completion_pct: 75,
  cost_material: 10000,
  cost_labor: 5000,
  cost_overhead: 2000
})
// Note: Trigger automatically calculates equivalent units and costs
```

### Update WIP Log
```typescript
const updated = await stageWipLogService.update('log-id', {
  units_completed: 500,
  cost_material: 12000
})
```

### Close Period
```typescript
await stageWipLogService.closePeriod('log-id', 'user-id')
```

---

## 3. Standard Costs Service

### Get All Standard Costs
```typescript
import { standardCostsService } from '@/services/supabase-service'

// Get all standard costs
const costs = await standardCostsService.getAll()

// With filters
const costs = await standardCostsService.getAll({
  productId: 'product-id',
  stageId: 'stage-id',
  isActive: true
})
```

### Get Standard Cost by ID
```typescript
const cost = await standardCostsService.getById('cost-id')
```

### Get Active Standard Cost
```typescript
const activeCost = await standardCostsService.getActive(
  'product-id',
  'stage-id',
  '2024-01-15' // optional date, defaults to today
)
```

### Create Standard Cost
```typescript
const newCost = await standardCostsService.create({
  product_id: 'product-id',
  stage_id: 'stage-id',
  material_cost_per_unit: 10.50,
  labor_cost_per_unit: 5.25,
  overhead_cost_per_unit: 2.10,
  effective_from: '2024-01-01',
  effective_to: null, // null = no end date
  is_active: true
})
```

### Update Standard Cost
```typescript
const updated = await standardCostsService.update('cost-id', {
  material_cost_per_unit: 11.00,
  is_active: false
})
```

### Approve Standard Cost
```typescript
await standardCostsService.approve('cost-id', 'user-id')
```

---

## React Hooks (Optional)

You can create React hooks for these services:

```typescript
// hooks/useManufacturingStages.ts
import { useQuery } from '@tanstack/react-query'
import { manufacturingStagesService } from '@/services/supabase-service'

export function useManufacturingStages() {
  return useQuery({
    queryKey: ['manufacturing-stages'],
    queryFn: () => manufacturingStagesService.getAll()
  })
}
```

```typescript
// hooks/useStageWipLog.ts
import { useQuery } from '@tanstack/react-query'
import { stageWipLogService } from '@/services/supabase-service'

export function useStageWipLog(filters?: {
  moId?: string
  stageId?: string
}) {
  return useQuery({
    queryKey: ['stage-wip-log', filters],
    queryFn: () => stageWipLogService.getAll(filters)
  })
}
```

---

## Error Handling

All services throw errors that should be caught:

```typescript
try {
  const stages = await manufacturingStagesService.getAll()
} catch (error) {
  console.error('Error fetching stages:', error)
  // Handle error (show toast, etc.)
}
```

---

## Performance Notes

- All `getAll()` methods use `PerformanceMonitor.measure()` for performance tracking
- Queries are optimized with proper indexes
- Related data (work_centers, gl_accounts) is joined efficiently

---

## Next Steps

1. Create initial manufacturing stages (use `25_create_sample_manufacturing_stages.sql`)
2. Test services in your application
3. Integrate with Manufacturing Orders UI
4. Start tracking WIP by stage

---

**Last Updated:** [Date]  
**Status:** ✅ Phase 1 Complete - Services Ready

