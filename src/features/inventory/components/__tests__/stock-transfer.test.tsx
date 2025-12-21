/**
 * Stock Transfer Component Tests
 * اختبارات مكون تحويلات المخزون
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ar' }
  })
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn()
  }
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } })
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1' } }),
      order: vi.fn().mockResolvedValue({ data: [], error: null })
    }))
  }))
}));

vi.mock('@/services/supabase-service', () => ({
  itemsService: {
    getAll: vi.fn().mockResolvedValue([])
  }
}));

// Helper Types
interface StockTransferItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  available_qty: number;
}

interface StockTransfer {
  id?: string;
  transfer_number: string;
  transfer_date: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  notes: string;
  items: StockTransferItem[];
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

// ===================== TRANSFER NUMBER GENERATION =====================

describe('Transfer Number Generation', () => {
  const generateTransferNumber = (sequence: number) => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const paddedSeq = String(sequence).padStart(5, '0');
    return `TRF-${year}${month}-${paddedSeq}`;
  };

  const parseTransferNumber = (number: string) => {
    const match = number.match(/TRF-(\d{4})(\d{2})-(\d{5})/);
    if (!match) return null;
    return {
      year: parseInt(match[1]),
      month: parseInt(match[2]),
      sequence: parseInt(match[3])
    };
  };

  it('should generate correct transfer number format', () => {
    const number = generateTransferNumber(1);
    expect(number).toMatch(/^TRF-\d{6}-\d{5}$/);
  });

  it('should pad sequence correctly', () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    expect(generateTransferNumber(1)).toBe(`TRF-${year}${month}-00001`);
    expect(generateTransferNumber(123)).toBe(`TRF-${year}${month}-00123`);
  });

  it('should parse transfer number correctly', () => {
    const parsed = parseTransferNumber('TRF-202401-00123');
    expect(parsed).toEqual({
      year: 2024,
      month: 1,
      sequence: 123
    });
  });

  it('should return null for invalid format', () => {
    expect(parseTransferNumber('invalid')).toBeNull();
    expect(parseTransferNumber('TRF-2024-123')).toBeNull();
  });
});

// ===================== TRANSFER VALIDATION =====================

describe('Transfer Validation', () => {
  const validateTransfer = (transfer: StockTransfer) => {
    const errors: string[] = [];

    if (!transfer.from_warehouse_id) {
      errors.push('Source warehouse is required');
    }
    if (!transfer.to_warehouse_id) {
      errors.push('Destination warehouse is required');
    }
    if (transfer.from_warehouse_id === transfer.to_warehouse_id) {
      errors.push('Source and destination cannot be the same');
    }
    if (!transfer.transfer_date) {
      errors.push('Transfer date is required');
    }
    if (transfer.items.length === 0) {
      errors.push('At least one item is required');
    }

    // Validate items
    transfer.items.forEach((item, index) => {
      if (item.quantity <= 0) {
        errors.push(`Item ${index + 1}: Quantity must be positive`);
      }
      if (item.quantity > item.available_qty) {
        errors.push(`Item ${index + 1}: Insufficient stock (available: ${item.available_qty})`);
      }
    });

    return { valid: errors.length === 0, errors };
  };

  it('should fail when source warehouse missing', () => {
    const transfer: StockTransfer = {
      transfer_number: 'TRF-001',
      transfer_date: '2024-01-15',
      from_warehouse_id: '',
      to_warehouse_id: 'wh-2',
      status: 'DRAFT',
      notes: '',
      items: [{ id: '1', product_id: 'p1', product_name: 'Product 1', quantity: 10, available_qty: 100 }]
    };

    const result = validateTransfer(transfer);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Source warehouse is required');
  });

  it('should fail when same source and destination', () => {
    const transfer: StockTransfer = {
      transfer_number: 'TRF-001',
      transfer_date: '2024-01-15',
      from_warehouse_id: 'wh-1',
      to_warehouse_id: 'wh-1',
      status: 'DRAFT',
      notes: '',
      items: [{ id: '1', product_id: 'p1', product_name: 'Product 1', quantity: 10, available_qty: 100 }]
    };

    const result = validateTransfer(transfer);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Source and destination cannot be the same');
  });

  it('should fail when no items', () => {
    const transfer: StockTransfer = {
      transfer_number: 'TRF-001',
      transfer_date: '2024-01-15',
      from_warehouse_id: 'wh-1',
      to_warehouse_id: 'wh-2',
      status: 'DRAFT',
      notes: '',
      items: []
    };

    const result = validateTransfer(transfer);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('At least one item is required');
  });

  it('should fail when quantity exceeds available', () => {
    const transfer: StockTransfer = {
      transfer_number: 'TRF-001',
      transfer_date: '2024-01-15',
      from_warehouse_id: 'wh-1',
      to_warehouse_id: 'wh-2',
      status: 'DRAFT',
      notes: '',
      items: [{ id: '1', product_id: 'p1', product_name: 'Product 1', quantity: 150, available_qty: 100 }]
    };

    const result = validateTransfer(transfer);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Insufficient stock');
  });

  it('should pass for valid transfer', () => {
    const transfer: StockTransfer = {
      transfer_number: 'TRF-001',
      transfer_date: '2024-01-15',
      from_warehouse_id: 'wh-1',
      to_warehouse_id: 'wh-2',
      status: 'DRAFT',
      notes: 'Test transfer',
      items: [
        { id: '1', product_id: 'p1', product_name: 'Product 1', quantity: 50, available_qty: 100 },
        { id: '2', product_id: 'p2', product_name: 'Product 2', quantity: 25, available_qty: 50 }
      ]
    };

    const result = validateTransfer(transfer);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});

// ===================== TRANSFER STATUS MANAGEMENT =====================

describe('Transfer Status Management', () => {
  type TransferStatus = 'DRAFT' | 'SUBMITTED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';

  const getStatusBadge = (status: TransferStatus) => {
    const badges: Record<TransferStatus, { label: string; labelAr: string; color: string }> = {
      DRAFT: { label: 'Draft', labelAr: 'مسودة', color: 'gray' },
      SUBMITTED: { label: 'Submitted', labelAr: 'مرسل', color: 'blue' },
      IN_TRANSIT: { label: 'In Transit', labelAr: 'قيد النقل', color: 'yellow' },
      RECEIVED: { label: 'Received', labelAr: 'مستلم', color: 'green' },
      CANCELLED: { label: 'Cancelled', labelAr: 'ملغي', color: 'red' }
    };
    return badges[status];
  };

  const getValidTransitions = (currentStatus: TransferStatus): TransferStatus[] => {
    const transitions: Record<TransferStatus, TransferStatus[]> = {
      DRAFT: ['SUBMITTED', 'CANCELLED'],
      SUBMITTED: ['IN_TRANSIT', 'CANCELLED'],
      IN_TRANSIT: ['RECEIVED', 'CANCELLED'],
      RECEIVED: [],
      CANCELLED: []
    };
    return transitions[currentStatus];
  };

  const canEdit = (status: TransferStatus) => status === 'DRAFT';
  const canDelete = (status: TransferStatus) => status === 'DRAFT';
  const canSubmit = (status: TransferStatus) => status === 'DRAFT';
  const canReceive = (status: TransferStatus) => status === 'IN_TRANSIT';
  const canCancel = (status: TransferStatus) => !['RECEIVED', 'CANCELLED'].includes(status);

  it('should return correct badge for each status', () => {
    expect(getStatusBadge('DRAFT').color).toBe('gray');
    expect(getStatusBadge('RECEIVED').color).toBe('green');
    expect(getStatusBadge('CANCELLED').labelAr).toBe('ملغي');
  });

  it('should return valid transitions from DRAFT', () => {
    const transitions = getValidTransitions('DRAFT');
    expect(transitions).toContain('SUBMITTED');
    expect(transitions).toContain('CANCELLED');
    expect(transitions).not.toContain('RECEIVED');
  });

  it('should return no transitions from terminal states', () => {
    expect(getValidTransitions('RECEIVED').length).toBe(0);
    expect(getValidTransitions('CANCELLED').length).toBe(0);
  });

  it('should allow edit only for DRAFT', () => {
    expect(canEdit('DRAFT')).toBe(true);
    expect(canEdit('SUBMITTED')).toBe(false);
    expect(canEdit('RECEIVED')).toBe(false);
  });

  it('should allow receive only for IN_TRANSIT', () => {
    expect(canReceive('IN_TRANSIT')).toBe(true);
    expect(canReceive('SUBMITTED')).toBe(false);
    expect(canReceive('DRAFT')).toBe(false);
  });

  it('should allow cancel for non-terminal states', () => {
    expect(canCancel('DRAFT')).toBe(true);
    expect(canCancel('SUBMITTED')).toBe(true);
    expect(canCancel('IN_TRANSIT')).toBe(true);
    expect(canCancel('RECEIVED')).toBe(false);
    expect(canCancel('CANCELLED')).toBe(false);
  });
});

// ===================== STOCK CALCULATIONS =====================

describe('Stock Calculations', () => {
  interface WarehouseStock {
    warehouse_id: string;
    product_id: string;
    quantity: number;
  }

  const getAvailableStock = (stocks: WarehouseStock[], warehouseId: string, productId: string) => {
    const stock = stocks.find(s => s.warehouse_id === warehouseId && s.product_id === productId);
    return stock?.quantity || 0;
  };

  const calculateTransferImpact = (
    stocks: WarehouseStock[],
    fromWarehouse: string,
    toWarehouse: string,
    productId: string,
    quantity: number
  ) => {
    const fromStock = getAvailableStock(stocks, fromWarehouse, productId);
    const toStock = getAvailableStock(stocks, toWarehouse, productId);

    return {
      fromAfter: fromStock - quantity,
      toAfter: toStock + quantity,
      canTransfer: fromStock >= quantity
    };
  };

  const stocks: WarehouseStock[] = [
    { warehouse_id: 'wh-1', product_id: 'p1', quantity: 100 },
    { warehouse_id: 'wh-1', product_id: 'p2', quantity: 50 },
    { warehouse_id: 'wh-2', product_id: 'p1', quantity: 30 },
    { warehouse_id: 'wh-2', product_id: 'p2', quantity: 0 }
  ];

  it('should get available stock', () => {
    expect(getAvailableStock(stocks, 'wh-1', 'p1')).toBe(100);
    expect(getAvailableStock(stocks, 'wh-2', 'p1')).toBe(30);
    expect(getAvailableStock(stocks, 'wh-3', 'p1')).toBe(0);
  });

  it('should calculate transfer impact correctly', () => {
    const impact = calculateTransferImpact(stocks, 'wh-1', 'wh-2', 'p1', 20);
    expect(impact.fromAfter).toBe(80);
    expect(impact.toAfter).toBe(50);
    expect(impact.canTransfer).toBe(true);
  });

  it('should detect insufficient stock', () => {
    const impact = calculateTransferImpact(stocks, 'wh-1', 'wh-2', 'p1', 150);
    expect(impact.canTransfer).toBe(false);
  });
});

// ===================== WAREHOUSE SELECTION =====================

describe('Warehouse Selection', () => {
  const warehouses: Warehouse[] = [
    { id: 'wh-1', code: 'WH-MAIN', name: 'Main Warehouse', is_active: true },
    { id: 'wh-2', code: 'WH-PROD', name: 'Production Warehouse', is_active: true },
    { id: 'wh-3', code: 'WH-OLD', name: 'Old Warehouse', is_active: false }
  ];

  const getActiveWarehouses = () => {
    return warehouses.filter(w => w.is_active);
  };

  const getAvailableDestinations = (sourceId: string) => {
    return warehouses.filter(w => w.is_active && w.id !== sourceId);
  };

  const findWarehouseByCode = (code: string) => {
    return warehouses.find(w => w.code === code);
  };

  it('should get only active warehouses', () => {
    const active = getActiveWarehouses();
    expect(active.length).toBe(2);
    expect(active.map(w => w.id)).not.toContain('wh-3');
  });

  it('should exclude source from destinations', () => {
    const destinations = getAvailableDestinations('wh-1');
    expect(destinations.length).toBe(1);
    expect(destinations[0].id).toBe('wh-2');
  });

  it('should find warehouse by code', () => {
    const warehouse = findWarehouseByCode('WH-MAIN');
    expect(warehouse?.id).toBe('wh-1');
    expect(warehouse?.name).toBe('Main Warehouse');
  });
});

// ===================== ITEM LINE MANAGEMENT =====================

describe('Item Line Management', () => {
  const calculateLineTotal = (quantity: number, unitCost: number) => {
    return quantity * unitCost;
  };

  const summarizeTransferItems = (items: StockTransferItem[]) => {
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const uniqueProducts = new Set(items.map(item => item.product_id)).size;
    return { totalQuantity, uniqueProducts, lineCount: items.length };
  };

  const groupByProduct = (items: StockTransferItem[]) => {
    return items.reduce((groups, item) => {
      const key = item.product_id;
      if (!groups[key]) {
        groups[key] = { product_id: key, product_name: item.product_name, totalQuantity: 0 };
      }
      groups[key].totalQuantity += item.quantity;
      return groups;
    }, {} as Record<string, { product_id: string; product_name: string; totalQuantity: number }>);
  };

  const items: StockTransferItem[] = [
    { id: '1', product_id: 'p1', product_name: 'Product A', quantity: 10, available_qty: 100 },
    { id: '2', product_id: 'p2', product_name: 'Product B', quantity: 25, available_qty: 50 },
    { id: '3', product_id: 'p1', product_name: 'Product A', quantity: 15, available_qty: 100 }
  ];

  it('should calculate line total', () => {
    expect(calculateLineTotal(10, 50)).toBe(500);
    expect(calculateLineTotal(0, 50)).toBe(0);
  });

  it('should summarize transfer items', () => {
    const summary = summarizeTransferItems(items);
    expect(summary.totalQuantity).toBe(50);
    expect(summary.uniqueProducts).toBe(2);
    expect(summary.lineCount).toBe(3);
  });

  it('should group by product', () => {
    const groups = groupByProduct(items);
    expect(groups['p1'].totalQuantity).toBe(25);
    expect(groups['p2'].totalQuantity).toBe(25);
  });
});

// ===================== TRANSFER HISTORY =====================

describe('Transfer History', () => {
  interface TransferHistory {
    id: string;
    transfer_id: string;
    action: 'created' | 'submitted' | 'received' | 'cancelled';
    user_id: string;
    timestamp: string;
    notes?: string;
  }

  const getLatestAction = (history: TransferHistory[]) => {
    if (history.length === 0) return null;
    return history.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];
  };

  const getActionsByType = (history: TransferHistory[], action: string) => {
    return history.filter(h => h.action === action);
  };

  const getTimelineForTransfer = (history: TransferHistory[], transferId: string) => {
    return history
      .filter(h => h.transfer_id === transferId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  };

  const history: TransferHistory[] = [
    { id: '1', transfer_id: 't1', action: 'created', user_id: 'u1', timestamp: '2024-01-15T10:00:00Z' },
    { id: '2', transfer_id: 't1', action: 'submitted', user_id: 'u1', timestamp: '2024-01-15T11:00:00Z' },
    { id: '3', transfer_id: 't1', action: 'received', user_id: 'u2', timestamp: '2024-01-16T09:00:00Z' },
    { id: '4', transfer_id: 't2', action: 'created', user_id: 'u1', timestamp: '2024-01-17T10:00:00Z' }
  ];

  it('should get latest action', () => {
    const latest = getLatestAction(history);
    expect(latest?.id).toBe('4');
    expect(latest?.action).toBe('created');
  });

  it('should filter by action type', () => {
    const created = getActionsByType(history, 'created');
    expect(created.length).toBe(2);
  });

  it('should get timeline for transfer', () => {
    const timeline = getTimelineForTransfer(history, 't1');
    expect(timeline.length).toBe(3);
    expect(timeline[0].action).toBe('created');
    expect(timeline[2].action).toBe('received');
  });
});

// ===================== BATCH TRANSFERS =====================

describe('Batch Transfers', () => {
  interface BatchTransfer {
    id: string;
    status: 'DRAFT' | 'SUBMITTED';
    item_count: number;
  }

  const filterDrafts = (transfers: BatchTransfer[]) => {
    return transfers.filter(t => t.status === 'DRAFT');
  };

  const calculateTotalItems = (transfers: BatchTransfer[]) => {
    return transfers.reduce((sum, t) => sum + t.item_count, 0);
  };

  const canBatchSubmit = (transfers: BatchTransfer[]) => {
    return transfers.length > 0 && transfers.every(t => t.status === 'DRAFT');
  };

  const transfers: BatchTransfer[] = [
    { id: 't1', status: 'DRAFT', item_count: 5 },
    { id: 't2', status: 'DRAFT', item_count: 3 },
    { id: 't3', status: 'SUBMITTED', item_count: 8 }
  ];

  it('should filter draft transfers', () => {
    const drafts = filterDrafts(transfers);
    expect(drafts.length).toBe(2);
  });

  it('should calculate total items', () => {
    const total = calculateTotalItems(transfers);
    expect(total).toBe(16);
  });

  it('should validate batch submit eligibility', () => {
    const drafts = filterDrafts(transfers);
    expect(canBatchSubmit(drafts)).toBe(true);
    expect(canBatchSubmit(transfers)).toBe(false);
  });
});

// ===================== PRODUCT SEARCH =====================

describe('Product Search', () => {
  interface Product {
    id: string;
    code: string;
    name: string;
    name_ar: string;
    barcode?: string;
  }

  const products: Product[] = [
    { id: 'p1', code: 'PRD-001', name: 'Widget A', name_ar: 'قطعة أ', barcode: '123456789' },
    { id: 'p2', code: 'PRD-002', name: 'Widget B', name_ar: 'قطعة ب', barcode: '987654321' },
    { id: 'p3', code: 'PRD-003', name: 'Gadget X', name_ar: 'أداة س' }
  ];

  const searchProducts = (query: string) => {
    const lower = query.toLowerCase();
    return products.filter(p =>
      p.code.toLowerCase().includes(lower) ||
      p.name.toLowerCase().includes(lower) ||
      p.name_ar.includes(query) ||
      (p.barcode && p.barcode.includes(query))
    );
  };

  it('should search by code', () => {
    const results = searchProducts('PRD-001');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('p1');
  });

  it('should search by name', () => {
    const results = searchProducts('widget');
    expect(results.length).toBe(2);
  });

  it('should search by Arabic name', () => {
    const results = searchProducts('قطعة');
    expect(results.length).toBe(2);
  });

  it('should search by barcode', () => {
    const results = searchProducts('123456789');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('p1');
  });
});

// ===================== RECEIVING PROCESS =====================

describe('Receiving Process', () => {
  interface ReceivingLine {
    item_id: string;
    expected_quantity: number;
    received_quantity: number;
    variance_reason?: string;
  }

  const calculateVariance = (expected: number, received: number) => {
    return received - expected;
  };

  const validateReceiving = (lines: ReceivingLine[]) => {
    const errors: string[] = [];
    
    lines.forEach((line, index) => {
      if (line.received_quantity < 0) {
        errors.push(`Line ${index + 1}: Received quantity cannot be negative`);
      }
      const variance = calculateVariance(line.expected_quantity, line.received_quantity);
      if (variance !== 0 && !line.variance_reason) {
        errors.push(`Line ${index + 1}: Variance reason required when quantities differ`);
      }
    });

    return { valid: errors.length === 0, errors };
  };

  const summarizeReceiving = (lines: ReceivingLine[]) => {
    const totalExpected = lines.reduce((sum, l) => sum + l.expected_quantity, 0);
    const totalReceived = lines.reduce((sum, l) => sum + l.received_quantity, 0);
    const hasVariance = lines.some(l => l.expected_quantity !== l.received_quantity);
    
    return { totalExpected, totalReceived, hasVariance };
  };

  it('should calculate positive variance (over received)', () => {
    expect(calculateVariance(10, 12)).toBe(2);
  });

  it('should calculate negative variance (short received)', () => {
    expect(calculateVariance(10, 8)).toBe(-2);
  });

  it('should require variance reason', () => {
    const lines: ReceivingLine[] = [
      { item_id: 'i1', expected_quantity: 10, received_quantity: 8 }
    ];

    const result = validateReceiving(lines);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Variance reason required');
  });

  it('should pass with variance reason', () => {
    const lines: ReceivingLine[] = [
      { item_id: 'i1', expected_quantity: 10, received_quantity: 8, variance_reason: 'Damaged in transit' }
    ];

    const result = validateReceiving(lines);
    expect(result.valid).toBe(true);
  });

  it('should summarize receiving', () => {
    const lines: ReceivingLine[] = [
      { item_id: 'i1', expected_quantity: 10, received_quantity: 10 },
      { item_id: 'i2', expected_quantity: 20, received_quantity: 18, variance_reason: 'Short' }
    ];

    const summary = summarizeReceiving(lines);
    expect(summary.totalExpected).toBe(30);
    expect(summary.totalReceived).toBe(28);
    expect(summary.hasVariance).toBe(true);
  });
});
