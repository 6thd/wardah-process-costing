import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import path from 'node:path' // NOSONAR S6443 - path.resolve is required by Vite config

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    passWithNoTests: true,
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'
    ],
        exclude: [
          'node_modules',
          '**/node_modules/**',
          'dist',
          '.next',
          '**/proxy-service/node_modules/**',
          '**/proxy-service/dist/**',
          '**/*.config.*',
          '**/coverage/**'
        ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      enabled: true,
      all: true,
      // P4-E1: أرضية تغطية ضد الانحدار — مضبوطة على القياس الفعلي منقوصاً
      // هامشاً (سطور 19% لأن all:true يحسب كل src بما فيه غير المختبَر؛
      // دوال 44%، فروع 68%). ترفع تدريجياً مع نمو الاختبارات
      thresholds: {
        lines: 15,
        statements: 15,
        functions: 38,
        branches: 60
      },
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'src/test/',
        'src/types/database.ts',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/',
        '**/dist/',
        '**/__tests__/**',
        '**/*.test.*',
        '**/*.spec.*'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/domain': path.resolve(__dirname, './src/domain'),
      '@/features': path.resolve(__dirname, './src/features')
    }
  }
})