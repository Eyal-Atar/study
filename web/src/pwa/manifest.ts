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
  // S31 made /calendar the home, but start_url stays /today: /today redirects to it, and changing
  // start_url without an id would make the installed app a different app (decision 13).
  start_url: '/today',
  scope: '/',
  theme_color: '#4f7a3a',
  background_color: '#eef0e4',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    // The shape stays inside the inner 80%, the part every platform's mask keeps.
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
