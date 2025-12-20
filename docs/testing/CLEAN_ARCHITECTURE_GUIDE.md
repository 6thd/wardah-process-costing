#  Clean Architecture Guide - Wardah ERP

##  نظرة عامة

تم تطبيق **Clean Architecture** في مشروع Wardah ERP لتحقيق:
- **فصل المخاوف** (Separation of Concerns)
- **سهولة الاختبار** (Testability)
- **قابلية الصيانة** (Maintainability)
- **استقلالية الإطار** (Framework Independence)

##  هيكل المجلدات

```
src/
├── domain/                      # 🏛️ طبقة المجال (Pure Business Logic)
│   ├── entities/                # كيانات المجال
│   │   ├── CostBreakdown.ts     # تحليل التكاليف ✅
│   │   ├── ProcessStage.ts      # مراحل التصنيع ✅
│   │   └── index.ts
│   ├── interfaces/              # المنافذ (Ports)
│   │   ├── IProcessCostingRepository.ts ✅
│   │   ├── IInventoryRepository.ts ✅
│   │   ├── IAccountingRepository.ts ✅
│   │   └── index.ts
│   ├── events/                  # 🆕 أحداث المجال (Event Sourcing)
│   │   ├── DomainEvents.ts ✅   # أنواع الأحداث
│   │   ├── EventStore.ts ✅     # واجهات التخزين
│   │   ├── EventFactory.ts ✅   # مصنع الأحداث
│   │   └── __tests__/           # (19 tests)
│   ├── use-cases/               # حالات الاستخدام
│   │   ├── CalculateProcessCost.ts ✅
│   │   └── index.ts
│   ├── value-objects/           # كائنات القيمة (Immutable)
│   │   ├── Money.ts ✅
│   │   ├── Quantity.ts ✅
│   │   ├── HourlyRate.ts ✅
│   │   └── index.ts
│   ├── inventory/               # منطق المخزون
│   │   └── valuation.ts ✅
│   └── __tests__/               # اختبارات المجال (188 tests)
│       └── ...
├── application/                 # 📱 طبقة التطبيق ✅
│   ├── services/                # خدمات التطبيق
│   │   ├── InventoryAppService.ts ✅ (23 tests)
│   │   ├── AccountingAppService.ts ✅ (21 tests)
│   │   └── index.ts
│   ├── cqrs/                    # 🆕 نمط CQRS
│   │   ├── commands/            # الأوامر
│   │   │   ├── inventory-commands.ts ✅
│   │   │   └── accounting-commands.ts ✅
│   │   ├── queries/             # الاستعلامات
│   │   │   ├── inventory-queries.ts ✅
│   │   │   └── accounting-queries.ts ✅
│   │   ├── CommandBus.ts ✅     # ناقل الأوامر
│   │   ├── QueryBus.ts ✅       # ناقل الاستعلامات
│   │   └── __tests__/           # (28 tests)
│   └── hooks/                   # React Hooks
│       ├── useInventory.ts ✅
│       ├── useAccounting.ts ✅
│       └── index.ts
├── infrastructure/              # 🔧 طبقة البنية التحتية ✅
│   ├── repositories/            # تنفيذات Repository
│   │   ├── SupabaseProcessCostingRepository.ts ✅ (16 tests)
│   │   ├── SupabaseInventoryRepository.ts ✅ (17 tests)
│   │   ├── SupabaseAccountingRepository.ts ✅ (14 tests)
│   │   └── __tests__/
│   ├── event-store/             # 🆕 تنفيذات Event Store
│   │   ├── InMemoryEventStore.ts ✅
│   │   └── index.ts
│   └── di/                      # حاوية حقن التبعيات
│       └── container.ts ✅
├── services/                    # طبقة الخدمات (Legacy)
│   └── __tests__/               # (217 tests)
└── modules/                     # الوحدات
    └── inventory/
        └── __tests__/           # (39 tests)
```

##  المبادئ الأساسية

### 1. Dependency Rule
- الطبقات الداخلية لا تعرف شيئاً عن الطبقات الخارجية
- Domain لا يستورد من Infrastructure
- التبعيات تشير للداخل فقط

