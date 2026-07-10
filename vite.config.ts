import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc'; // Corrected the import to use the installed package
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // P4-D3: تقسيم الحزمة — كانت 3.9MB في ملف واحد.
    // المكتبات المستقرة تنفصل فتُكاش لدى المتصفح عبر النشرات
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-charts': ['recharts'],
          'vendor-ui': ['lucide-react', 'sonner', 'date-fns'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    headers: {
      'X-Frame-Options': 'SAMEORIGIN',
      'X-Content-Type-Options': 'nosniff',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    },
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..'],
    },
    // Proxy configuration to forward requests to the proxy service
    proxy: {
      '/api/data': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/api/financial': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      }
    }
  },
});