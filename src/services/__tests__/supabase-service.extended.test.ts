/**
 * Supabase Service Extended Tests
 * اختبارات موسعة لخدمة Supabase
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockResolvedValue({ data: [], error: null })
  })),
  getTenantId: vi.fn().mockResolvedValue('test-tenant')
}));

vi.mock('@/lib/performance-monitor', () => ({
  PerformanceMonitor: {
    measure: vi.fn((name, fn) => fn())
  }
}));

// Types
interface Product {
  id: string;
  code: string;
  name: string;
  stock_quantity: number;
  minimum_stock: number;
  cost_price: number;
  sell_price: number;
}

interface StockMovement {
  id: string;
  item_id: string;
  movement_type: 'in' | 'out' | 'adjustment';
  quantity: number;
  notes?: string;
  created_by: string;
}

interface ManufacturingOrder {
  id: string;
  order_number: string;
  product_id: string;
  quantity: number;
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled';
}

// ===================== STOCK QUANTITY CALCULATIONS =====================

describe('Stock Quantity Calculations', () => {
  const calculateNewStock = (
    currentStock: number,
    quantity: number,
    movementType: 'in' | 'out' | 'adjustment'
  ) => {
    switch (movementType) {
      case 'in':
        return currentStock + quantity;
      case 'out':
        return currentStock - quantity;
      case 'adjustment':
        return quantity; // Direct replacement
      default:
        return currentStock;
    }
  };

  const validateStockMovement = (
    currentStock: number,
    quantity: number,
    movementType: 'in' | 'out'
  ) => {
    if (quantity <= 0) {
      return { valid: false, error: 'Quantity must be positive' };
    }
    if (movementType === 'out' && quantity > currentStock) {
      return { valid: false, error: 'Insufficient stock' };
    }
    return { valid: true };
  };

  it('should calculate stock for incoming movement', () => {
    expect(calculateNewStock(100, 50, 'in')).toBe(150);
  });

  it('should calculate stock for outgoing movement', () => {
    expect(calculateNewStock(100, 30, 'out')).toBe(70);
  });

  it('should set stock directly for adjustment', () => {
    expect(calculateNewStock(100, 75, 'adjustment')).toBe(75);
  });

  it('should validate positive quantity', () => {
    const result = validateStockMovement(100, 0, 'out');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('positive');
  });

  it('should validate sufficient stock for outgoing', () => {
    const result = validateStockMovement(50, 100, 'out');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Insufficient');
  });

  it('should pass valid outgoing movement', () => {
    const result = validateStockMovement(100, 50, 'out');
    expect(result.valid).toBe(true);
  });
});

// ===================== LOW STOCK DETECTION =====================

describe('Low Stock Detection', () => {
  const products: Product[] = [
    { id: '1', code: 'P001', name: 'Product A', stock_quantity: 10, minimum_stock: 20, cost_price: 50, sell_price: 75 },
    { id: '2', code: 'P002', name: 'Product B', stock_quantity: 50, minimum_stock: 30, cost_price: 100, sell_price: 150 },
    { id: '3', code: 'P003', name: 'Product C', stock_quantity: 0, minimum_stock: 10, cost_price: 25, sell_price: 40 },
    { id: '4', code: 'P004', name: 'Product D', stock_quantity: 100, minimum_stock: 100, cost_price: 200, sell_price: 300 }
  ];

  const getLowStockProducts = () => {
    return products.filter(p => p.stock_quantity <= p.minimum_stock);
  };

  const getOutOfStockProducts = () => {
    return products.filter(p => p.stock_quantity === 0);
  };

  const getStockStatus = (product: Product): 'ok' | 'low' | 'out' => {
    if (product.stock_quantity === 0) return 'out';
    if (product.stock_quantity <= product.minimum_stock) return 'low';
    return 'ok';
  };

  const calculateReorderQuantity = (product: Product, targetStock?: number) => {
    const target = targetStock || product.minimum_stock * 2;
    return Math.max(0, target - product.stock_quantity);
  };

  it('should identify low stock products', () => {
    const lowStock = getLowStockProducts();
    expect(lowStock.length).toBe(3); // P001, P003, P004
    expect(lowStock.map(p => p.code)).toContain('P001');
    expect(lowStock.map(p => p.code)).not.toContain('P002');
  });

  it('should identify out of stock products', () => {
    const outOfStock = getOutOfStockProducts();
    expect(outOfStock.length).toBe(1);
    expect(outOfStock[0].code).toBe('P003');
  });

  it('should return correct stock status', () => {
    expect(getStockStatus(products[0])).toBe('low');
    expect(getStockStatus(products[1])).toBe('ok');
    expect(getStockStatus(products[2])).toBe('out');
  });

  it('should calculate reorder quantity', () => {
    expect(calculateReorderQuantity(products[0])).toBe(30); // target 40, current 10
    expect(calculateReorderQuantity(products[2])).toBe(20); // target 20, current 0
    expect(calculateReorderQuantity(products[1])).toBe(10); // target 60, current 50
  });
});

// ===================== MANUFACTURING ORDER STATUS =====================

describe('Manufacturing Order Status', () => {
  type OrderStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

  const statusTransitions: Record<OrderStatus, OrderStatus[]> = {
    draft: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    cancelled: []
  };

  const canTransition = (from: OrderStatus, to: OrderStatus) => {
    return statusTransitions[from]?.includes(to) || false;
  };

  const getStatusLabel = (status: OrderStatus, isRTL = false) => {
    const labels: Record<OrderStatus, { en: string; ar: string }> = {
      draft: { en: 'Draft', ar: 'مسودة' },
      in_progress: { en: 'In Progress', ar: 'قيد التنفيذ' },
      completed: { en: 'Completed', ar: 'مكتمل' },
      cancelled: { en: 'Cancelled', ar: 'ملغي' }
    };
    return isRTL ? labels[status].ar : labels[status].en;
  };

  const getStatusColor = (status: OrderStatus) => {
    const colors: Record<OrderStatus, string> = {
      draft: 'gray',
      in_progress: 'blue',
      completed: 'green',
      cancelled: 'red'
    };
    return colors[status];
  };

  it('should allow valid transitions from draft', () => {
    expect(canTransition('draft', 'in_progress')).toBe(true);
    expect(canTransition('draft', 'cancelled')).toBe(true);
    expect(canTransition('draft', 'completed')).toBe(false);
  });

  it('should prevent transitions from terminal states', () => {
    expect(canTransition('completed', 'draft')).toBe(false);
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('cancelled', 'in_progress')).toBe(false);
  });

  it('should return correct labels', () => {
    expect(getStatusLabel('draft', false)).toBe('Draft');
    expect(getStatusLabel('in_progress', true)).toBe('قيد التنفيذ');
  });

  it('should return correct colors', () => {
    expect(getStatusColor('completed')).toBe('green');
    expect(getStatusColor('cancelled')).toBe('red');
  });
});

// ===================== SUPPLIER SERVICE =====================

describe('Supplier Service', () => {
  interface Supplier {
    id: string;
    code: string;
    name: string;
    contact_person?: string;
    phone?: string;
    email?: string;
    is_active: boolean;
    payment_terms?: number;
    credit_limit?: number;
  }

  const suppliers: Supplier[] = [
    { id: 's1', code: 'SUP-001', name: 'Supplier A', is_active: true, payment_terms: 30, credit_limit: 50000 },
    { id: 's2', code: 'SUP-002', name: 'Supplier B', is_active: true, payment_terms: 45, credit_limit: 100000 },
    { id: 's3', code: 'SUP-003', name: 'Supplier C', is_active: false, payment_terms: 15 }
  ];

  const getActiveSuppliers = () => suppliers.filter(s => s.is_active);

  const validateSupplier = (supplier: Partial<Supplier>) => {
    const errors: string[] = [];
    if (!supplier.code) errors.push('Code is required');
    if (!supplier.name) errors.push('Name is required');
    if (supplier.code && !/^SUP-\d{3}$/.test(supplier.code)) {
      errors.push('Code must be in format SUP-XXX');
    }
    return { valid: errors.length === 0, errors };
  };

  const searchSuppliers = (query: string) => {
    const lower = query.toLowerCase();
    return suppliers.filter(s =>
      s.code.toLowerCase().includes(lower) ||
      s.name.toLowerCase().includes(lower)
    );
  };

  it('should get active suppliers', () => {
    const active = getActiveSuppliers();
    expect(active.length).toBe(2);
  });

  it('should validate supplier code format', () => {
    const invalid = validateSupplier({ code: 'INVALID', name: 'Test' });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain('Code must be in format SUP-XXX');
  });

  it('should search suppliers by name', () => {
    const results = searchSuppliers('supplier a');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('s1');
  });
});

// ===================== CUSTOMER SERVICE =====================

describe('Customer Service', () => {
  interface Customer {
    id: string;
    code: string;
    name: string;
    credit_limit: number;
    current_balance: number;
    is_active: boolean;
  }

  const customers: Customer[] = [
    { id: 'c1', code: 'CUS-001', name: 'Customer A', credit_limit: 100000, current_balance: 50000, is_active: true },
    { id: 'c2', code: 'CUS-002', name: 'Customer B', credit_limit: 50000, current_balance: 48000, is_active: true },
    { id: 'c3', code: 'CUS-003', name: 'Customer C', credit_limit: 25000, current_balance: 30000, is_active: true }
  ];

  const getAvailableCredit = (customer: Customer) => {
    return Math.max(0, customer.credit_limit - customer.current_balance);
  };

  const canApproveOrder = (customer: Customer, orderAmount: number) => {
    const available = getAvailableCredit(customer);
    return orderAmount <= available;
  };

  const getCreditWarningLevel = (customer: Customer): 'ok' | 'warning' | 'critical' | 'exceeded' => {
    const usage = customer.current_balance / customer.credit_limit;
    if (usage > 1) return 'exceeded';
    if (usage >= 0.9) return 'critical';
    if (usage >= 0.75) return 'warning';
    return 'ok';
  };

  it('should calculate available credit', () => {
    expect(getAvailableCredit(customers[0])).toBe(50000);
    expect(getAvailableCredit(customers[2])).toBe(0); // exceeded
  });

  it('should approve order within credit', () => {
    expect(canApproveOrder(customers[0], 25000)).toBe(true);
    expect(canApproveOrder(customers[0], 75000)).toBe(false);
  });

  it('should return correct credit warning level', () => {
    expect(getCreditWarningLevel(customers[0])).toBe('ok'); // 50%
    expect(getCreditWarningLevel(customers[1])).toBe('critical'); // 96%
    expect(getCreditWarningLevel(customers[2])).toBe('exceeded'); // 120%
  });
});

// ===================== ORDER NUMBER GENERATION =====================

describe('Order Number Generation', () => {
  const generateOrderNumber = (prefix: string, sequence: number) => {
    return `${prefix}-${String(sequence).padStart(6, '0')}`;
  };

  const parseOrderNumber = (orderNumber: string) => {
    const match = orderNumber.match(/^([A-Z]+)-(\d{6})$/);
    if (!match) return null;
    return { prefix: match[1], sequence: parseInt(match[2]) };
  };

  const incrementOrderNumber = (lastNumber: string) => {
    const parsed = parseOrderNumber(lastNumber);
    if (!parsed) return null;
    return generateOrderNumber(parsed.prefix, parsed.sequence + 1);
  };

  it('should generate correct format', () => {
    expect(generateOrderNumber('PO', 1)).toBe('PO-000001');
    expect(generateOrderNumber('SO', 12345)).toBe('SO-012345');
    expect(generateOrderNumber('MO', 999999)).toBe('MO-999999');
  });

  it('should parse order number', () => {
    const parsed = parseOrderNumber('PO-001234');
    expect(parsed?.prefix).toBe('PO');
    expect(parsed?.sequence).toBe(1234);
  });

  it('should return null for invalid format', () => {
    expect(parseOrderNumber('invalid')).toBeNull();
    expect(parseOrderNumber('PO-12345')).toBeNull(); // wrong digits
    expect(parseOrderNumber('123-000001')).toBeNull(); // numeric prefix
  });

  it('should increment order number', () => {
    expect(incrementOrderNumber('PO-000001')).toBe('PO-000002');
    expect(incrementOrderNumber('SO-099999')).toBe('SO-100000');
  });
});

// ===================== BATCH OPERATIONS =====================

describe('Batch Operations', () => {
  interface BatchResult<T> {
    success: T[];
    failed: { item: T; error: string }[];
  }

  const processBatch = <T>(
    items: T[],
    validator: (item: T) => { valid: boolean; error?: string }
  ): BatchResult<T> => {
    const result: BatchResult<T> = { success: [], failed: [] };

    for (const item of items) {
      const validation = validator(item);
      if (validation.valid) {
        result.success.push(item);
      } else {
        result.failed.push({ item, error: validation.error || 'Unknown error' });
      }
    }

    return result;
  };

  it('should separate successful and failed items', () => {
    const items = [1, 2, 3, 4, 5];
    const result = processBatch(items, (n) => ({
      valid: n % 2 === 0,
      error: n % 2 !== 0 ? 'Must be even' : undefined
    }));

    expect(result.success).toEqual([2, 4]);
    expect(result.failed.length).toBe(3);
    expect(result.failed[0].error).toBe('Must be even');
  });

  it('should handle all successful', () => {
    const items = [2, 4, 6];
    const result = processBatch(items, () => ({ valid: true }));
    expect(result.success.length).toBe(3);
    expect(result.failed.length).toBe(0);
  });

  it('should handle all failed', () => {
    const items = [1, 3, 5];
    const result = processBatch(items, () => ({ valid: false, error: 'Invalid' }));
    expect(result.success.length).toBe(0);
    expect(result.failed.length).toBe(3);
  });
});

// ===================== PRICE CALCULATIONS =====================

describe('Price Calculations', () => {
  const calculateLineTotal = (quantity: number, unitPrice: number) => {
    return quantity * unitPrice;
  };

  const applyDiscount = (amount: number, discountPercentage: number) => {
    return amount * (1 - discountPercentage / 100);
  };

  const calculateTax = (amount: number, taxPercentage: number) => {
    return amount * (taxPercentage / 100);
  };

  const calculateGrandTotal = (
    subtotal: number,
    discountPercentage: number,
    taxPercentage: number
  ) => {
    const afterDiscount = applyDiscount(subtotal, discountPercentage);
    const tax = calculateTax(afterDiscount, taxPercentage);
    return {
      subtotal,
      discountAmount: subtotal - afterDiscount,
      afterDiscount,
      taxAmount: tax,
      grandTotal: afterDiscount + tax
    };
  };

  it('should calculate line total', () => {
    expect(calculateLineTotal(10, 100)).toBe(1000);
    expect(calculateLineTotal(5.5, 20)).toBe(110);
  });

  it('should apply discount', () => {
    expect(applyDiscount(1000, 10)).toBe(900);
    expect(applyDiscount(1000, 0)).toBe(1000);
    expect(applyDiscount(1000, 100)).toBe(0);
  });

  it('should calculate tax', () => {
    expect(calculateTax(1000, 15)).toBe(150);
    expect(calculateTax(900, 15)).toBe(135);
  });

  it('should calculate complete totals', () => {
    const result = calculateGrandTotal(1000, 10, 15);
    expect(result.subtotal).toBe(1000);
    expect(result.discountAmount).toBe(100);
    expect(result.afterDiscount).toBe(900);
    expect(result.taxAmount).toBe(135);
    expect(result.grandTotal).toBe(1035);
  });
});

// ===================== DATE HANDLING =====================

describe('Date Handling', () => {
  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString().split('T')[0];
  };

  const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  const calculateDueDate = (invoiceDate: Date, paymentTerms: number) => {
    return addDays(invoiceDate, paymentTerms);
  };

  const isOverdue = (dueDate: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    return due < today;
  };

  const getDaysOverdue = (dueDate: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    const diff = today.getTime() - due.getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  };

  it('should format date correctly', () => {
    expect(formatDate(new Date('2024-01-15T10:00:00Z'))).toBe('2024-01-15');
    expect(formatDate('2024-01-15')).toBe('2024-01-15');
  });

  it('should add days correctly', () => {
    const date = new Date('2024-01-15');
    const result = addDays(date, 30);
    expect(formatDate(result)).toBe('2024-02-14');
  });

  it('should calculate due date', () => {
    const invoiceDate = new Date('2024-01-01');
    const dueDate = calculateDueDate(invoiceDate, 30);
    expect(formatDate(dueDate)).toBe('2024-01-31');
  });

  it('should detect overdue correctly', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    expect(isOverdue(pastDate)).toBe(true);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    expect(isOverdue(futureDate)).toBe(false);
  });
});

// ===================== PAGINATION =====================

describe('Pagination', () => {
  const paginate = <T>(items: T[], page: number, pageSize: number) => {
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedItems = items.slice(startIndex, endIndex);
    const totalPages = Math.ceil(items.length / pageSize);

    return {
      items: paginatedItems,
      page,
      pageSize,
      totalItems: items.length,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    };
  };

  const items = Array.from({ length: 95 }, (_, i) => ({ id: i + 1 }));

  it('should paginate correctly', () => {
    const result = paginate(items, 1, 10);
    expect(result.items.length).toBe(10);
    expect(result.totalPages).toBe(10);
    expect(result.hasNextPage).toBe(true);
    expect(result.hasPrevPage).toBe(false);
  });

  it('should handle last page', () => {
    const result = paginate(items, 10, 10);
    expect(result.items.length).toBe(5);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPrevPage).toBe(true);
  });

  it('should handle empty items', () => {
    const result = paginate([], 1, 10);
    expect(result.items.length).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});

// ===================== ERROR HANDLING =====================

describe('Error Handling', () => {
  interface ServiceError {
    code: string;
    message: string;
    details?: Record<string, any>;
  }

  const createError = (code: string, message: string, details?: Record<string, any>): ServiceError => ({
    code,
    message,
    details
  });

  const isNotFoundError = (error: ServiceError) => error.code === 'NOT_FOUND';
  const isValidationError = (error: ServiceError) => error.code === 'VALIDATION_ERROR';
  const isAuthError = (error: ServiceError) => error.code === 'AUTH_ERROR' || error.code === 'UNAUTHORIZED';

  const getErrorMessage = (error: ServiceError, isRTL = false) => {
    const messages: Record<string, { en: string; ar: string }> = {
      NOT_FOUND: { en: 'Resource not found', ar: 'المورد غير موجود' },
      VALIDATION_ERROR: { en: 'Validation failed', ar: 'فشل التحقق' },
      AUTH_ERROR: { en: 'Authentication required', ar: 'المصادقة مطلوبة' },
      UNAUTHORIZED: { en: 'Access denied', ar: 'الوصول مرفوض' }
    };
    return messages[error.code]?.[isRTL ? 'ar' : 'en'] || error.message;
  };

  it('should create error with details', () => {
    const error = createError('VALIDATION_ERROR', 'Invalid data', { field: 'email' });
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.field).toBe('email');
  });

  it('should identify error types', () => {
    expect(isNotFoundError(createError('NOT_FOUND', 'test'))).toBe(true);
    expect(isValidationError(createError('VALIDATION_ERROR', 'test'))).toBe(true);
    expect(isAuthError(createError('AUTH_ERROR', 'test'))).toBe(true);
    expect(isAuthError(createError('UNAUTHORIZED', 'test'))).toBe(true);
  });

  it('should get localized error message', () => {
    const error = createError('NOT_FOUND', 'test');
    expect(getErrorMessage(error, false)).toBe('Resource not found');
    expect(getErrorMessage(error, true)).toBe('المورد غير موجود');
  });
});