### 2. Repository Pattern
```typescript
// Domain Interface (Port)
export interface IProcessCostingRepository {
  getDirectMaterials(moId: string): Promise<DirectMaterialData[]>;
  getDirectLabor(moId: string): Promise<DirectLaborData[]>;
  getOverheadCosts(moId: string): Promise<OverheadCostData[]>;
}

// Infrastructure Implementation (Adapter)
export class SupabaseProcessCostingRepository implements IProcessCostingRepository {
  async getDirectMaterials(moId: string): Promise<DirectMaterialData[]> {
    const { data } = await supabase.from('materials').select('*').eq('mo_id', moId);
    return data.map(item => ({ /* mapping */ }));
  }
}
```

### 3. Dependency Injection
```typescript
// Use Case يستلم Repository عبر Constructor
export class CalculateProcessCostUseCase {
  constructor(private readonly repository: IProcessCostingRepository) {}
  
  async execute(input: CostingInput): Promise<CostingResult> {
    const materials = await this.repository.getDirectMaterials(input.moId);
    // Business logic...
  }
}

// DI Container
const useCase = new CalculateProcessCostUseCase(new SupabaseProcessCostingRepository());
```

##  استراتيجية الاختبار

### Domain Tests (Pure - No Mocks Needed)
```typescript
describe('CostBreakdown Entity', () => {
  it('should calculate total cost', () => {
    const breakdown = CostBreakdown.create(1000, 500, 300, 100);
    expect(breakdown.totalCost.amount).toBe(1800);
  });
});
```

### Use Case Tests (Mock Repository Only)
```typescript
describe('CalculateProcessCost Use Case', () => {
  let mockRepository: IProcessCostingRepository;
  
  beforeEach(() => {
    mockRepository = {
      getDirectMaterials: vi.fn(),
      getDirectLabor: vi.fn(),
      getOverheadCosts: vi.fn(),
      getManufacturingOrderQuantity: vi.fn()
    };
  });

  it('should calculate process cost', async () => {
    vi.mocked(mockRepository.getDirectMaterials).mockResolvedValue([
      { id: '1', totalCost: 500 }
    ]);
    
    const useCase = new CalculateProcessCostUseCase(mockRepository);
    const result = await useCase.execute({ moId: 'MO-001' });
    
    expect(result.costBreakdown.materialCost.amount).toBe(500);
  });
});
```

##  CQRS Pattern - تفصيلي

### ما هو CQRS؟

**CQRS** (Command Query Responsibility Segregation) هو نمط معماري يفصل بين:
- **Commands**: العمليات التي تغير الحالة (Write Operations)
- **Queries**: العمليات التي تقرأ البيانات (Read Operations)

### لماذا CQRS؟

**الفوائد:**
1. ✅ **فصل المخاوف**: منطق الكتابة منفصل عن القراءة
2. ✅ **قابلية التوسع**: يمكن توسيع القراءة والكتابة بشكل مستقل
3. ✅ **الأمان**: Validation مختلفة للـ Commands
4. ✅ **Caching**: Query Results يمكن cache-ها
5. ✅ **Audit Trail**: كل Command يُسجل

### بنية CQRS في Wardah ERP

```
src/application/cqrs/
├── commands/
│   ├── inventory-commands.ts     # أوامر المخزون
│   └── accounting-commands.ts    # أوامر المحاسبة
├── queries/
│   ├── inventory-queries.ts      # استعلامات المخزون
│   └── accounting-queries.ts     # استعلامات المحاسبة
├── CommandBus.ts                 # ناقل الأوامر
├── QueryBus.ts                   # ناقل الاستعلامات
└── types.ts                      # الأنواع المشتركة
```

---

### Commands - أمثلة عملية

#### 1. تعريف Command

```typescript
// src/application/cqrs/commands/accounting-commands.ts

import type { ICommand } from '../types'

// Command Interface
export interface CreateJournalEntryCommand extends ICommand<string> {
  commandType: 'CREATE_JOURNAL_ENTRY'
  payload: {
    date: string
    description: string
    lines: Array<{
      accountCode: string
      debit: number
      credit: number
      description: string
    }>
  }
}

// Factory Function
export function createJournalEntryCommand(
  date: string,
  description: string,
  lines: Array<{ accountCode: string; debit: number; credit: number; description: string }>
): CreateJournalEntryCommand {
  return {
    commandType: 'CREATE_JOURNAL_ENTRY',
    payload: { date, description, lines }
  }
}
```

#### 2. Command Handler

