import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Uncomment to proxy API calls through Vite dev server (avoids CORS in some setups)
      // '/api': { target: 'http://localhost:8000', changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') }
    }
  }
})
