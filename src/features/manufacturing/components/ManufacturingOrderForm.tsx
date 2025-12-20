/**
 * Manufacturing Order Form Component
 * Extracted from ManufacturingOrdersManagement to reduce complexity
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import { getStatusLabel } from '../utils/statusHelpers';
import type { ManufacturingOrder } from '@/lib/supabase';

interface OrderFormState {
  orderNumber: string;
  productId: string;
  quantity: string;
  startDate: string;
  dueDate: string;
  notes: string;
  status: ManufacturingOrder['status'];
}

interface Product {
  id: string;
  code?: string;
  name: string;
}

interface ManufacturingOrderFormProps {
  form: OrderFormState;
  setForm: React.Dispatch<React.SetStateAction<OrderFormState>>;
  products: Product[];
  productsLoading: boolean;
  dateRange: DateRange | undefined;
  setDateRange: React.Dispatch<React.SetStateAction<DateRange | undefined>>;
  onSubmit: (event: React.FormEvent) => Promise<void>;
  isSubmitting: boolean;
  isRTL: boolean;
}

const ORDER_STATUS_OPTIONS: ManufacturingOrder['status'][] = [
  'draft',
  'confirmed',
  'pending',
  'in-progress',
  'completed',
  'cancelled',
  'on-hold',
  'quality-check'
];

export function ManufacturingOrderForm({
  form,
  setForm,
  products,
  productsLoading,
  dateRange,
  setDateRange,
  onSubmit,
  isSubmitting,
  isRTL
}: ManufacturingOrderFormProps) {
  const { t } = useTranslation();

  const updateField = <K extends keyof OrderFormState>(field: K, value: OrderFormState[K]) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="text-xl font-semibold">{t('manufacturing.ordersPage.form.sectionTitle')}</h3>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
          <div>
            <Label className="mb-1 block">{t('manufacturing.ordersPage.form.orderNumber')}</Label>
            <Input
              value={form.orderNumber}
              onChange={(e) => updateField('orderNumber', e.target.value)}
              placeholder="MO-0001"
            />
          </div>
          
          <div>
            <Label className="mb-1 block">{t('manufacturing.ordersPage.form.product')}</Label>
            <Select
              value={form.productId}
              onValueChange={(value) => updateField('productId', value)}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    productsLoading
                      ? t('common.loading')
                      : t('manufacturing.ordersPage.form.productPlaceholder')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {products.length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    {productsLoading
                      ? t('common.loading')
                      : t('manufacturing.ordersPage.form.noProducts')}
                  </SelectItem>
                ) : (
                  products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.code ? `${product.code} - ` : ''}
                      {product.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <Label className="mb-1 block">{t('manufacturing.ordersPage.form.quantity')}</Label>
            <Input
              type="number"
              min="0"
              value={form.quantity}
              onChange={(e) => updateField('quantity', e.target.value)}
            />
          </div>
          
          <div>
            <Label className="mb-1 block">{t('manufacturing.ordersPage.form.status')}</Label>
            <Select
              value={form.status}
              onValueChange={(value) => updateField('status', value as ManufacturingOrder['status'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {getStatusLabel(status, isRTL)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="md:col-span-2">
            <Label className="mb-1 block">{t('manufacturing.ordersPage.form.dateRange')}</Label>
            <DatePickerWithRange date={dateRange} setDate={setDateRange} />
          </div>
          
          <div className="md:col-span-2">
            <Label className="mb-1 block">{t('manufacturing.ordersPage.form.notes')}</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
            />
          </div>
          
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t('manufacturing.ordersPage.form.creating')
                : t('manufacturing.ordersPage.form.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
