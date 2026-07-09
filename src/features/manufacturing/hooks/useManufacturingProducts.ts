import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

interface Product {
  id: string;
  name: string;
  code?: string;
}

export const MANUFACTURING_PRODUCTS_QUERY_KEY = ['manufacturing-products'] as const;

interface ProductRow {
  id: string;
  name?: string | null;
  code?: string | null;
}

const mapProducts = (data: ProductRow[] | null | undefined): Product[] =>
  (data || []).map((item) => ({
    id: item.id,
    name: item.name || item.code || 'Unnamed product',
    code: item.code ?? undefined
  }));

async function fetchProducts(): Promise<Product[]> {
  try {
    const orgId = await getEffectiveTenantId();

    const buildQuery = (table: 'products' | 'items') => {
      let query = supabase
        .from(table)
        .select('id, name, code, org_id')
        .order('name', { ascending: true })
        .limit(100);
      if (orgId) query = query.eq('org_id', orgId);
      return query;
    };

    let productData: ProductRow[] | null = null;

    try {
      const { data, error } = await buildQuery('products');
      if (error && (error.code === 'PGRST205' || error.message?.includes('relation'))) {
        // الجدول غير موجود — نجرّب items
      } else if (error) {
        throw error;
      } else {
        productData = data || null;
      }
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code !== 'PGRST205') throw error;
    }

    if (!productData || productData.length === 0) {
      const { data: itemsData, error: itemsError } = await buildQuery('items');
      if (itemsError && itemsError.code !== 'PGRST205') throw itemsError;
      productData = itemsData || null;
    }

    return mapProducts(productData);
  } catch (error) {
    // نفس السلوك القديم: تحذير + قائمة فارغة — لا نكسر نموذج إنشاء الأوامر
    console.warn('Could not load products for manufacturing orders form', error);
    return [];
  }
}

/**
 * بند 11: موحَّد على React Query داخلياً — الواجهة الخارجية
 * { products, loading, loadProducts } كما كانت تماماً، لا كسر لأي مستهلك
 */
export function useManufacturingProducts() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Product[]>({
    queryKey: MANUFACTURING_PRODUCTS_QUERY_KEY,
    queryFn: fetchProducts,
    staleTime: 60_000,
  });

  const loadProducts = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: MANUFACTURING_PRODUCTS_QUERY_KEY });
  }, [queryClient]);

  return {
    products: data ?? [],
    loading: isLoading,
    loadProducts
  };
}
