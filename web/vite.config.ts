import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { PRODUCT_NAME } from './src/product.ts'

// Writes the product name into index.html, so it is written only in src/product.ts.
// 'pre' runs before Vite's own %ENV% replacement, which would warn about an unknown variable.
function productName(): Plugin {
  return {
    name: 'product-name',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%PRODUCT_NAME%', PRODUCT_NAME),
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), productName()],
  // Google, Supabase and CORS_ORIGINS allow exactly http://localhost:5173: fail rather than move to another port.
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})