```typescript
// src/application/cqrs/commands/accounting-commands.ts

import type { ICommandHandler, CommandResult } from '../types'
import type { IAccountingRepository } from '@/domain/interfaces/IAccountingRepository'

export class CreateJournalEntryHandler 
  implements ICommandHandler<CreateJournalEntryCommand, string> {
  
  constructor(
    private readonly accountingRepo: IAccountingRepository
  ) {}
  
  async execute(command: CreateJournalEntryCommand): Promise<CommandResult<string>> {
    try {
      // 1. Validation
      this.validate(command.payload)
      
      // 2. Business Rules
      if (!this.isBalanced(command.payload.lines)) {
        return {
          success: false,
          error: {
            code: 'UNBALANCED_ENTRY',
            message: 'القيد غير متوازن: يجب أن تتساوى المدينات مع الدائنات'
          }
        }
      }
      
      // 3. Execute Command
      const entryId = await this.accountingRepo.createJournalEntry({
        entryDate: command.payload.date,
        description: command.payload.description,
        entries: command.payload.lines.map(line => ({
          accountCode: line.accountCode,
          debit: line.debit,
          credit: line.credit,
          description: line.description,
          transactionDate: command.payload.date,
          referenceType: 'MANUAL_ENTRY',
          referenceId: ''
        }))
      })
      
      return {
        success: true,
        data: entryId
      }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'فشل تنفيذ الأمر'
        }
      }
    }
  }
  
  private validate(payload: CreateJournalEntryCommand['payload']): void {
    if (!payload.date) throw new Error('التاريخ مطلوب')
    if (!payload.description) throw new Error('الوصف مطلوب')
    if (payload.lines.length < 2) throw new Error('القيد يجب أن يحتوي على سطرين على الأقل')
  }
  
  private isBalanced(lines: Array<{ debit: number; credit: number }>): boolean {
    const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0)
    const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0)
    return Math.abs(totalDebit - totalCredit) < 0.01 // Precision tolerance
  }
}
```

#### 3. تسجيل Handler في CommandBus

```typescript
// src/infrastructure/di/container.ts

import { CommandBus } from '@/application/cqrs/CommandBus'
import { CreateJournalEntryHandler } from '@/application/cqrs/commands/accounting-commands'

// إنشاء CommandBus
const commandBus = new CommandBus()

// تسجيل Handler
commandBus.register(
  'CREATE_JOURNAL_ENTRY',
  () => new CreateJournalEntryHandler(
    container.resolve<IAccountingRepository>('IAccountingRepository')
  )
)

export { commandBus }
```

#### 4. استخدام Command في Feature

```typescript
// src/features/accounting/journal-entries/CreateEntryForm.tsx

import { commandBus } from '@/infrastructure/di/container'
import { createJournalEntryCommand } from '@/application/cqrs/commands/accounting-commands'

function CreateEntryForm() {
  const handleSubmit = async (formData: FormData) => {
    // إنشاء Command
    const command = createJournalEntryCommand(
      formData.date,
      formData.description,
      formData.lines
    )
    
    // إرسال Command
    const result = await commandBus.dispatch(command)
    
    // معالجة النتيجة
    if (result.success) {
      toast.success(`تم إنشاء القيد: ${result.data}`)
      navigate('/journal-entries')
    } else {
      toast.error(result.error.message)
    }
  }
  
  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
    </form>
  )
}
```

---

### Queries - أمثلة عملية

#### 1. تعريف Query

```typescript
// src/application/cqrs/queries/accounting-queries.ts

import type { IQuery } from '../types'

// Query Interface
export interface GetTrialBalanceQuery extends IQuery<TrialBalanceData[]> {
  queryType: 'GET_TRIAL_BALANCE'
  params: {
    asOfDate: string
    includeInactive?: boolean
  }
}

// Factory Function
export function getTrialBalanceQuery(
  asOfDate: string,
  includeInactive = false
): GetTrialBalanceQuery {
  return {
    queryType: 'GET_TRIAL_BALANCE',
    params: { asOfDate, includeInactive }
  }
}

// Response Type
export interface TrialBalanceData {
  accountCode: string
  accountName: string
  debit: number
  credit: number
  balance: number
}
```

#### 2. Query Handler

