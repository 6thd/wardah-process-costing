import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../../../../test/test-utils';

const mockOrder = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: (...args: unknown[]) => mockOrder(...args),
        }),
      }),
    }),
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-test')),
}));

import { InventoryValuationReport } from '../InventoryValuationReport';

describe('InventoryValuationReport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('يحسب ويعرض إجمالي قيمة المخزون من products (الكمية × التكلفة)', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 'p1', code: 'A1', name: 'منتج أ', stock_quantity: 100, cost_price: 10 }, // 1000
        { id: 'p2', code: 'B2', name: 'منتج ب', stock_quantity: 50, cost_price: 4 },   // 200
        // صف بحقول فارغة ⇒ يغطّي مسارات ?? '—' و ?? 0 (لا يضيف للإجمالي)
        { id: 'p3', code: null, name: null, stock_quantity: null, cost_price: null },
      ],
      error: null,
    });

    render(<InventoryValuationReport />);

    // الإجمالي = 1000 + 200 + 0 = 1,200.00
    await waitFor(() => expect(screen.getByText(/1,200\.00 ريال/)).toBeInTheDocument());
    expect(screen.getByText('منتج أ')).toBeInTheDocument();
    expect(screen.getByText(/3 منتجاً/)).toBeInTheDocument();
  });

  it('يعرض حالة فارغة عند غياب المنتجات', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });
    render(<InventoryValuationReport />);
    await waitFor(() => expect(screen.getByText('لا توجد منتجات')).toBeInTheDocument());
  });

  it('يعرض حالة خطأ عند فشل الاستعلام', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: 'DB down' } });
    render(<InventoryValuationReport />);
    await waitFor(() => expect(screen.getByText(/DB down/)).toBeInTheDocument());
  });

  it('يعرض خطأً عند تعذّر تحديد المؤسسة (org غير موجود)', async () => {
    const supa = await import('@/lib/supabase');
    (supa.getEffectiveTenantId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    render(<InventoryValuationReport />);
    await waitFor(() => expect(screen.getByText(/تعذّر تحديد هوية المؤسسة/)).toBeInTheDocument());
  });
});
