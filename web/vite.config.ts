import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { findSecretKeys } from './src/config/env.ts'
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
export default defineConfig(({ mode }) => {
  // Every VITE_ value is bundled into the browser code, so a Supabase secret key stops dev and build
  // before it can get there. loadEnv reads web/.env* and the VITE_ variables of the shell.
  const secretKeys = findSecretKeys(loadEnv(mode, process.cwd(), 'VITE_'))
  if (secretKeys.length > 0) {
    throw new Error(
      `${secretKeys.join(', ')}: a Supabase secret key (sb_secret_… or a legacy service_role JWT) must never reach the browser bundle. ` +
        'Delete it from web/.env (or the shell), and revoke it in Supabase (Project Settings → API Keys). ' +
        'The web app takes only the publishable key (sb_publishable_…).',
    )
  }

  return {
    plugins: [react(), tailwindcss(), productName()],
    // Google, Supabase and CORS_ORIGINS allow exactly http://localhost:5173: fail rather than move to another port.
    server: { port: 5173, strictPort: true },
    build: {
      rolldownOptions: {
        output: {
          // Vendor code in chunks of its own, so no chunk passes Vite's 500 kB warning, and browsers keep
          // the vendor chunks cached across releases of the app. [\\/] matches the path separator on any OS.
          codeSplitting: {
            groups: [
              { name: 'supabase', test: /[\\/]node_modules[\\/]@supabase[\\/]/ },
              { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
              {
                name: 'react-aria',
                test: /[\\/]node_modules[\\/](react-aria-components|react-aria|react-stately|@react-aria|@react-stately|@react-types|@internationalized)[\\/]/,
              },
            ],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      restoreMocks: true,
    },
  }
})