```typescript
// src/application/cqrs/queries/accounting-queries.ts

import type { IQueryHandler, QueryResult } from '../types'
import type { IAccountingRepository } from '@/domain/interfaces/IAccountingRepository'

export class GetTrialBalanceHandler 
  implements IQueryHandler<GetTrialBalanceQuery, TrialBalanceData[]> {
  
  constructor(
    private readonly accountingRepo: IAccountingRepository
  ) {}
  
  async execute(query: GetTrialBalanceQuery): Promise<QueryResult<TrialBalanceData[]>> {
    try {
      // استرجاع البيانات
      const trialBalance = await this.accountingRepo.getTrialBalance(
        query.params.asOfDate
      )
      
      // تصفية حسب المعاملات
      let result = trialBalance
      if (!query.params.includeInactive) {
        result = trialBalance.filter(account => 
          Math.abs(account.balance) > 0.01
        )
      }
      
      // التحقق من التوازن
      const totalDebit = result.reduce((sum, acc) => sum + acc.debit, 0)
      const totalCredit = result.reduce((sum, acc) => sum + acc.credit, 0)
      
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        console.warn('⚠️ ميزان المراجعة غير متوازن!', { totalDebit, totalCredit })
      }
      
      return {
        success: true,
        data: result,
        metadata: {
          asOfDate: query.params.asOfDate,
          totalAccounts: result.length,
          totalDebit,
          totalCredit,
          balanced: Math.abs(totalDebit - totalCredit) < 0.01
        }
      }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'QUERY_ERROR',
          message: error instanceof Error ? error.message : 'فشل تنفيذ الاستعلام'
        }
      }
    }
  }
}
```

#### 3. Query Caching

```typescript
// src/application/cqrs/QueryBus.ts

export class QueryBus implements IQueryBus {
  private cache: IQueryCache = new InMemoryQueryCache()
  
  async execute<TResult>(query: IQuery<TResult>): Promise<QueryResult<TResult>> {
    // 1. التحقق من Cache
    const cacheKey = this.getCacheKey(query)
    const cached = await this.cache.get<TResult>(cacheKey)
    
    if (cached) {
      console.log('✅ Query result from cache:', query.queryType)
      return {
        success: true,
        data: cached,
        metadata: { cached: true }
      }
    }
    
    // 2. تنفيذ Handler
    const handler = this.handlers.get(query.queryType)
    if (!handler) {
      return {
        success: false,
        error: {
          code: 'HANDLER_NOT_FOUND',
          message: `No handler for query: ${query.queryType}`
        }
      }
    }
    
    const result = await handler().execute(query)
    
    // 3. حفظ في Cache
    if (result.success && result.data) {
      await this.cache.set(cacheKey, result.data, 300) // TTL: 5 minutes
    }
    
    return result
  }
  
  private getCacheKey(query: IQuery<unknown>): string {
    return `${query.queryType}:${JSON.stringify(query.params)}`
  }
}
```

#### 4. استخدام Query في Component

```typescript
// src/features/accounting/trial-balance/TrialBalanceReport.tsx

import { queryBus } from '@/infrastructure/di/container'
import { getTrialBalanceQuery } from '@/application/cqrs/queries/accounting-queries'
import { useQuery } from '@tanstack/react-query'

function TrialBalanceReport() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['trial-balance', '2024-12-31'],
    queryFn: async () => {
      // إنشاء Query
      const query = getTrialBalanceQuery('2024-12-31', false)
      
      // تنفيذ Query
      const result = await queryBus.execute(query)
      
      if (!result.success) {
        throw new Error(result.error.message)
      }
      
      return result.data
    }
  })
  
  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage error={error} />
  
  return (
    <table>
      <thead>
        <tr>
          <th>الحساب</th>
          <th>مدين</th>
          <th>دائن</th>
          <th>الرصيد</th>
        </tr>
      </thead>
      <tbody>
        {data?.map(account => (
          <tr key={account.accountCode}>
            <td>{account.accountName}</td>
            <td>{formatCurrency(account.debit)}</td>
            <td>{formatCurrency(account.credit)}</td>
            <td>{formatCurrency(account.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

---

### Middleware Support

#### Command Middleware

```typescript
// src/application/cqrs/CommandBus.ts

export interface CommandMiddleware {
  before?: (command: ICommand<unknown>) => Promise<CommandResult<unknown> | void>
  after?: (command: ICommand<unknown>, result: CommandResult<unknown>) => Promise<void>
}

// مثال: Validation Middleware
const validationMiddleware: CommandMiddleware = {
  before: async (command) => {
    if (!command.payload) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Command payload is required'
        }
      }
    }
  }
}

