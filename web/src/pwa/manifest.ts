import type { ManifestOptions } from 'vite-plugin-pwa'
import { PRODUCT_NAME } from '../product.ts'

// The web app manifest (decision 16). vite.config.ts hands it to VitePWA, which writes
// dist/manifest.webmanifest and links it from index.html. A manifest cannot read CSS variables, so
// the colours repeat --color-brand and --color-canvas (the page) of index.css; manifest.test.ts keeps
// them equal. The icons are temporary, drawn by a script; branding (S17) replaces them.
export const manifest: Partial<ManifestOptions> = {
  name: PRODUCT_NAME,
  short_name: PRODUCT_NAME,
  lang: 'he',
  dir: 'rtl',
  display: 'standalone',
  start_url: '/today',
  scope: '/',
  theme_color: '#2f5aa8',
  background_color: '#faf9f6',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    // The shape stays inside the inner 80%, the part every platform's mask keeps.
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
