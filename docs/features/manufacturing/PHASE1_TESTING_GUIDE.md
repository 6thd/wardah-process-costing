# Phase 1 Testing Guide - دليل الاختبار

## Overview - نظرة عامة

This guide helps you test Phase 1 components to ensure everything is working correctly.

---

## Step 1: Verify Database Setup

### 1.1 Run Verification Script

```sql
-- In Supabase SQL Editor:
-- Run: sql/migrations/26_verify_manufacturing_stages.sql
```

This script checks:
- ✅ Stages created successfully
- ✅ No duplicates
- ✅ Sequence ordering
- ✅ RLS enabled
- ✅ Foreign keys configured

### 1.2 Expected Results

You should see:
- **5 manufacturing stages** (MIX, MOLD, ASSEMBLY, QC, PACK)
- All stages active
- Order sequence: 1, 2, 3, 4, 5
- RLS enabled
- No duplicates

---

## Step 2: Test Services in Application

### 2.1 Test Manufacturing Stages Service

Create a test file: `src/test-phase1-services.ts`

```typescript
import { 
  manufacturingStagesService,
  stageWipLogService,
  standardCostsService
} from './services/supabase-service'

// Test 1: Get all stages
async function testManufacturingStages() {
  try {
    console.log('🧪 Testing manufacturingStagesService.getAll()...')
    const stages = await manufacturingStagesService.getAll()
    console.log('✅ Success! Found', stages.length, 'stages')
    console.log('Stages:', stages)
    return true
  } catch (error) {
    console.error('❌ Error:', error)
    return false
  }
}

// Test 2: Get stage by ID
async function testGetStageById() {
  try {
    console.log('🧪 Testing manufacturingStagesService.getById()...')
    const stages = await manufacturingStagesService.getAll()
    if (stages.length > 0) {
      const stage = await manufacturingStagesService.getById(stages[0].id)
      console.log('✅ Success! Retrieved stage:', stage)
      return true
    }
    console.log('⚠️ No stages found to test')
    return false
  } catch (error) {
    console.error('❌ Error:', error)
    return false
  }
}

// Run all tests
async function runTests() {
  console.log('🚀 Starting Phase 1 Service Tests...\n')
  
  const results = {
    getAll: await testManufacturingStages(),
    getById: await testGetStageById()
  }
  
  console.log('\n📊 Test Results:')
  console.log(results)
  
  const allPassed = Object.values(results).every(r => r === true)
  console.log(allPassed ? '✅ All tests passed!' : '❌ Some tests failed')
}

// Uncomment to run:
// runTests()
```

### 2.2 Test in Browser Console

Open your application and run in browser console:

```javascript
// Import services (adjust path as needed)
import { manufacturingStagesService } from './services/supabase-service'

// Test get all stages
manufacturingStagesService.getAll().then(stages => {
  console.log('✅ Stages loaded:', stages)
}).catch(error => {
  console.error('❌ Error:', error)
})
```

---

## Step 3: Test in React Component

### 3.1 Create Test Component

Create: `src/components/test/Phase1Test.tsx`

```typescript
import { useState, useEffect } from 'react'
import { manufacturingStagesService } from '@/services/supabase-service'

export function Phase1Test() {
  const [stages, setStages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadStages() {
      try {
        setLoading(true)
        const data = await manufacturingStagesService.getAll()
        setStages(data)
        setError(null)
      } catch (err: any) {
        setError(err.message)
        console.error('Error loading stages:', err)
      } finally {
        setLoading(false)
      }
    }

    loadStages()
  }, [])

  if (loading) return <div>Loading stages...</div>
  if (error) return <div>Error: {error}</div>

  return (
    <div>
      <h2>Phase 1 Test - Manufacturing Stages</h2>
      <p>Found {stages.length} stages</p>
      <ul>
        {stages.map(stage => (
          <li key={stage.id}>
            {stage.code} - {stage.name} ({stage.name_ar})
            - Sequence: {stage.order_sequence}
            - Active: {stage.is_active ? 'Yes' : 'No'}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

### 3.2 Use in Your App

Add to a route or page:

```typescript
import { Phase1Test } from '@/components/test/Phase1Test'

