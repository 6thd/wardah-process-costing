# خطة التكامل بين Frontend و Backend

## المشكلة الحالية:
- قاعدة البيانات متطورة (wardah-migration-schema.sql) ولكنها منفصلة عن Frontend
- ملف config.json يحتوي على URLs وهمية لـ Supabase
- عدم استخدام البيانات الفعلية من الـ SQL Schema

## الحلول المطلوبة:

### 1. إعداد Supabase بشكل صحيح

#### أ) إنشاء مشروع Supabase جديد:
```bash
# خطوات الإعداد
1. إنشاء حساب على supabase.com
2. إنشاء مشروع جديد: "wardah-process-costing"
3. نسخ PROJECT_URL و ANON_KEY
```

#### ب) تحديث config.json:
```json
{
  "SUPABASE_URL": "https://YOUR_PROJECT_ID.supabase.co",
  "SUPABASE_ANON_KEY": "YOUR_ANON_KEY_HERE",
  "SUPABASE_SERVICE_KEY": "YOUR_SERVICE_ROLE_KEY",
  "TABLE_NAMES": {
    "organizations": "organizations",
    "gl_accounts": "gl_accounts", 
    "gl_mappings": "gl_mappings",
    "products": "products",
    "uoms": "uoms",
    "warehouses": "warehouses",
    "locations": "locations",
    "bom_headers": "bom_headers",
    "bom_lines": "bom_lines",
    "manufacturing_orders": "manufacturing_orders",
    "work_centers": "work_centers",
    "labor_entries": "labor_entries",
    "overhead_rates": "overhead_rates",
    "overhead_allocations": "overhead_allocations",
    "stock_moves": "stock_moves",
    "stock_quants": "stock_quants",
    "purchase_orders": "purchase_orders",
    "purchase_lines": "purchase_lines",
    "sales_orders": "sales_orders",
    "sales_lines": "sales_lines",
    "invoices": "invoices"
  },
  "APP_SETTINGS": {
    "defaultCurrency": "SAR",
    "defaultLanguage": "ar",
    "itemsPerPage": 25,
    "autoSaveInterval": 30000,
    "orgId": "00000000-0000-0000-0000-000000000001"
  },
  "FEATURES": {
    "realtimeUpdates": true,
    "advancedCosting": true,
    "multiTenant": true,
    "demoMode": false
  }
}
```

### 2. تنفيذ Database Schema في Supabase

#### خطوات التنفيذ:
```sql
-- 1. تنفيذ في Supabase SQL Editor
-- تنفيذ الملفات بالترتيب:

-- أ) إنشاء الجداول الأساسية
\i wardah-migration-schema.sql

-- ب) تطبيق سياسات الأمان
\i wardah-rls-policies.sql  

-- ج) إضافة دوال AVCO
\i wardah-avco-functions.sql

-- د) استيراد البيانات الأساسية
COPY gl_accounts FROM 'wardah_enhanced_coa.csv' WITH CSV HEADER;
COPY gl_mappings FROM 'wardah_gl_mappings.csv' WITH CSV HEADER;
```

### 3. إنشاء Supabase Service Layer

#### src/lib/supabase.ts:
```typescript
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: 'wardah-erp-auth',
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// Helper functions
export const getOrgContext = () => {
  return import.meta.env.VITE_ORG_ID || '00000000-0000-0000-0000-000000000001';
};

export const withOrgContext = (query: any) => {
  return query.eq('org_id', getOrgContext());
};
```

### 4. إنشاء React Query Hooks

#### src/hooks/useManufacturingOrders.ts:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, withOrgContext } from '@/lib/supabase';
import { ManufacturingOrder } from '@/types/manufacturing';

export const useManufacturingOrders = () => {
  return useQuery({
    queryKey: ['manufacturing-orders'],
    queryFn: async () => {
      const { data, error } = await withOrgContext(
        supabase.from('manufacturing_orders').select('*')
      );
      
      if (error) throw error;
      return data as ManufacturingOrder[];
    },
  });
};

export const useCreateManufacturingOrder = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (order: Omit<ManufacturingOrder, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('manufacturing_orders')
        .insert(order)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] });
    },
  });
};
```

### 5. تحديث المكونات لاستخدام البيانات الحقيقية

#### تحديث StageCostingPanel:
```typescript
// بدلاً من البيانات التجريبية
const { data: manufacturingOrders, isLoading } = useManufacturingOrders();
const { data: workCenters } = useWorkCenters();
const createStageCost = useCreateStageCost();

// استخدام البيانات الفعلية بدلاً من:
// loadSampleData() مع بيانات وهمية
```

### 6. إعداد Realtime Subscriptions

#### src/hooks/useRealtimeSubscription.ts:
```typescript
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export const useRealtimeSubscription = (tableName: string, queryKey: string[]) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`wardah-${tableName}`)
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: tableName },
        (payload) => {
          console.log('Realtime update:', payload);
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tableName, queryKey, queryClient]);
};
```

### 7. أمان وRLS

#### إعداد المصادقة:
```typescript
// src/hooks/useAuth.ts
export const useAuth = () => {
  const [user, setUser] = useState(null);
  
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return { user, signIn, signOut, loading };
};
```

## النتائج المتوقعة بعد التنفيذ:
✅ ربط كامل بين Frontend والـ Backend
✅ استخدام البيانات الحقيقية من PostgreSQL  
✅ نظام Realtime فعال ومتكامل
✅ أمان متقدم مع RLS
✅ تحسين الأداء مع React Query