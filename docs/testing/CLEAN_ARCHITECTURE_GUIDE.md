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
 domain/                      #  طبقة المجال (Pure Business Logic)
    entities/                # كيانات المجال
       CostBreakdown.ts     # تحليل التكاليف
       ProcessStage.ts      # مراحل التصنيع
       index.ts
    interfaces/              # المنافذ (Ports)
       IProcessCostingRepository.ts
       index.ts
    use-cases/               # حالات الاستخدام
       CalculateProcessCost.ts
       index.ts
    value-objects/           # كائنات القيمة (Immutable)
       Money.ts
       Quantity.ts
       HourlyRate.ts
       index.ts
    __tests__/               # اختبارات المجال
        cost-breakdown.test.ts
        process-stage.test.ts
        calculate-process-cost.test.ts
 infrastructure/              #  طبقة البنية التحتية
    repositories/            # تنفيذات Repository
       SupabaseProcessCostingRepository.ts
    di/                      # حاوية حقن التبعيات
        container.ts
 services/                    # طبقة الخدمات
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

| الملف | الاختبارات |
|-------|-----------|
| cost-breakdown.test.ts | 17 |
| process-stage.test.ts | 14 |
| calculate-process-cost.test.ts | 6 |
| **المجموع** | **37** |

##  الخطوات التالية

1. إضافة المزيد من Domain Entities (Inventory, Manufacturing)
2. إنشاء Use Cases إضافية
3. تطبيق Event Sourcing للـ Audit Trail
4. إضافة CQRS Pattern

---

*آخر تحديث: 11 ديسمبر 2025*
