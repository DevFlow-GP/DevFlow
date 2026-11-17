import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // The backend only accepts requests from this origin (CORS_ALLOWED_ORIGINS),
    // so fail loudly instead of silently moving to 5174 when the port is taken.
    port: 5173,
    strictPort: true,
  },
});
