# 📊 خطة Test Coverage الشاملة - Wardah ERP (النسخة النهائية)

## 📋 ملخص تنفيذي

**الهدف النهائي**: الوصول إلى **85%+ Test Coverage** مع تغطية كاملة للامتثال المحاسبي والرقابة الداخلية

**الوضع الحالي**: 

- Coverage: **0.0%** (مطلوب: ≥ 80.0%)
- Lines of Code: **94k**
- Test Framework: ✅ Vitest + Playwright (جاهز)
- Existing Tests: 19 ملف (أساسية فقط)

**المدة المتوقعة**: **5 أسابيع** (بدلاً من 4)

- **Week 0.5**: Foundation & Compliance
- **Week 1-2**: Core + Business Logic
- **Week 3**: Integration & Reports
- **Week 4**: Components & E2E
- **Week 5**: Polish & Documentation

**الأولوية**: 🔴 **حرجة جداً**

---

## 🎯 الأهداف المحدثة

### الأهداف الرئيسية

1. ✅ الوصول إلى **85%+ Coverage** للـ New Code
2. ✅ **100% Coverage** للـ Compliance & Audit Trail
3. ✅ **95%+ Coverage** للـ Financial Reports
4. ✅ **90%+ Coverage** للـ Core Business Logic
5. ✅ **85%+ Coverage** للـ Security Functions
6. ✅ ضمان الامتثال للمعايير المحاسبية (IFRS/GAAP/SOCPA)

### الأهداف الثانوية

- توثيق Business Logic من خلال Tests
- بناء Audit Trail كامل ومحمي
- ضمان Internal Controls (SOX/Segregation of Duties)
- تسهيل Regulatory Audits

---

## 📊 الجدول الزمني المحدث (5 أسابيع)

### ⭐ Week 0.5: Foundation, Compliance & Controls (3-4 أيام)

**الهدف**: إنشاء الأساس المحاسبي والرقابي

**Coverage المتوقع**: +12%

#### المهام:

```
✅ Setup test infrastructure enhancements
✅ Accounting Standards Compliance Tests
✅ Audit Trail & Logging Tests
✅ Internal Controls Tests
✅ Authorization & Segregation of Duties Tests
```

#### الملفات المستهدفة:

##### 1. **Compliance Tests**

```typescript
// tests/compliance/ifrs-compliance.test.ts
describe('IFRS/GAAP Compliance', () => {
  describe('IAS 2 - Inventory Valuation', () => {
    it('should use lower of cost or NRV', async () => {
      const inventory = { cost: 100, nrv: 90 };
      expect(await valuateInventory(inventory)).toBe(90);
    });
    
    it('should reverse write-downs when NRV increases', async () => {
      // Test write-down reversal
    });
    
    it('should exclude abnormal waste from cost', async () => {
      // Test abnormal waste accounting
    });
  });
  
  describe('IAS 16 - Property, Plant & Equipment', () => {
    it('should depreciate assets using systematic method', async () => {
      const asset = { cost: 100000, residual: 10000, life: 10 };
      expect(await calculateDepreciation(asset)).toBe(9000); // SL method
    });
    
    it('should test for impairment annually', async () => {
      // Test impairment recognition
    });
  });
  
  describe('IAS 23 - Borrowing Costs', () => {
    it('should capitalize qualifying borrowing costs', async () => {
      // Test borrowing cost capitalization
    });
  });
  
  describe('IFRS 15 - Revenue Recognition', () => {
    it('should recognize revenue at control transfer', async () => {
      // Test 5-step revenue model
    });
  });
});

// tests/compliance/socpa-compliance.test.ts (Saudi Standards)
describe('SOCPA Compliance (Saudi Arabia)', () => {
  describe('Zakat & Tax Requirements', () => {
    it('should calculate Zakat base correctly', async () => {
      const zakatBase = await calculateZakatBase(financials);
      // Test Zakat calculation per GAZT rules
    });
    
    it('should maintain VAT records for 6 years', async () => {
      // Test VAT record retention
    });
  });
  
  describe('ZATCA E-Invoicing', () => {
    it('should generate Phase 2 compliant invoices', async () => {
      const invoice = await generateInvoice(data);
      expect(invoice).toHaveProperty('uuid');
      expect(invoice).toHaveProperty('qrCode');
      expect(invoice).toHaveProperty('digitalSignature');
    });
  });
});
```