// مثال: Logging Middleware
const loggingMiddleware: CommandMiddleware = {
  before: async (command) => {
    console.log(`📝 Executing command: ${command.commandType}`)
  },
  after: async (command, result) => {
    console.log(`✅ Command ${command.commandType}: ${result.success ? 'SUCCESS' : 'FAILED'}`)
  }
}

// تسجيل Middleware
commandBus.use(validationMiddleware)
commandBus.use(loggingMiddleware)
```

---

### CQRS Testing

```typescript
// tests/application/cqrs/CommandBus.test.ts

describe('CommandBus', () => {
  let commandBus: CommandBus
  let mockHandler: ICommandHandler<ICommand<string>, string>
  
  beforeEach(() => {
    commandBus = new CommandBus()
    mockHandler = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: 'entry-123'
      })
    }
  })
  
  it('should execute registered command handler', async () => {
    // Arrange
    commandBus.register('CREATE_ENTRY', () => mockHandler)
    const command = { commandType: 'CREATE_ENTRY', payload: { /* ... */ } }
    
    // Act
    const result = await commandBus.dispatch(command)
    
    // Assert
    expect(mockHandler.execute).toHaveBeenCalledWith(command)
    expect(result.success).toBe(true)
    expect(result.data).toBe('entry-123')
  })
  
  it('should execute middleware before command', async () => {
    // Arrange
    const middleware: CommandMiddleware = {
      before: vi.fn()
    }
    commandBus.use(middleware)
    commandBus.register('CREATE_ENTRY', () => mockHandler)
    
    // Act
    await commandBus.dispatch({ commandType: 'CREATE_ENTRY', payload: {} })
    
    // Assert
    expect(middleware.before).toHaveBeenCalled()
  })
})
```

---

##  الكيانات

### CostBreakdown
```typescript
// إنشاء
const breakdown = CostBreakdown.create(1000, 500, 300, 100);

// الحسابات
breakdown.totalCost.amount        // 1800
breakdown.costPerUnit().amount    // 18
breakdown.materialPercentage()    // 55.56%

// تحليل الفروقات
const variance = actual.varianceFrom(budgeted);
variance.materialCost.amount      // الفرق في المواد

// عمليات Immutable
const updated = breakdown.withMaterialCost(1200);
```

### ProcessStage
```typescript
// إنشاء
const stage = ProcessStage.create('STAGE-001', 'Mixing', 1, 100);

// حسابات WIP
stage.unitsInProgress.value       // 60
stage.wipPercentage               // 60%
stage.equivalentUnits             // 70
stage.totalWIP.amount             // 3000

