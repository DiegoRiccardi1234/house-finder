import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev: Vite su :5173, proxy di /api verso il server Express (:3000).
// Build: output in ui/dist, servito da Express in produzione locale.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: { outDir: 'dist' },
});