// In your component:
<Phase1Test />
```

---

## Step 4: Verify Database Relationships

### 4.1 Check Foreign Keys

```sql
-- Check if work_centers table exists
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_name = 'work_centers'
);

-- Check if gl_accounts table exists
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_name = 'gl_accounts'
);
```

### 4.2 Link Work Centers (Optional)

```sql
-- Link work centers to stages
UPDATE manufacturing_stages
SET work_center_id = (
  SELECT id FROM work_centers LIMIT 1
)
WHERE code = 'MIX'
AND work_center_id IS NULL;
```

### 4.3 Link GL Accounts (Optional)

```sql
-- Link GL accounts to stages
UPDATE manufacturing_stages
SET wip_gl_account_id = (
  SELECT id FROM gl_accounts 
  WHERE account_type = 'ASSET' 
  LIMIT 1
)
WHERE code = 'MIX'
AND wip_gl_account_id IS NULL;
```

---

## Step 5: Test WIP Log Service

### 5.1 Create Test WIP Log

```typescript
import { stageWipLogService } from '@/services/supabase-service'

async function testCreateWipLog() {
  try {
    // First, get a manufacturing order and stage
    const stages = await manufacturingStagesService.getAll()
    if (stages.length === 0) {
      console.log('⚠️ No stages found')
      return
    }

    // You'll need a valid mo_id from your manufacturing_orders table
    const testMoId = 'your-manufacturing-order-id'
    const stageId = stages[0].id

    const newWipLog = await stageWipLogService.create({
      mo_id: testMoId,
      stage_id: stageId,
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

    console.log('✅ WIP Log created:', newWipLog)
    // Note: Trigger should have calculated equivalent units automatically
  } catch (error) {
    console.error('❌ Error creating WIP log:', error)
  }
}
```

---

## Step 6: Verify Trigger Works

### 6.1 Check Trigger Calculated Fields

```sql
-- Create a test WIP log entry and check calculated fields
INSERT INTO stage_wip_log (
  org_id,
  mo_id,
  stage_id,
  period_start,
  period_end,
  units_completed,
  units_ending_wip,
  material_completion_pct,
  conversion_completion_pct,
  cost_material,
  cost_labor,
  cost_overhead
)
VALUES (
  (SELECT org_id FROM manufacturing_stages LIMIT 1),
  (SELECT id FROM manufacturing_orders LIMIT 1),
  (SELECT id FROM manufacturing_stages LIMIT 1),
  '2024-01-01',
  '2024-01-31',
  100,
  50,
  100,
  75,
  1000,
  500,
  200
)
RETURNING 
  equivalent_units_material,
  equivalent_units_conversion,
  cost_per_eu_material,
  cost_per_eu_conversion,
  cost_total;

-- Verify that trigger calculated the fields correctly
```

---

## Troubleshooting

### Issue: "Table not found"
**Solution:** Make sure you ran `15_process_costing_enhancement_no_migration.sql`

### Issue: "RLS policy violation"
**Solution:** Make sure you're authenticated and have the correct org_id in your JWT token

### Issue: "Foreign key constraint violation"
**Solution:** Make sure referenced IDs (mo_id, stage_id) exist in their respective tables

### Issue: "Services return empty array"
**Solution:** 
1. Check org_id is set correctly in config.json
2. Check RLS policies are working
3. Verify data exists in tables

---

## Success Criteria

Phase 1 is complete when:
- ✅ All 5 manufacturing stages created
- ✅ Services return data without errors
- ✅ WIP log can be created
- ✅ Triggers calculate fields automatically
- ✅ No RLS errors
- ✅ Foreign keys work correctly

---

**Last Updated:** [Date]  
**Status:** ✅ Phase 1 Complete - Ready for Testing

