import { heCrash } from '../i18n/heCrash.ts'

// The boot fallback in index.html runs before (and without) the app's modules, so it cannot import
// he.ts: vite.config.ts writes these texts into it at build time, as a JSON object literal.
export function fillBootTexts(html: string): string {
  const { title, body, reload, details } = heCrash
  // JSON is a valid JS literal; "<" is escaped so the text can never close the <script>.
  const texts = JSON.stringify({ title, body, reload, details }).replaceAll('<', '\\u003c')
  return html.replaceAll('%BOOT_TEXTS%', texts)
}