##### 2. **Audit Trail Tests**

```typescript
// tests/audit/audit-trail.test.ts
describe('Audit Trail', () => {
  describe('Transaction Logging', () => {
    it('should log all GL entry creations', async () => {
      const entry = await createGLEntry(data);
      const log = await getAuditLog(entry.id);
      
      expect(log).toContainEqual({
        action: 'CREATE',
        table: 'gl_entries',
        userId: expect.any(String),
        timestamp: expect.any(Date),
        data: expect.objectContaining(data)
      });
    });
    
    it('should log all modifications with before/after values', async () => {
      await updateGLEntry(id, changes);
      const log = await getAuditLog(id, 'UPDATE');
      
      expect(log.oldValue).toBeDefined();
      expect(log.newValue).toBeDefined();
    });
    
    it('should never allow audit log deletion', async () => {
      await expect(deleteAuditLog(logId))
        .rejects.toThrow('Audit logs are immutable');
    });
    
    it('should maintain complete transaction chain', async () => {
      const chain = await getTransactionChain(invoiceId);
      expect(chain).toContainInSequence([
        'PURCHASE_ORDER',
        'GOODS_RECEIPT',
        'SUPPLIER_INVOICE',
        'PAYMENT'
      ]);
    });
  });
  
  describe('Change Tracking', () => {
    it('should track who, what, when, where for all changes', async () => {
      await updateRecord(id, changes);
      const audit = await getAuditRecord(id);
      
      expect(audit).toEqual({
        who: expect.any(String), // User ID
        what: 'UPDATE', // Action
        when: expect.any(Date), // Timestamp
        where: expect.any(String), // IP Address
        data: expect.objectContaining(changes)
      });
    });
  });
});
```

##### 3. **Internal Controls Tests**

```typescript
// tests/controls/internal-controls.test.ts
describe('Internal Controls', () => {
  describe('Segregation of Duties (SOD)', () => {
    it('should prevent same user from creating and approving PO', async () => {
      const po = await createPO(data, { userId: 'user1' });
      
      await expect(approvePO(po.id, { userId: 'user1' }))
        .rejects.toThrow('SOD Violation: Cannot approve own purchase order');
    });
    
    it('should enforce maker-checker for GL entries', async () => {
      const entry = await createGLEntry(data, { maker: 'user1' });
      expect(entry.status).toBe('PENDING_APPROVAL');
      
      // Same user cannot approve
      await expect(approveGLEntry(entry.id, { checker: 'user1' }))
        .rejects.toThrow('SOD Violation');
      
      // Different user can approve
      await approveGLEntry(entry.id, { checker: 'user2' });
      expect(entry.status).toBe('POSTED');
    });
    
    it('should separate custody and recording', async () => {
      // Warehouse staff can receive but not approve GRN
      // Accountant can approve but not receive
    });
  });
  
  describe('Authorization Limits', () => {
    it('should enforce PO approval hierarchies', async () => {
      const scenarios = [
        { amount: 5000, approver: 'supervisor', expected: true },
        { amount: 50000, approver: 'supervisor', expected: false },
        { amount: 50000, approver: 'manager', expected: true },
        { amount: 500000, approver: 'manager', expected: false },
        { amount: 500000, approver: 'cfo', expected: true }
      ];
      
      for (const scenario of scenarios) {
        const result = await canApprovePO(
          scenario.amount, 
          scenario.approver
        );
        expect(result).toBe(scenario.expected);
      }
    });
    
    it('should enforce payment authorization limits', async () => {
      // Similar tests for payments
    });
  });
  
  describe('Period Lock Controls', () => {
    it('should prevent posting to closed periods', async () => {
      await closePeriod('2024-12');
      
      await expect(createGLEntry({ date: '2024-12-15' }))
        .rejects.toThrow('Period 2024-12 is closed');
    });
    
    it('should allow adjustments with special permission', async () => {
      await closePeriod('2024-12');
      
      const entry = await createGLEntry(
        { date: '2024-12-15' },
        { override: true, userId: 'cfo' }
      );
      
      expect(entry).toBeDefined();
      expect(entry.flags).toContain('OVERRIDE_PERIOD_LOCK');
    });
  });
  
  describe('Data Validation Controls', () => {
    it('should prevent negative inventory', async () => {
      const product = { stock: 10 };
      
      await expect(issueInventory(product.id, 15))
        .rejects.toThrow('Insufficient stock');
    });
    
    it('should prevent unbalanced journal entries', async () => {
      const entry = {
        lines: [
          { account: '1000', debit: 100, credit: 0 },
          { account: '2000', debit: 0, credit: 90 } // Unbalanced!
        ]
      };
      
      await expect(postJournalEntry(entry))
        .rejects.toThrow('Debits must equal credits');
    });
  });
});
```

