import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc'; // Corrected the import to use the installed package
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
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