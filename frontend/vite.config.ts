import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'perspective': [
            '@finos/perspective',
            '@finos/perspective-viewer',
            '@finos/perspective-viewer-datagrid',
            '@finos/perspective-viewer-d3fc'
          ],
          'vendor': ['react', 'react-dom', 'react-router-dom', 'axios', 'zustand']
        }
      }
    }
  },
  optimizeDeps: {
    exclude: ['@finos/perspective']
  }
});