**Coverage المتوقع**: 12% (أساس قوي)

---

### 📅 Week 1: Core Security & Infrastructure (1 أسبوع)

**الهدف**: +18% Coverage (إجمالي: 30%)

#### المهام:

```
✅ Security functions (sanitize, validate, JWT)
✅ Supabase CRUD operations
✅ Multi-tenant security
✅ Rate limiting & DDoS protection
✅ Utilities & helpers
```

#### الملفات المستهدفة:

```typescript
// tests/core/security.test.ts (15 functions)
// tests/lib/supabase.test.ts (CRUD operations)
// tests/lib/multi-tenant.test.ts (tenant isolation)
// tests/lib/rate-limiter.test.ts (rate limiting)
// tests/lib/utils.test.ts (formatters, validators)
```

**Coverage المتوقع**: 30%

---

### 📅 Week 2: Business Logic - Advanced (1 أسبوع)

**الهدف**: +30% Coverage (إجمالي: 60%)

#### المهام:

```
✅ Process Costing (enhanced with advanced scenarios)
✅ Inventory Valuation (FIFO/LIFO/AVCO/Weighted)
✅ Joint Cost Allocation
✅ Variance Analysis (Material, Labor, Overhead)
✅ Manufacturing Services
✅ Purchasing Services
✅ Cost Allocation Methods
```

#### الملفات المستهدفة:

##### 1. **Process Costing - Advanced**

```typescript
// tests/domain/process-costing-advanced.test.ts
describe('Process Costing - Advanced Scenarios', () => {
  describe('Equivalent Units Calculation', () => {
    it('should calculate equivalent units for all components', async () => {
      const stage = {
        goodQty: 800,
        scrapQty: 100,
        reworkQty: 50,
        wipQty: 200,
        wipCompletion: { materials: 1.0, labor: 0.6, overhead: 0.6 }
      };
      
      const equivalentUnits = await calculateEquivalentUnits(stage);
      
      expect(equivalentUnits).toEqual({
        materials: 1150, // 800 + 100 + 50 + 200
        labor: 1070, // 800 + 100 + 50 + 120
        overhead: 1070
      });
    });
  });
  
  describe('Normal vs Abnormal Spoilage', () => {
    it('should distinguish normal from abnormal spoilage', async () => {
      const stage = {
        totalQty: 1000,
        goodQty: 900,
        spoilage: 100,
        normalRate: 0.05 // 5% acceptable
      };
      
      const result = await analyzeSpoilage(stage);
      
      expect(result.normalSpoilage).toBe(50); // 5% of 1000
      expect(result.abnormalSpoilage).toBe(50);
      expect(result.normalCostPerUnit).toBeGreaterThan(0);
      expect(result.abnormalLoss).toBeGreaterThan(0);
    });
    
    it('should allocate normal spoilage to good units', async () => {
      // Normal spoilage cost absorbed by good units
    });
    
    it('should charge abnormal spoilage to expense', async () => {
      // Abnormal spoilage goes to P&L
    });
  });
  
  describe('Joint Cost Allocation', () => {
    it('should allocate by relative sales value method', async () => {
      const jointProcess = {
        totalCost: 100000,
        splitOffPoint: 'after-processing',
        products: [
          { name: 'A', qty: 100, salesValue: 200 },
          { name: 'B', qty: 150, salesValue: 180 },
          { name: 'C', qty: 50, salesValue: 150 }
        ]
      };
      
      const allocation = await allocateJointCosts(
        jointProcess,
        'RELATIVE_SALES_VALUE'
      );
      
      const totalValue = 100*200 + 150*180 + 50*150; // 54,500
      expect(allocation.A).toBeCloseTo(100000 * (20000/54500), 2);
    });
    
    it('should allocate by physical units method', async () => {
      // Allocate based on output quantity
    });
    
    it('should allocate by NRV method', async () => {
      // Allocate based on net realizable value
    });
  });
  
  describe('Variance Analysis', () => {
    it('should calculate material price variance', async () => {
      // MPV = (AP - SP) × AQ
      const actual = { qty: 1000, price: 11 };
      const standard = { qty: 1000, price: 10 };
      
      const variance = await calculateMaterialPriceVariance(actual, standard);
      expect(variance.amount).toBe(1000); // (11-10)*1000
      expect(variance.type).toBe('UNFAVORABLE');
    });
    
    it('should calculate material quantity variance', async () => {
      // MQV = (AQ - SQ) × SP
    });
    
    it('should calculate labor rate variance', async () => {
      // LRV = (AR - SR) × AH
    });
    
    it('should calculate labor efficiency variance', async () => {
      // LEV = (AH - SH) × SR
    });
    
    it('should calculate overhead variances', async () => {
      // Variable OH spending, efficiency
      // Fixed OH budget, volume
    });
  });
  
  describe('By-Products & Co-Products', () => {
    it('should account for by-products at NRV', async () => {
      // By-product revenue reduces main product cost
    });
    
    it('should distinguish co-products from by-products', async () => {
      // Co-products: significant value
      // By-products: incidental value
    });
  });
});
```