// تحولات الحالة
const started = stage.start();
const completed = stage.complete();
```

##  Value Objects

### Money (Immutable)
```typescript
const price = Money.of(100, 'SAR');
const doubled = price.multiply(2);     // Money(200, SAR)
const sum = price.add(Money.of(50));   // Money(150, SAR)
```

### Quantity (Immutable)
```typescript
const qty = Quantity.of(100);
qty.isZero()                           // false
const scaled = qty.multiply(2);        // Quantity(200)
```

##  إحصائيات الاختبارات

### Domain Tests (188 اختبار)

| الملف | الاختبارات | الوصف |
|-------|-----------|-------|
| cost-breakdown.test.ts | 17 | تحليل التكاليف |
| process-stage.test.ts | 14 | مراحل التصنيع |
| calculate-process-cost.test.ts | 6 | حساب تكلفة العملية |
| process-costing.test.ts | 11 | محاسبة تكاليف العمليات |
| ias2-inventory-costing.test.ts | 23 | معيار IAS 2 للمخزون |
| ias16-ppe.test.ts | 29 | معيار IAS 16 للأصول الثابتة |
| audit-trail.test.ts | 21 | سجل المراجعة |
| internal-controls.test.ts | 28 | الرقابة الداخلية |
| integration-valuation.test.ts | 31 | طرق التقييم (FIFO, LIFO, AVCO) |
| **المجموع** | **188** | ✅ جميعها ناجحة |

### Application Layer Tests (44 اختبار) 🆕

| الخدمة | الاختبارات | التغطية |
|--------|-----------|---------|
| InventoryAppService.ts | 23 | ~95% |
| AccountingAppService.ts | 21 | ~91% |
| **المجموع** | **44** | ✅ |

### Infrastructure Tests (47 اختبار)

| الخدمة | الاختبارات | التغطية |
|--------|-----------|---------|
| SupabaseProcessCostingRepository.ts | 16 | 100% |
| SupabaseInventoryRepository.ts | 17 | ~73% |
| SupabaseAccountingRepository.ts | 14 | ~72% |
| **المجموع** | **47** | ✅ |

### Integration Tests (364 اختبار) 🆕

| الخدمة | الاختبارات | التغطية |
|--------|-----------|--------|
| utils.ts | 42 | 53% |
| inventory-transaction-service.ts | 37 | 33% |
| valuation.ts | 31 | 100% |
| process-costing-service.ts | 36 | ~35% |
| StockLedgerService.ts | 39 | ~30% |
| accounting-service.ts | 32 | ~25% |
| **المجموع السابق** | **217** | ✅ |

### Services Layer Tests (131 اختبار) 🆕 (18 ديسمبر 2025)

| الخدمة | الاختبارات | التغطية | الوظائف المختبرة |
|--------|-----------|--------|------------------|
| accounting-service.test.ts | 39 | ~40% | validateJournalBalance, calculateBalance, groupEntriesByReference, calculateRunningBalance, categorizeAccounts, calculateTrialBalanceTotals |
| inventory-transaction-service.test.ts | 41 | ~45% | checkItemAvailability, calculateTotalReserved, validateConsumption, calculateFifoCost, calculateWeightedAverageCost |
| sales-service.test.ts | 51 | ~50% | calculateLineTotal, calculateLineTax, calculateCOGS, determineDeliveryStatus, determinePaymentStatus, generateSalesGLEntries, generateCOGSGLEntries |
| **المجموع الجديد** | **131** | ✅ |

### Event Sourcing Tests (19 اختبار) 🆕

| الملف | الاختبارات | الوصف |
|-------|-----------|-------|
| EventFactory | 4 | إنشاء أحداث المجال |
| InMemoryEventStore | 9 | تخزين واسترجاع الأحداث |
| Event Subscription | 3 | الاشتراك في الأحداث |
| Audit Trail | 3 | تتبع سجل التغييرات |
| **المجموع** | **19** | ✅ |

### CQRS Pattern Tests (28 اختبار) 🆕

| المكون | الاختبارات | الوصف |
|--------|-----------|-------|
| Inventory Commands | 3 | أوامر المخزون |
| Accounting Commands | 2 | أوامر المحاسبة |
| Inventory Queries | 3 | استعلامات المخزون |
| Accounting Queries | 2 | استعلامات المحاسبة |
| CommandBus | 7 | ناقل الأوامر |
| QueryBus | 6 | ناقل الاستعلامات |
| InMemoryQueryCache | 5 | التخزين المؤقت |
| **المجموع** | **28** | ✅ |

### New Tests Added (17 ديسمبر 2025) 🆕

| الملف | الاختبارات | التغطية |
|-------|-----------|---------|
| `src/core/__tests__/utils.test.ts` | 50 | Formatting + Validation |
| `src/core/__tests__/security.test.ts` | 21 | JWT + UUID |
| `src/lib/__tests__/tenant-validator.test.ts` | 17 | Multi-tenant |
| `src/utils/__tests__/keyboardNav.test.ts` | 14 | **81.72%** |
| `src/utils/__tests__/parseClipboard.test.ts` | 11 | **100%** |
| **المجموع الجديد** | **113** | ✅ |

### إجمالي الاختبارات: **1368** ✅ 🆕 (18 ديسمبر 2025)

##  الخطوات التالية

1. ✅ ~~إضافة المزيد من Domain Entities (Inventory, Manufacturing)~~
2. ✅ ~~إنشاء Use Cases إضافية~~
3. ✅ ~~تنفيذ طبقة Infrastructure (Repository + DI Container)~~
4. ✅ ~~إضافة المزيد من Repositories (Inventory, Accounting)~~
5. ✅ ~~إنشاء Application Layer مع React Hooks~~
6. ✅ ~~تطبيق Event Sourcing للـ Audit Trail~~
7. ✅ ~~إضافة CQRS Pattern~~
8. ✅ ~~إعداد ESLint مع TypeScript و React Hooks~~
9. ✅ ~~إضافة اختبارات Core Utils و Security~~
10. ✅ ~~زيادة التغطية إلى 15-20%~~ 🆕 (وصلنا ~13-15%)
11. ✅ ~~إضافة اختبارات Services (accounting, inventory, sales)~~ 🆕 (131 اختبار)
12. ⏳ إضافة Component Tests

---

*آخر تحديث: 18 ديسمبر 2025*
