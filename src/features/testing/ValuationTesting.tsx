/**
 * Valuation Methods Testing Page
 * Interactive testing for FIFO, LIFO, and Weighted Average
 */

import React, { useState } from 'react';
import { 
  receivePurchaseV2, 
  shipSalesV2,
  getProductBatches,
  simulateCOGS 
} from '../../domain/inventory-valuation-integration';
import BatchDetails from '../inventory/components/BatchDetails';

interface TestProduct {
  id: string;
  code: string;
  name: string;
  valuation_method: string;
  stock_quantity: number;
  cost_price: number;
  stock_value: number;
}

interface TestTransaction {
  timestamp: string;
  type: 'IN' | 'OUT';
  quantity: number;
  rate?: number;
  cogs?: number;
  newQty: number;
  newRate: number;
  newValue: number;
}

export const ValuationTesting: React.FC = () => {
  const [testProducts, setTestProducts] = useState<TestProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<TestProduct | null>(null);
  const [transactions, setTransactions] = useState<TestTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Form states
  const [productCode, setProductCode] = useState('TEST-001');
  const [productName, setProductName] = useState('منتج اختبار');
  const [valuationMethod, setValuationMethod] = useState('FIFO');
  const [transactionType, setTransactionType] = useState<'IN' | 'OUT'>('IN');
  const [quantity, setQuantity] = useState('100');
  const [rate, setRate] = useState('50.00');

  // Create test product
  const createTestProduct = async () => {
    setLoading(true);
    
    try {
      // In real implementation, would call Supabase
      const newProduct: TestProduct = {
        id: `test-${Date.now()}`,
        code: productCode,
        name: productName,
        valuation_method: valuationMethod,
        stock_quantity: 0,
        cost_price: 0,
        stock_value: 0
      };
      
      setTestProducts([...testProducts, newProduct]);
      setSelectedProduct(newProduct);
      setTransactions([]);
      
      alert(`✅ تم إنشاء منتج اختبار: ${productCode}`);
    } catch (error) {
      alert(`❌ خطأ: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Process test transaction
  const processTransaction = async () => {
    if (!selectedProduct) {
      alert('⚠️ الرجاء اختيار منتج أولاً');
      return;
    }

    setLoading(true);
    
    try {
      const qty = Number.parseFloat(quantity);
      const unitRate = Number.parseFloat(rate);
      
      if (Number.isNaN(qty) || qty <= 0) {
        throw new Error('الكمية يجب أن تكون رقم موجب');
      }
      
      if (transactionType === 'IN' && (Number.isNaN(unitRate) || unitRate <= 0)) {
        throw new Error('سعر الوحدة يجب أن يكون رقم موجب');
      }

      let result;
      
      if (transactionType === 'IN') {
        // Incoming stock
        result = await receivePurchaseV2({
          itemId: selectedProduct.id,
          quantity: qty,
          unitCost: unitRate,
          notes: `اختبار استلام - ${valuationMethod}`
        });
      } else {
        // Outgoing stock
        if (qty > selectedProduct.stock_quantity) {
          throw new Error(
            `كمية غير كافية. المتاح: ${selectedProduct.stock_quantity}, المطلوب: ${qty}`
          );
        }
        
        result = await shipSalesV2({
          itemId: selectedProduct.id,
          quantity: qty,
          notes: `اختبار صرف - ${valuationMethod}`
        });
      }

      if (result.success) {
        // Update product state
        const updatedProduct = {
          ...selectedProduct,
          stock_quantity: result.data.stockAfter,
          cost_price: result.data.costAfter,
          stock_value: result.data.valueAfter
        };
        
        setSelectedProduct(updatedProduct);
        
        // Update products list
        setTestProducts(testProducts.map(p => 
          p.id === selectedProduct.id ? updatedProduct : p
        ));
        
        // Add transaction to history
        const transaction: TestTransaction = {
          timestamp: new Date().toLocaleString('ar-SA'),
          type: transactionType,
          quantity: qty,
          rate: transactionType === 'IN' ? unitRate : result.data.costAfter,
          cogs: result.data.costOfGoodsSold,
          newQty: result.data.stockAfter,
          newRate: result.data.costAfter,
          newValue: result.data.valueAfter
        };
        
        setTransactions([transaction, ...transactions]);
        
        alert(`✅ ${transactionType === 'IN' ? 'استلام' : 'صرف'} تم بنجاح!`);
      } else {
        throw new Error(result.error?.message || 'فشلت العملية');
      }
      
    } catch (error) {
      alert(`❌ خطأ: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Simulate COGS
  const handleSimulateCOGS = async () => {
    if (!selectedProduct) {
      alert('⚠️ الرجاء اختيار منتج أولاً');
      return;
    }

    const qty = Number.parseFloat(quantity);
    if (Number.isNaN(qty) || qty <= 0) {
      alert('⚠️ الرجاء إدخال كمية صحيحة');
      return;
    }

    setLoading(true);
    
    try {
      const result = await simulateCOGS(selectedProduct.id, qty);
      
      if (result.success) {
        alert(
          `📊 محاكاة تكلفة البضاعة المباعة\n\n` +
          `الكمية: ${qty}\n` +
          `التكلفة المتوقعة: ${result.data.toFixed(2)} ر.س\n` +
          `متوسط السعر: ${(result.data / qty).toFixed(2)} ر.س`
        );
      } else {
        throw new Error(result.error?.message || 'فشلت المحاكاة');
      }
    } catch (error) {
      alert(`❌ خطأ: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl" dir="rtl">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">
        🧪 اختبار طرق تقييم المخزون
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Product Creation */}
        <div className="lg:col-span-1 space-y-6">
          {/* Create Product */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">
              إنشاء منتج اختبار
            </h2>
            
            <div className="space-y-4">
              <div>
                <label htmlFor="product-code" className="block text-sm font-medium text-gray-700 mb-1">
                  كود المنتج
                </label>
                <input
                  id="product-code"
                  type="text"
                  value={productCode}
                  onChange={(e) => setProductCode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="TEST-001"
                />
              </div>

              <div>
                <label htmlFor="product-name" className="block text-sm font-medium text-gray-700 mb-1">
                  اسم المنتج
                </label>
                <input
                  id="product-name"
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="منتج اختبار"
                />
              </div>

              <div>
                <label htmlFor="valuation-method" className="block text-sm font-medium text-gray-700 mb-1">
                  طريقة التقييم
                </label>
                <select
                  id="valuation-method"
                  value={valuationMethod}
                  onChange={(e) => setValuationMethod(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="Weighted Average">المتوسط المرجح</option>
                  <option value="FIFO">الوارد أولاً صادر أولاً</option>
                  <option value="LIFO">الوارد أخيراً صادر أولاً</option>
                  <option value="Moving Average">المتوسط المتحرك</option>
                </select>
              </div>

              <button
                onClick={createTestProduct}
                disabled={loading}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
              >
                {loading ? 'جاري الإنشاء...' : '✨ إنشاء منتج'}
              </button>
            </div>
          </div>

          {/* Product Selector */}
          {testProducts.length > 0 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">
                المنتجات الاختبارية
              </h2>
              
              <div className="space-y-2">
                {testProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => {
                      setSelectedProduct(product);
                      setTransactions([]);
                    }}
                    className={`w-full text-right p-3 rounded border transition-colors ${
                      selectedProduct?.id === product.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium text-gray-800">{product.code}</div>
                    <div className="text-sm text-gray-600">{product.valuation_method}</div>
                    <div className="text-xs text-gray-500">
                      الكمية: {product.stock_quantity} | 
                      القيمة: {product.stock_value.toFixed(2)} ر.س
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Middle Panel - Transactions */}
        <div className="lg:col-span-1 space-y-6">
          {/* Transaction Form */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">
              إضافة حركة
            </h2>
            
            {selectedProduct ? (
              <div className="space-y-4">
                <div className="p-3 bg-gray-50 rounded">
                  <div className="text-sm text-gray-600">المنتج المختار</div>
                  <div className="font-medium text-gray-800">{selectedProduct.code}</div>
                  <div className="text-xs text-gray-600">{selectedProduct.valuation_method}</div>
                </div>

                <div>
                  <label htmlFor="transaction-type" className="block text-sm font-medium text-gray-700 mb-1">
                    نوع الحركة
                  </label>
                  <div id="transaction-type" className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setTransactionType('IN')}
                      className={`py-2 px-4 rounded border transition-colors ${
                        transactionType === 'IN'
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      📦 استلام
                    </button>
                    <button
                      onClick={() => setTransactionType('OUT')}
                      className={`py-2 px-4 rounded border transition-colors ${
                        transactionType === 'OUT'
                          ? 'border-red-500 bg-red-50 text-red-700'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      📤 صرف
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-1">
                    الكمية
                  </label>
                  <input
                    id="quantity"
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="100"
                    min="0"
                    step="0.01"
                  />
                </div>

                {transactionType === 'IN' && (
                  <div>
                    <label htmlFor="unit-rate" className="block text-sm font-medium text-gray-700 mb-1">
                      سعر الوحدة
                    </label>
                    <input
                      id="unit-rate"
                      type="number"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="50.00"
                      min="0"
                      step="0.01"
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={processTransaction}
                    disabled={loading}
                    className={`flex-1 py-2 px-4 rounded-md text-white transition-colors ${
                      transactionType === 'IN'
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-red-600 hover:bg-red-700'
                    } disabled:bg-gray-400`}
                  >
                    {loading ? 'جاري المعالجة...' : 
                     transactionType === 'IN' ? '📦 استلام' : '📤 صرف'}
                  </button>
                  
                  {transactionType === 'OUT' && (
                    <button
                      onClick={handleSimulateCOGS}
                      disabled={loading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                      title="محاكاة التكلفة دون الصرف الفعلي"
                    >
                      🔍
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <div className="text-4xl mb-2">👆</div>
                <p>الرجاء اختيار منتج أولاً</p>
              </div>
            )}
          </div>

          {/* Current Stock Summary */}
          {selectedProduct && selectedProduct.stock_quantity > 0 && (
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold mb-3 text-gray-800">
                📊 ملخص المخزون الحالي
              </h3>
              
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">الكمية:</span>
                  <span className="font-bold text-gray-800">
                    {selectedProduct.stock_quantity.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">سعر الوحدة:</span>
                  <span className="font-bold text-gray-800">
                    {selectedProduct.cost_price.toFixed(2)} ر.س
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <span className="text-gray-700 font-medium">القيمة الإجمالية:</span>
                  <span className="font-bold text-green-600 text-lg">
                    {selectedProduct.stock_value.toFixed(2)} ر.س
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Transaction History */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">
              📝 سجل الحركات
            </h2>
            
            {transactions.length > 0 ? (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {transactions.map((trans, index) => (
                  <div 
                    key={index}
                    className={`p-3 rounded border ${
                      trans.type === 'IN' 
                        ? 'border-green-200 bg-green-50' 
                        : 'border-red-200 bg-red-50'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-2xl">
                        {trans.type === 'IN' ? '📦' : '📤'}
                      </span>
                      <span className="text-xs text-gray-600">
                        {trans.timestamp}
                      </span>
                    </div>
                    
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-600">الكمية:</span>
                        <span className="font-medium">
                          {trans.type === 'IN' ? '+' : '-'}{trans.quantity}
                        </span>
                      </div>
                      
                      {trans.rate && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">السعر:</span>
                          <span className="font-medium">{trans.rate.toFixed(2)} ر.س</span>
                        </div>
                      )}
                      
                      {trans.cogs && trans.cogs > 0 && (
                        <div className="flex justify-between text-red-600">
                          <span>COGS:</span>
                          <span className="font-bold">{trans.cogs.toFixed(2)} ر.س</span>
                        </div>
                      )}
                      
                      <div className="pt-2 border-t border-gray-300 mt-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-600">الرصيد الجديد:</span>
                          <span className="font-medium">{trans.newQty.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-600">السعر الجديد:</span>
                          <span className="font-medium">{trans.newRate.toFixed(2)} ر.س</span>
                        </div>
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-gray-700">القيمة الجديدة:</span>
                          <span className="text-green-600">{trans.newValue.toFixed(2)} ر.س</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <div className="text-4xl mb-2">📋</div>
                <p>لا توجد حركات بعد</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Batch Details */}
      {selectedProduct && (selectedProduct.valuation_method === 'FIFO' || selectedProduct.valuation_method === 'LIFO') && (
        <div className="mt-6">
          <BatchDetails
            productId={selectedProduct.id}
            productCode={selectedProduct.code}
            productName={selectedProduct.name}
            valuationMethod={selectedProduct.valuation_method}
            totalStock={selectedProduct.stock_quantity}
            totalValue={selectedProduct.stock_value}
          />
        </div>
      )}
    </div>
  );
};

export default ValuationTesting;
