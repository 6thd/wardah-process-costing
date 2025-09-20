# خطة الترحيل إلى TypeScript

## الخطوات المطلوبة:

### 1. تحديث package.json
```json
{
  "name": "wardah-erp-enterprise",
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@radix-ui/react-avatar": "^1.0.4",
    "@radix-ui/react-dropdown-menu": "^2.0.6",
    "@radix-ui/react-icons": "^1.3.0",
    "@radix-ui/react-label": "^2.1.7",
    "@radix-ui/react-scroll-area": "^1.0.5",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-slot": "^1.2.3",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-toast": "^1.2.15",
    "@supabase/auth-helpers-react": "^0.5.0",
    "@supabase/supabase-js": "^2.57.4",
    "@tanstack/react-query": "^5.8.4",
    "@tanstack/react-query-devtools": "^5.8.4",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.0.0",
    "i18next": "^23.7.6",
    "i18next-browser-languagedetector": "^7.2.0",
    "lucide-react": "^0.294.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-i18next": "^13.5.0",
    "react-router-dom": "^6.20.1",
    "sonner": "^1.2.4",
    "tailwind-merge": "^2.0.0",
    "tailwindcss-animate": "^1.0.7",
    "zustand": "^4.4.7"
  },
  "devDependencies": {
    "@types/node": "^20.9.0",
    "@types/react": "^18.2.37",
    "@types/react-dom": "^18.2.15",
    "@typescript-eslint/eslint-plugin": "^6.10.0",
    "@typescript-eslint/parser": "^6.10.0",
    "@vitejs/plugin-react-swc": "^3.5.0",
    "autoprefixer": "^10.4.16",
    "eslint": "^8.53.0",
    "postcss": "^8.4.31",
    "tailwindcss": "^3.3.5",
    "typescript": "^5.2.2",
    "vite": "^5.0.0"
  }
}
```

### 2. إنشاء ملفات التكوين

#### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": false,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@/components/*": ["./src/components/*"],
      "@/features/*": ["./src/features/*"],
      "@/lib/*": ["./src/lib/*"],
      "@/hooks/*": ["./src/hooks/*"],
      "@/store/*": ["./src/store/*"],
      "@/types/*": ["./src/types/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 3. تحويل app.js إلى TypeScript
- إعادة كتابة الكلاس الرئيسي بـ TypeScript
- إضافة Type definitions للبيانات
- تحسين error handling

### 4. إضافة Types للبيانات
```typescript
// types/manufacturing.ts
export interface ManufacturingOrder {
  id: string;
  org_id: string;
  mo_number: string;
  product_id: string;
  qty_planned: number;
  qty_produced: number;
  status: 'draft' | 'in_progress' | 'done' | 'cancelled';
  work_center?: string;
  start_ts?: string;
  end_ts?: string;
  created_at: string;
  updated_at: string;
}

export interface StageCost {
  id: string;
  mo_id: string;
  stage_number: number;
  work_center: string;
  dm_cost: number;
  dl_cost: number;
  moh_cost: number;
  total_cost: number;
  unit_cost: number;
  efficiency_rate: number;
  quality_rate: number;
}
```