##### 2. **Inventory Valuation - Comprehensive**

```typescript
// tests/domain/inventory-valuation-comprehensive.test.ts
describe('Inventory Valuation - All Methods', () => {
  describe('FIFO Method', () => {
    it('should process incoming stock in FIFO order', async () => {
      // Test FIFO incoming
    });
    
    it('should issue stock from oldest batches first', async () => {
      const product = {
        stock_queue: [
          { qty: 100, rate: 10, date: '2024-01-01' },
          { qty: 150, rate: 12, date: '2024-02-01' },
          { qty: 50, rate: 13, date: '2024-03-01' }
        ]
      };
      
      const result = await issueStock(product, 180, 'FIFO');
      
      // Should take 100 @ 10 + 80 @ 12
      expect(result.cost).toBe(100*10 + 80*12); // 1960
      expect(result.remainingQueue[0]).toEqual({ qty: 70, rate: 12 });
    });
  });
  
  describe('LIFO Method', () => {
    it('should issue stock from newest batches first', async () => {
      // Similar test but LIFO
    });
  });
  
  describe('Weighted Average Method', () => {
    it('should recalculate average after each receipt', async () => {
      let product = { qty: 100, cost: 10, value: 1000 };
      
      // Receipt 1
      product = await receiveStock(product, 50, 12);
      expect(product.cost).toBeCloseTo(10.67, 2); // (1000+600)/150
      
      // Receipt 2
      product = await receiveStock(product, 30, 15);
      expect(product.cost).toBeCloseTo(11.11, 2); // (1600+450)/180
    });
    
    it('should use current average for all issues', async () => {
      const product = { qty: 100, cost: 10.67 };
      const result = await issueStock(product, 20);
      expect(result.cost).toBeCloseTo(213.40, 2); // 20 * 10.67
    });
  });
  
  describe('Specific Identification', () => {
    it('should track individual item costs', async () => {
      // For serialized/unique items
    });
  });
  
  describe('Lower of Cost or NRV', () => {
    it('should write down inventory when NRV < cost', async () => {
      const inventory = {
        qty: 100,
        cost: 50,
        nrv: 45 // Market price dropped
      };
      
      const valuation = await valuateInventory(inventory);
      expect(valuation.value).toBe(100 * 45); // Use NRV
      expect(valuation.writeDown).toBe(100 * 5); // Loss recognized
    });
    
    it('should reverse write-downs when NRV recovers', async () => {
      // But not above original cost
    });
  });
});
```

**Coverage المتوقع**: 60%

---

### 📅 Week 3: Financial Reports & Integration (1 أسبوع)

**الهدف**: +20% Coverage (إجمالي: 80%)

#### المهام:

```
✅ Financial Reports (Trial Balance, Balance Sheet, P&L)
✅ Cost Reports (Cost of Goods Manufactured, Cost of Sales)
✅ Bank Reconciliation
✅ Integration workflows
✅ Multi-tenant data isolation
```

#### الملفات المستهدفة:

##### 1. **Financial Reports Tests**

