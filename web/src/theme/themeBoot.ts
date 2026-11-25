import { DAY_STARTS_MIN, DUSK_STARTS_MIN, THEME_CHOICES, THEME_COLOR, THEME_STORAGE_KEY } from './theme.ts'

// The theme boot script (S43). React paints only after the modules have loaded, so without this a
// student opening the app at 23:00 would see a flash of the light page before it turns dark. A
// classic inline script in <head> runs while the page is parsed, before the first paint, and sets
// <html data-theme> and the browser bar's colour. It cannot import theme.ts (it runs before the
// bundle, and without it), so it is built here as a string from theme.ts's constants, and
// vite.config.ts writes it into index.html in place of %THEME_BOOT%. themeBoot.test.ts runs it at
// every minute of the day and checks it against resolveTheme(). ES5 only: old browsers parse it too.

// JSON is a valid JS literal; "<" is escaped so a value can never close the <script>.
function literal(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

export const THEME_BOOT_SCRIPT: string = [
  '(function () {',
  `  var choices = ${literal(THEME_CHOICES)}`,
  `  var colors = ${literal(THEME_COLOR)}`,
  "  var c = 'auto'",
  '  try {',
  `    c = window.localStorage.getItem(${literal(THEME_STORAGE_KEY)})`,
  '  } catch (e) {}',
  "  if (typeof c !== 'string' || choices.indexOf(c) === -1) c = 'auto'",
  '  var now = new Date()',
  '  var m = now.getHours() * 60 + now.getMinutes()',
  `  var t = c === 'auto' ? (m >= ${String(DUSK_STARTS_MIN)} || m < ${String(DAY_STARTS_MIN)} ? 'dusk' : 'day') : c`,
  "  document.documentElement.setAttribute('data-theme', t)",
  "  var meta = document.querySelector('meta[name=\"theme-color\"]')",
  "  if (meta) meta.setAttribute('content', colors[t])",
  '})()',
].join('\n')

const PLACEHOLDER = '%THEME_BOOT%'

// Exactly one placeholder: none would ship a page that flashes, two would run the script twice.
export function fillThemeBoot(html: string): string {
  const count = html.split(PLACEHOLDER).length - 1
  if (count !== 1) throw new Error(`index.html must hold ${PLACEHOLDER} exactly once, found ${String(count)}`)
  // A function replacement, so "$" in the script is never read as a replacement pattern.
  return html.replace(PLACEHOLDER, () => THEME_BOOT_SCRIPT)
}
