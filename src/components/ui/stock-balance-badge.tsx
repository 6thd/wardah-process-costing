/**
 * Stock Balance Badge Component
 * بطاقة عرض رصيد المخزون
 */

import { useState, useEffect } from 'react';
import { getStockBalance, type StockBalance } from '@/services/stock-ledger-service';
import { Loader2, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StockBalanceBadgeProps {
  productId: string;
  warehouseId: string;
  showValue?: boolean;  // Show valuation
  className?: string;
}

export function StockBalanceBadge({
  productId,
  warehouseId,
  showValue = false,
  className = ''
}: StockBalanceBadgeProps) {
  const [balance, setBalance] = useState<StockBalance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (productId && warehouseId) {
      loadBalance();
    }
  }, [productId, warehouseId]);

  const loadBalance = async () => {
    setLoading(true);
    try {
      const result = await getStockBalance(productId, warehouseId);
      if (result.success && result.data) {
        setBalance(result.data);
      }
    } catch (error) {
      console.error('Error loading stock balance:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={cn("inline-flex items-center gap-1 text-xs text-gray-400", className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>...</span>
      </div>
    );
  }

  if (!balance) {
    return null;
  }

  const qty = balance.quantity || 0;
  const rate = balance.valuation_rate || 0;
  const value = balance.stock_value || 0;

  // Color coding based on quantity
  const getColorClass = () => {
    if (qty <= 0) return 'bg-red-50 text-red-700 border-red-200';
    if (qty < 10) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    return 'bg-green-50 text-green-700 border-green-200';
  };

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium",
      getColorClass(),
      className
    )}>
      <Package className="h-3 w-3" />
      
      <span className="font-mono">
        {qty.toFixed(2)}
      </span>

      {showValue && value > 0 && (
        <>
          <span className="text-gray-400">•</span>
          <span className="text-xs">
            {value.toFixed(2)} ر.س
          </span>
          <span className="text-xs text-gray-400">
            ({rate.toFixed(2)}/وحدة)
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Stock Balance Inline Component
 * عرض مبسط للرصيد في سطر واحد
 */
interface StockBalanceInlineProps {
  productId: string;
  warehouseId: string;
  className?: string;
}

export function StockBalanceInline({
  productId,
  warehouseId,
  className = ''
}: StockBalanceInlineProps) {
  const [balance, setBalance] = useState<StockBalance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (productId && warehouseId) {
      loadBalance();
    }
  }, [productId, warehouseId]);

  const loadBalance = async () => {
    setLoading(true);
    try {
      const result = await getStockBalance(productId, warehouseId);
      if (result.success && result.data) {
        setBalance(result.data);
      }
    } catch (error) {
      console.error('Error loading stock balance:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <span className={cn("text-xs text-gray-400", className)}>...</span>;
  }

  if (!balance) {
    return null;
  }

  const qty = balance.quantity || 0;

  return (
    <span className={cn(
      "text-xs font-medium",
      qty <= 0 ? 'text-red-600' : qty < 10 ? 'text-yellow-600' : 'text-green-600',
      className
    )}>
      متوفر: {qty.toFixed(2)}
    </span>
  );
}