```typescript
// tests/reports/financial-reports.test.ts
describe('Financial Reports', () => {
  describe('Trial Balance', () => {
    it('should always balance (debits = credits)', async () => {
      const tb = await generateTrialBalance('2024-12-31');
      
      const debits = tb.reduce((sum, acc) => sum + acc.debit, 0);
      const credits = tb.reduce((sum, acc) => sum + acc.credit, 0);
      
      expect(debits).toBe(credits);
    });
    
    it('should match individual GL account balances', async () => {
      const tb = await generateTrialBalance('2024-12-31');
      
      for (const account of tb) {
        const glBalance = await getGLBalance(account.code, '2024-12-31');
        expect(account.balance).toBe(glBalance);
      }
    });
    
    it('should show opening, movement, and closing', async () => {
      const tb = await generateTrialBalance('2024-12-31', {
        showMovement: true
      });
      
      for (const account of tb) {
        expect(account.opening + account.debit - account.credit)
          .toBe(account.closing);
      }
    });
  });
  
  describe('Balance Sheet', () => {
    it('should satisfy accounting equation A = L + E', async () => {
      const bs = await generateBalanceSheet('2024-12-31');
      
      expect(bs.assets.total).toBe(
        bs.liabilities.total + bs.equity.total
      );
    });
    
    it('should classify current vs non-current correctly', async () => {
      const bs = await generateBalanceSheet('2024-12-31');
      
      // Current assets (realizable within 12 months)
      expect(bs.assets.current).toContainAccount('Cash');
      expect(bs.assets.current).toContainAccount('Accounts Receivable');
      expect(bs.assets.current).toContainAccount('Inventory');
      
      // Non-current assets
      expect(bs.assets.nonCurrent).toContainAccount('Property');
      expect(bs.assets.nonCurrent).toContainAccount('Equipment');
    });
    
    it('should show comparative figures', async () => {
      const bs = await generateBalanceSheet('2024-12-31', {
        comparative: '2023-12-31'
      });
      
      expect(bs.assets.current.current).toBeDefined();
      expect(bs.assets.current.prior).toBeDefined();
    });
  });
  
  describe('Income Statement', () => {
    it('should calculate gross profit correctly', async () => {
      const is = await generateIncomeStatement('2024-01-01', '2024-12-31');
      
      const grossProfit = is.revenue - is.costOfSales;
      expect(is.grossProfit).toBe(grossProfit);
    });
    
    it('should calculate operating profit', async () => {
      const is = await generateIncomeStatement('2024-01-01', '2024-12-31');
      
      const operatingProfit = is.grossProfit - is.operatingExpenses;
      expect(is.operatingProfit).toBe(operatingProfit);
    });
    
    it('should show earnings per share', async () => {
      const is = await generateIncomeStatement('2024-01-01', '2024-12-31');
      
      const eps = is.netIncome / is.shares;
      expect(is.eps).toBe(eps);
    });
  });
  
  describe('Statement of Cash Flows', () => {
    it('should reconcile cash movement', async () => {
      const scf = await generateCashFlowStatement('2024-01-01', '2024-12-31');
      
      const cashMovement = scf.operating + scf.investing + scf.financing;
      expect(scf.closingCash - scf.openingCash).toBe(cashMovement);
    });
    
    it('should classify activities correctly', async () => {
      // Operating: day-to-day business
      // Investing: purchase/sale of long-term assets
      // Financing: debt and equity
    });
  });
});

// tests/reports/cost-reports.test.ts
describe('Cost Reports', () => {
  describe('Cost of Goods Manufactured', () => {
    it('should calculate COGM correctly', async () => {
      const cogm = await calculateCOGM('2024-12');
      
      // COGM = Opening WIP + Manufacturing Costs - Closing WIP
      const expected = 
        cogm.openingWIP +
        cogm.directMaterials +
        cogm.directLabor +
        cogm.manufacturingOverhead -
        cogm.closingWIP;
      
      expect(cogm.total).toBe(expected);
    });
  });
  
  describe('Cost of Goods Sold', () => {
    it('should calculate COGS correctly', async () => {
      const cogs = await calculateCOGS('2024-12');
      
      // COGS = Opening FG + COGM - Closing FG
      const expected =
        cogs.openingFinishedGoods +
        cogs.costOfGoodsManufactured -
        cogs.closingFinishedGoods;
      
      expect(cogs.total).toBe(expected);
    });
  });
});
```

