import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Khi dev (npm run dev, port 5173), mọi request /api được proxy sang backend
// Express (port 3001). Khi build, backend phục vụ trực tiếp thư mục dist/.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
