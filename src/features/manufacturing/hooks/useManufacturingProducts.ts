import { useState, useEffect } from 'react';
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

interface Product {
  id: string;
  name: string;
  code?: string;
}

export function useManufacturingProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const orgId = await getEffectiveTenantId();

      const mapProducts = (data: any[] | null | undefined): Product[] =>
        (data || []).map((item) => ({
          id: item.id,
          name: item.name || item.code || 'Unnamed product',
          code: item.code
        }));

      const buildProductQuery = () => {
        let query = supabase
          .from('products')
          .select('id, name, code, org_id')
          .order('name', { ascending: true })
          .limit(100);

        if (orgId) {
          query = query.eq('org_id', orgId);
        }

        return query;
      };

      const buildItemsQuery = () => {
        let query = supabase
          .from('items')
          .select('id, name, code, org_id')
          .order('name', { ascending: true })
          .limit(100);

        if (orgId) {
          query = query.eq('org_id', orgId);
        }

        return query;
      };

      let productData: any[] | null = null;

      try {
        const { data, error } = await buildProductQuery();
        if (error && (error.code === 'PGRST205' || error.message?.includes('relation'))) {
          // Table doesn't exist, try items table - productData already null, no assignment needed
        } else if (error) {
          throw error;
        } else {
          productData = data || null;
        }
      } catch (error: unknown) {
        const err = error as { code?: string }
        if (err.code !== 'PGRST205') {
          throw error;
        }
        // Table doesn't exist, try items table - productData already null, no assignment needed
      }

      if (!productData || productData.length === 0) {
        const { data: itemsData, error: itemsError } = await buildItemsQuery();
        if (itemsError && itemsError.code !== 'PGRST205') {
          throw itemsError;
        }
        productData = itemsData || null;
      }

      setProducts(mapProducts(productData));
    } catch (error) {
      console.warn('Could not load products for manufacturing orders form', error);
      setProducts([]);
      } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  return {
    products,
    loading,
    loadProducts
  };
}