##### 2. **Bank Reconciliation Tests**

```typescript
// tests/integration/bank-reconciliation.test.ts
describe('Bank Reconciliation', () => {
  it('should match bank statement with cash book', async () => {
    const bankStatement = [
      { date: '2024-12-01', amount: 1000, ref: 'DEP001' },
      { date: '2024-12-02', amount: -500, ref: 'CHQ001' }
    ];
    
    const reconciliation = await reconcileBank(
      'bank-account-1',
      bankStatement,
      '2024-12-01',
      '2024-12-31'
    );
    
    expect(reconciliation.matched).toHaveLength(2);
    expect(reconciliation.unmatched.bank).toHaveLength(0);
    expect(reconciliation.unmatched.book).toHaveLength(0);
  });
  
  it('should identify timing differences', async () => {
    // Outstanding checks, deposits in transit
  });
  
  it('should identify errors', async () => {
    // Bank errors, book errors
  });
});
```

**Coverage المتوقع**: 80%

---

### 📅 Week 4: Components & E2E (1 أسبوع)

**الهدف**: +10% Coverage (إجمالي: 90%)

#### المهام:

```
✅ Critical Forms (PO, Invoice, GRN)
✅ UI Components
✅ E2E workflows
✅ Performance testing
```

#### الملفات المستهدفة:

```typescript
// tests/components/forms/*.test.tsx
// tests/e2e/*.spec.ts
```

**Coverage المتوقع**: 90%

---

### 📅 Week 5: Polish & Documentation (3-4 أيام)

**الهدف**: Fill gaps + Documentation

#### المهام:

```
✅ Fill remaining coverage gaps
✅ Edge cases
✅ Performance optimization
✅ Test documentation
✅ Final verification
```

**Coverage المتوقع**: 85%+

---

## 📊 Coverage Targets النهائية

| الفئة | الهدف | الأولوية | Notes |
|------|-------|----------|-------|
| **Compliance & Audit** | 100% | 🔴 Critical | إلزامي قانوناً |
| **Security** | 95% | 🔴 Critical | حماية البيانات |
| **Financial Reports** | 95% | 🔴 Critical | دقة مالية |
| **Business Logic** | 90% | 🔴 Critical | جوهر النظام |
| **Internal Controls** | 95% | 🟡 High | SOX/رقابة |
| **Services** | 85% | 🟡 High | CRUD + Logic |
| **Components** | 75% | 🟢 Medium | UI Testing |
| **Utils & Helpers** | 85% | 🟢 Medium | Support functions |

**Overall Target**: **85%+**

---

## 🎯 Success Metrics

### Coverage Metrics

- ✅ Lines: ≥ 85%
- ✅ Functions: ≥ 85%
- ✅ Branches: ≥ 80%
- ✅ Statements: ≥ 85%

### Quality Metrics

- ✅ Compliance Tests: 100%
- ✅ Audit Trail Tests: 100%
- ✅ Security Tests: 95%+
- ✅ Financial Reports: 95%+
- ✅ Test Pass Rate: ≥ 99%
- ✅ Flaky Tests: 0

### Business Metrics

- ✅ IFRS/GAAP Compliance: Verified
- ✅ SOX Controls: Implemented
- ✅ Audit Trail: Complete & Immutable
- ✅ Segregation of Duties: Enforced

---

## ⚡ Quick Start (يوم واحد)

### Setup

```bash
# 1. Verify test environment
npm run test

# 2. Create test structure
mkdir -p tests/{compliance,audit,controls,reports}

# 3. Copy example tests from this plan

# 4. Run first compliance test
npm run test tests/compliance/ifrs-compliance.test.ts
```

---

## 📋 Weekly Checklist

### Week 0.5 ✅

- [ ] IFRS compliance tests
- [ ] SOCPA compliance tests
- [ ] Audit trail tests
- [ ] Internal controls tests
- [ ] SOD tests
- [ ] Verify: Coverage ≥ 12%

### Week 1 ✅

- [ ] Security functions tests
- [ ] Supabase CRUD tests
- [ ] Multi-tenant tests
- [ ] Rate limiter tests
- [ ] Utils tests
- [ ] Verify: Coverage ≥ 30%

### Week 2 ✅

