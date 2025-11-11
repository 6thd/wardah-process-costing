/**
 * Batch Details Component
 * Displays stock batches for FIFO/LIFO products
 * Shows batch queue, quantities, rates, and values
 */

import React, { useState, useEffect } from 'react';
import { getProductBatches } from '../../../domain/inventory-valuation-integration';

interface Batch {
  batch_number: number;
  quantity: number;
  rate: number;
  value: number;
  percentage: number;
}

interface BatchDetailsProps {
  productId: string;
  productCode: string;
  productName: string;
  valuationMethod: string;
  totalStock: number;
  totalValue: number;
}

export const BatchDetails: React.FC<BatchDetailsProps> = ({
  productId,
  productCode,
  productName,
  valuationMethod,
  totalStock,
  totalValue
}) => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Only show for FIFO/LIFO methods
  const isBatchTracked = valuationMethod === 'FIFO' || valuationMethod === 'LIFO';

  useEffect(() => {
    if (isExpanded && isBatchTracked && productId) {
      loadBatches();
    }
  }, [isExpanded, productId, isBatchTracked]);

  const loadBatches = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await getProductBatches(productId);
      
      if (result.success) {
        setBatches(result.data || []);
      } else {
        setError(result.error?.message || 'فشل تحميل تفاصيل الدفعات');
      }
    } catch (err) {
      setError('خطأ في تحميل تفاصيل الدفعات');
      console.error('Error loading batches:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isBatchTracked) {
    return (
      <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm">
        <div className="flex items-center gap-2">
          <span className="text-blue-600">ℹ️</span>
          <span className="text-blue-800">
            تتبع الدفعات متاح فقط لطرق FIFO و LIFO
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{isExpanded ? '📂' : '📁'}</span>
          <div className="text-right">
            <h3 className="font-semibold text-gray-800">
              تفاصيل دفعات المخزون
            </h3>
            <p className="text-xs text-gray-600">
              {productCode} - {productName}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-right text-sm">
            <div className="text-gray-600">طريقة التقييم</div>
            <div className="font-medium text-blue-600">{valuationMethod}</div>
          </div>
          
          <svg 
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-4 bg-white">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4 mb-4 p-3 bg-gray-50 rounded">
            <div className="text-right">
              <div className="text-xs text-gray-600 mb-1">إجمالي الكمية</div>
              <div className="text-lg font-bold text-gray-800">
                {totalStock.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-600 mb-1">إجمالي القيمة</div>
              <div className="text-lg font-bold text-green-600">
                {totalValue.toLocaleString('ar-SA', { 
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2 
                })} ر.س
              </div>
            </div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-2 text-gray-600">جاري التحميل...</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              ⚠️ {error}
            </div>
          )}

          {/* Batches Table */}
          {!loading && !error && batches.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      رقم الدفعة
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      الكمية
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      سعر الوحدة
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      القيمة
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      النسبة
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {batches.map((batch, index) => (
                    <tr 
                      key={index}
                      className={`hover:bg-gray-50 ${
                        valuationMethod === 'FIFO' && index === 0 ? 'bg-green-50' :
                        valuationMethod === 'LIFO' && index === batches.length - 1 ? 'bg-blue-50' :
                        ''
                      }`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="flex items-center gap-2">
                          {valuationMethod === 'FIFO' && index === 0 && (
                            <span title="سيتم صرف هذه الدفعة أولاً">🟢</span>
                          )}
                          {valuationMethod === 'LIFO' && index === batches.length - 1 && (
                            <span title="سيتم صرف هذه الدفعة أولاً">🔵</span>
                          )}
                          <span className="font-medium text-gray-900">
                            #{batch.batch_number}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                        {batch.quantity.toLocaleString('ar-SA', { 
                          minimumFractionDigits: 2 
                        })}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                        {batch.rate.toLocaleString('ar-SA', { 
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2 
                        })} ر.س
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        {batch.value.toLocaleString('ar-SA', { 
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2 
                        })} ر.س
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-blue-500 transition-all"
                              style={{ width: `${batch.percentage}%` }}
                            />
                          </div>
                          <span className="text-gray-600 text-xs">
                            {batch.percentage.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr className="font-bold">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      الإجمالي
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {batches.reduce((sum, b) => sum + b.quantity, 0).toLocaleString('ar-SA', { 
                        minimumFractionDigits: 2 
                      })}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {batches.length > 0 
                        ? (batches.reduce((sum, b) => sum + b.value, 0) / 
                           batches.reduce((sum, b) => sum + b.quantity, 0))
                            .toLocaleString('ar-SA', { 
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2 
                            })
                        : '0.00'
                      } ر.س
                    </td>
                    <td className="px-4 py-3 text-sm text-green-600">
                      {batches.reduce((sum, b) => sum + b.value, 0).toLocaleString('ar-SA', { 
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2 
                      })} ر.س
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      100%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && batches.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-2">📦</div>
              <p>لا توجد دفعات مخزون حالياً</p>
            </div>
          )}

          {/* Info Box */}
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-xs">
            <div className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">💡</span>
              <div className="flex-1 text-blue-800">
                {valuationMethod === 'FIFO' && (
                  <p>
                    <strong>FIFO (الوارد أولاً صادر أولاً):</strong> يتم صرف المخزون من أقدم دفعة (الدفعة المميزة بـ 🟢)
                  </p>
                )}
                {valuationMethod === 'LIFO' && (
                  <p>
                    <strong>LIFO (الوارد أخيراً صادر أولاً):</strong> يتم صرف المخزون من أحدث دفعة (الدفعة المميزة بـ 🔵)
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchDetails;
