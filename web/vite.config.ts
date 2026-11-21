import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults, defineConfig } from 'vitest/config'
import { findSecretKeys } from './src/config/env.ts'
import { manifest } from './src/pwa/manifest.ts'
import { fillBootTexts } from './src/pwa/bootTexts.ts'
import { PRODUCT_NAME } from './src/product.ts'

// Writes the product name into index.html, so it is written only in src/product.ts, and the boot
// fallback's texts from en.ts (src/pwa/bootTexts.ts).
// 'pre' runs before Vite's own %ENV% replacement, which would warn about an unknown variable.
function productName(): Plugin {
  return {
    name: 'product-name',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => fillBootTexts(html.replaceAll('%PRODUCT_NAME%', PRODUCT_NAME)),
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
    plugins: [
      react(),
      tailwindcss(),
      productName(),
      // The PWA (decisions 14-16): our own worker (src/sw.ts) with the build's file list injected,
      // and the manifest. src/pwa/register.ts registers the worker, in production builds only.
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: false,
        manifest,
        // <link rel="manifest" crossorigin="use-credentials">: a manifest request carries no cookies by
        // default, so behind a gate that relies on one (ngrok's warning page in the iPhone test) the
        // browser got HTML instead of the manifest and could not install the app.
        useCredentials: true,
        // The plugin precaches the manifest and its icons; this adds the notification badge and
        // the apple-touch-icon (duplicates are dropped), so every icon works offline.
        includeAssets: ['icons/*.png'],
        injectManifest: {
          // One classic script: every browser runs it, including those without module workers.
          rollupFormat: 'iife',
        },
        devOptions: { enabled: false },
      }),
    ],
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
      // pending-s34 holds two test files parked until Tasks 4 and 7 bring their modules back.
      exclude: [...configDefaults.exclude, 'pending-s34/**'],
    },
  }
})