- [ ] Process costing advanced
- [ ] Inventory valuation comprehensive
- [ ] Joint cost allocation
- [ ] Variance analysis
- [ ] Manufacturing services
- [ ] Purchasing services
- [ ] Verify: Coverage ≥ 60%

### Week 3 ✅

- [ ] Trial balance tests
- [ ] Balance sheet tests
- [ ] Income statement tests
- [ ] Cash flow tests
- [ ] Cost reports tests
- [ ] Bank reconciliation
- [ ] Integration tests
- [ ] Verify: Coverage ≥ 80%

### Week 4 ✅

- [ ] Forms components tests
- [ ] UI components tests
- [ ] E2E critical paths
- [ ] Performance tests
- [ ] Verify: Coverage ≥ 90%

### Week 5 ✅

- [ ] Fill coverage gaps
- [ ] Edge cases
- [ ] Test documentation
- [ ] Final verification: Coverage ≥ 85%

---

## 🚨 Critical Path Tests (أولوية قصوى)

### 1. Compliance Tests (Week 0.5)

```typescript
// These MUST pass for legal/regulatory compliance
- IAS 2: Inventory valuation ✅
- IAS 16: PPE depreciation ✅
- IFRS 15: Revenue recognition ✅
- ZATCA: E-invoicing ✅
- Zakat calculation ✅
```

### 2. Audit Trail Tests (Week 0.5)

```typescript
// These MUST pass for audit requirements
- All modifications logged ✅
- Logs are immutable ✅
- Transaction chains complete ✅
- Who/What/When/Where tracked ✅
```

### 3. Internal Controls Tests (Week 0.5)

```typescript
// These MUST pass for SOX/governance
- SOD enforced ✅
- Authorization limits enforced ✅
- Period locks enforced ✅
- Data validation enforced ✅
```

### 4. Financial Reports Tests (Week 3)

```typescript
// These MUST pass for accuracy
- Trial balance always balances ✅
- Balance sheet equation holds ✅
- P&L calculations correct ✅
- Cash flow reconciles ✅
```

---

## 🛠️ Test Infrastructure

### Enhanced Setup File

```typescript
// tests/setup.ts
import { afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => mockSupabaseClient,
  getEffectiveTenantId: () => Promise.resolve('test-tenant-id')
}));

// Mock Audit Logger
vi.mock('@/lib/audit-logger', () => ({
  logAuditEvent: vi.fn()
}));

// Global test helpers
global.createTestUser = (overrides = {}) => ({
  id: 'test-user-id',
  role: 'accountant',
  tenantId: 'test-tenant-id',
  ...overrides
});

global.createTestGLEntry = (overrides = {}) => ({
  id: 'test-entry-id',
  date: '2024-12-01',
  lines: [
    { account: '1000', debit: 100, credit: 0 },
    { account: '4000', debit: 0, credit: 100 }
  ],
  ...overrides
});

// Cleanup after each test
afterEach(() => {
  vi.clearAllMocks();
});
```

### Test Utilities

```typescript
// tests/utils.ts

// Mock factories
export const factories = {
  glAccount: (overrides = {}) => ({
    id: 'test-id',
    code: '1000',
    name: 'Cash',
    category: 'ASSET',
    ...overrides
  }),
  
  product: (overrides = {}) => ({
    id: 'test-product-id',
    code: 'PROD001',
    stock_quantity: 100,
    cost_price: 10,
    valuation_method: 'AVCO',
    ...overrides
  }),
  
  purchaseOrder: (overrides = {}) => ({
    id: 'test-po-id',
    supplier_id: 'test-supplier-id',
    status: 'DRAFT',
    items: [],
    ...overrides
  })
};

// Assertion helpers
export const assertions = {
  toBalanceDebitsCredits: (entry) => {
    const debits = entry.lines.reduce((sum, l) => sum + l.debit, 0);
    const credits = entry.lines.reduce((sum, l) => sum + l.credit, 0);
    expect(debits).toBe(credits);
  },
  
  toBeValidGLEntry: (entry) => {
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('date');
    expect(entry).toHaveProperty('lines');
    expect(entry.lines.length).toBeGreaterThan(0);
    assertions.toBalanceDebitsCredits(entry);
  }
};
```

---

## 📊 Progress Tracking

### Weekly Coverage Goals

| Week | Target | Actual | Status | Notes |
|------|--------|--------|--------|-------|
| 0.5  | 12%    | ___%   | ⏳     | Compliance foundation |
| 1    | 30%    | ___%   | ⏳     | Core security |
| 2    | 60%    | ___%   | ⏳     | Business logic |
| 3    | 80%    | ___%   | ⏳     | Reports + integration |
| 4    | 90%    | ___%   | ⏳     | Components + E2E |
| 5    | 85%+   | ___%   | ⏳     | Polish |

### Daily Progress Log

```markdown
## Week 0.5 - Day 1
- [ ] Created IFRS compliance tests
- [ ] Coverage: ___%

## Week 0.5 - Day 2
- [ ] Created SOCPA compliance tests
- [ ] Coverage: ___%

## Week 0.5 - Day 3
- [ ] Created audit trail tests
- [ ] Coverage: ___%

## Week 0.5 - Day 4
- [ ] Created internal controls tests
- [ ] Week 0.5 complete: Coverage ___%
```

---

## 🎓 Best Practices

### 1. Test Naming Convention

```typescript
// ✅ Good: Descriptive, behavior-focused
it('should prevent posting to closed period when user lacks override permission')

// ❌ Bad: Vague, implementation-focused
it('test period lock')
```

### 2. Arrange-Act-Assert Pattern

```typescript
it('should calculate COGM correctly', async () => {
  // Arrange: Setup test data
  const wipOpening = 10000;
  const materialCosts = 50000;
  const laborCosts = 30000;
  const overheadCosts = 20000;
  const wipClosing = 15000;
  
  // Act: Execute the function
  const cogm = await calculateCOGM({
    wipOpening,
    materialCosts,
    laborCosts,
    overheadCosts,
    wipClosing
  });
  
  // Assert: Verify the result
  const expected = wipOpening + materialCosts + laborCosts + overheadCosts - wipClosing;
  expect(cogm.total).toBe(expected);
});
```

### 3. Test Independence

```typescript
// ✅ Good: Each test is independent
describe('GL Account CRUD', () => {
  beforeEach(async () => {
    // Fresh database state for each test
    await clearTestData();
    await seedTestData();
  });
  
  it('should create account', async () => {
    // Test...
  });
  
  it('should update account', async () => {
    // Test...
  });
});
```

### 4. Mock External Dependencies Only

```typescript
// ✅ Good: Mock external services
vi.mock('@/lib/supabase');
vi.mock('axios'); // External API

// ❌ Bad: Don't mock internal business logic
// vi.mock('@/domain/process-costing'); // NO!
```

---

## 🚀 CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test-coverage.yml
name: Test Coverage

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test-coverage:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests with coverage
        run: npm run test:coverage
      
      - name: Coverage threshold check
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 85" | bc -l) )); then
            echo "❌ Coverage $COVERAGE% is below 85% threshold"
            exit 1
          else
            echo "✅ Coverage $COVERAGE% meets threshold"
          fi
      
      - name: Upload to SonarQube
        uses: sonarsource/sonarqube-scan-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
      
      - name: SonarQube Quality Gate
        uses: sonarsource/sonarqube-quality-gate-action@master
        timeout-minutes: 5
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

---

## 📚 Resources & References

### Internal Documentation

- `docs/testing-strategy.md` - Overall testing strategy
- `docs/compliance-requirements.md` - Accounting standards
- `docs/audit-requirements.md` - Audit trail specs

### External References

- [IFRS Standards](https://www.ifrs.org/)
- [SOCPA Standards](https://socpa.org.sa/)
- [ZATCA E-Invoicing](https://zatca.gov.sa/)
- [Vitest Documentation](https://vitest.dev/)

---

## 🎉 Success Criteria

### Technical Success

✅ Coverage ≥ 85%
✅ All tests passing
✅ Quality Gate: PASSED
✅ No flaky tests
✅ Fast test execution (< 10 min)

### Business Success

✅ IFRS/GAAP compliant
✅ SOCPA compliant
✅ Audit trail complete
✅ Internal controls enforced
✅ Ready for external audit

### Regulatory Success

✅ ZATCA e-invoicing compliant
✅ Zakat calculation accurate
✅ VAT reporting correct
✅ Period locking enforced

---

**آخر تحديث**: December 10, 2025  
**الإصدار**: 2.0.0 (Comprehensive Edition)  
**الحالة**: ✅ Ready for Implementation
