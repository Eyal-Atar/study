// @vitest-environment node
/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'

// Read from disk: Vitest does not load CSS content into tests.
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

function color(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
  if (match?.[1] === undefined) throw new Error(`--color-${name} is not defined as #rrggbb`)
  return match[1]
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// The eight exam colours (decisions 5, 20 and 25). Each has a strong, a soft and a line token.
const EXAM = ['0', '1', '2', '3', '4', '5', '6', '7'] as const

// WCAG AA for normal text: 4.5:1 (spec 7.9). Every text and background pair that
// docs/design/design-language.md allows is here; a new pair is added here first. `brand` (the leaf
// green) is not text: it is 4.4:1 on the page, so green text is `brand-strong` (S31 decision 18).
const TEXT = ['ink', 'ink-muted', 'brand-strong', 'danger', 'success', 'warning', 'now-text'] as const
const BACKGROUNDS = ['canvas', 'surface', 'surface-muted'] as const
const PAIRS: [string, string][] = [
  ...TEXT.flatMap((fg) => BACKGROUNDS.map((bg): [string, string] => [fg, bg])),
  ['on-brand', 'brand'],
  ['on-brand', 'brand-strong'],
  ['on-brand', 'success'],
  ['on-brand', 'danger'],
  // Clay, the secondary action: white on it. Clay itself is never text (4.48:1).
  ['on-clay', 'clay'],
  ['ink', 'brand-soft'],
  ['ink-muted', 'brand-soft'],
  ['brand-strong', 'brand-soft'],
  ['ink', 'danger-soft'],
  ['danger', 'danger-soft'],
  ['ink', 'success-soft'],
  ['success', 'success-soft'],
  ['ink', 'warning-soft'],
  ['warning', 'warning-soft'],
  // Gold carries XP, the level and badges, with ink on it; the gold chip of XP is gold-ink on
  // gold-soft (S31 decision 26).
  ['ink', 'gold'],
  ['gold-ink', 'gold-soft'],
  ['ink', 'gold-soft'],
  // The white of a field and of a choice card (S31 decision 26): its value, its placeholder and
  // the selected text of a choice.
  ['ink', 'field'],
  ['ink-muted', 'field'],
  ['danger', 'field'],
  // The dawn sky behind Archie: ink on both ends of the gradient and on the tone between them.
  ['ink', 'sky'],
  ['ink', 'sky-from'],
  ['ink', 'sky-to'],
  // The bark toast (S31): its text, its quiet action ("Undo") and its state icons, all on `inverse`.
  ['on-inverse', 'inverse'],
  ['inverse-action', 'inverse'],
  ['inverse-success', 'inverse'],
  ['inverse-danger', 'inverse'],
  // The colour of an exam (S31): text inside a block is `ink` on the soft fill or on the line,
  // and the "next task" card is white on the strong colour.
  ...EXAM.flatMap((n): [string, string][] => [
    ['ink', `exam-${n}-soft`],
    ['ink', `exam-${n}-line`],
    ['on-brand', `exam-${n}`],
  ]),
  // Busy time (S31, drawn by the calendar scope): the name and the time of a commitment or an
  // event, in ink and in ink-muted, on its fill.
  ['ink', 'busy-soft'],
  ['ink-muted', 'busy-soft'],
]

// WCAG 1.4.11 for the parts of controls (field and choice borders, the focus ring, the filled
// part of a meter on its track): 3:1.
const NON_TEXT_PAIRS: [string, string][] = [
  ...BACKGROUNDS.map((bg): [string, string] => ['line-strong', bg]),
  ...BACKGROUNDS.map((bg): [string, string] => ['brand', bg]),
  // The border of a field and the focus ring around it, on its white.
  ['line-strong', 'field'],
  ['brand', 'field'],
  ['danger', 'field'],
  ['brand', 'brand-soft'],
  ['success', 'line'],
  // The filled part of a progress bar on its track.
  ['success', 'surface-muted'],
  ['brand', 'surface-muted'],
  // The "now" line of the calendar (a line, not text; its time is now-text).
  ['now', 'surface'],
  ['now', 'canvas'],
  // An exam colour as a mark (a stripe, a dot, a border) on its soft fill and on the page.
  ...EXAM.flatMap((n): [string, string][] => [
    [`exam-${n}`, `exam-${n}-soft`],
    [`exam-${n}`, 'surface'],
    [`exam-${n}`, 'canvas'],
  ]),
  // The stronger tone of busy time as a mark (a stripe, an icon) on its fill and on the page.
  ['busy', 'busy-soft'],
  ['busy', 'surface'],
]

// The tokens the design language names (docs/design/design-language.md). S26-S28 build on these
// names, so removing or renaming one is a breaking change.
const TOKENS = [
  ...[
    'canvas', 'surface', 'surface-muted', 'ink', 'ink-muted', 'line', 'line-strong', 'brand', 'brand-strong',
    'brand-soft', 'on-brand', 'sprout', 'clay', 'on-clay', 'sand', 'gold', 'gold-soft', 'gold-ink', 'gold-track',
    'field', 'sky-from', 'sky-to', 'sky', 'now',
    'now-text', 'danger', 'danger-soft', 'success', 'success-soft', 'warning', 'warning-soft', 'inverse',
    'on-inverse', 'inverse-action', 'inverse-success', 'inverse-danger',
    ...EXAM.flatMap((n) => [`exam-${n}`, `exam-${n}-soft`, `exam-${n}-line`]),
    'busy', 'busy-soft', 'busy-line',
  ].map((name) => `--color-${name}`),
  '--radius-sheet',
  '--radius-button',
  '--font-display',
  '--shadow-raised',
  '--shadow-lift',
  '--shadow-sheet',
  '--spacing-topbar',
  '--spacing-bottombar',
  '--font-sans',
  '--font-weight-medium',
  '--font-weight-bold',
  '--text-display',
  '--text-display--line-height',
  '--text-title',
  '--text-title--line-height',
  '--text-body',
  '--text-body--line-height',
  '--text-small',
  '--text-small--line-height',
  '--text-caption',
  '--text-caption--line-height',
  '--spacing-touch',
  '--spacing-gutter',
  '--spacing-card',
  '--spacing-section',
  '--radius-badge',
  '--radius-control',
  '--radius-card',
  '--shadow-overlay',
  '--ease-standard',
  '--default-transition-duration',
  '--default-transition-timing-function',
  '--duration-fast',
  '--duration-base',
  '--duration-slow',
]

// The values aligned to the all-screens mockup (S31 decisions 25-27): the exam shades, the quiet
// fill, the toast, the new field and gold tokens, the corners and the height of the top bar.
const VALUES: [string, string][] = [
  ['--color-exam-0', '#6b7a2f'], ['--color-exam-0-soft', '#eef0d9'], ['--color-exam-0-line', '#c9cf9c'],
  ['--color-exam-1', '#b0532f'], ['--color-exam-1-soft', '#f8e6dc'], ['--color-exam-1-line', '#e8b79d'],
  ['--color-exam-2', '#4a6b84'], ['--color-exam-2-soft', '#e2ebf2'], ['--color-exam-2-line', '#a9c0d2'],
  ['--color-exam-3', '#7b4a6d'], ['--color-exam-3-soft', '#f1e3ec'], ['--color-exam-3-line', '#d2aec6'],
  ['--color-exam-4', '#8a6410'], ['--color-exam-4-soft', '#f7ecd2'], ['--color-exam-4-line', '#e2c78a'],
  ['--color-exam-5', '#2f6f62'], ['--color-exam-5-soft', '#dcefe9'], ['--color-exam-5-line', '#9dcdc0'],
  ['--color-exam-6', '#a3485b'], ['--color-exam-6-soft', '#f7e2e6'], ['--color-exam-6-line', '#e2aab5'],
  ['--color-exam-7', '#7a5236'], ['--color-exam-7-soft', '#f1e6dc'], ['--color-exam-7-line', '#d2b49c'],
  ['--color-surface-muted', '#e6e7d8'],
  ['--color-on-inverse', '#f3ead9'],
  ['--color-inverse-action', '#cfe3b4'],
  ['--color-field', '#ffffff'],
  ['--color-gold-soft', '#f6e7c6'],
  ['--color-gold-ink', '#6b4a12'],
  ['--color-gold-track', '#eadfc4'],
  ['--radius-badge', '0.375rem'],
  ['--radius-control', '0.75rem'],
  ['--radius-button', '0.875rem'],
  ['--radius-card', '1.125rem'],
  ['--radius-sheet', '1.5rem'],
  ['--spacing-topbar', '3.75rem'],
]

describe('the values of the mockup', () => {
  it.each(VALUES)('%s is %s', (token, value) => {
    expect(new RegExp(`${token}:\\s*([^;]+);`).exec(css)?.[1]?.trim().toLowerCase()).toBe(value)
  })
})

describe('theme colours', () => {
  it.each(PAIRS)('%s on %s passes AA', (fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(NON_TEXT_PAIRS)('%s on %s passes 3:1 for non-text contrast', (fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(3)
  })
})

describe('design tokens', () => {
  it.each(TOKENS)('%s is defined', (token) => {
    expect(css).toMatch(new RegExp(`${token}:\\s*[^;]+;`))
  })

  it('the eight exam colours differ from each other', () => {
    const strong = EXAM.map((n) => color(`exam-${n}`).toLowerCase())
    expect(new Set(strong).size).toBe(8)
  })

  // "Done" is drawn in the brand green, so no exam may look like it (S31 decision 20).
  it('no exam colour is the brand green', () => {
    const greens = [color('brand').toLowerCase(), color('brand-strong').toLowerCase()]
    for (const n of EXAM) expect(greens).not.toContain(color(`exam-${n}`).toLowerCase())
  })

  // The logo mark is a gradient from brand to sprout now (S31 decision 18).
  it('brand-accent is gone', () => {
    expect(css).not.toMatch(/--color-brand-accent:/)
  })

  it('busy time has its own tone, apart from the quiet fill and from the earth of exam 7', () => {
    const fill = color('busy-soft').toLowerCase()
    expect(fill).not.toBe(color('surface-muted').toLowerCase())
    expect(fill).not.toBe(color('exam-7-soft').toLowerCase())
  })

  it('the weights are the real ones of Rubik: 500 for labels, 700 for the logo', () => {
    expect(css).toMatch(/--font-weight-medium:\s*500;/)
    expect(css).toMatch(/--font-weight-bold:\s*700;/)
  })

  it('the touch target is 44px', () => {
    expect(css).toMatch(/--spacing-touch:\s*2\.75rem;/)
  })

  it('motion stops for prefers-reduced-motion', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(css)?.[0] ?? ''
    expect(block).toMatch(/transition-duration:\s*0\.01ms !important/)
    expect(block).toMatch(/animation-duration:\s*0\.01ms !important/)
  })
})

describe('the fonts', () => {
  const faces = css.match(/@font-face \{[\s\S]*?\}/g) ?? []
  const rubik = faces.filter((face) => /font-family:\s*'Rubik'/.test(face))
  const amatic = faces.filter((face) => /font-family:\s*'Amatic SC'/.test(face))

  it('are self-hosted: Rubik and Amatic SC, each in two subsets, Hebrew and Latin', () => {
    expect(faces).toHaveLength(4)
    expect(rubik).toHaveLength(2)
    expect(amatic).toHaveLength(2)
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
  })

  it.each(faces.map((face, i): [number, string] => [i, face]))('face %i swaps, has a unicode-range and a small woff2', (_i, face) => {
    expect(face).toMatch(/font-display:\s*swap;/)
    expect(face).toMatch(/unicode-range:\s*U\+/)
    const url = /url\('(\.\/assets\/fonts\/[^']+\.woff2)'\)/.exec(face)?.[1]
    expect(url).toBeDefined()
    const file = new URL(url ?? '', import.meta.url)
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).size).toBeLessThan(60_000)
  })

  // One variable file of Rubik carries every weight, 400 to 700.
  it.each(rubik.map((face, i): [number, string] => [i, face]))('Rubik face %i is variable, 400 to 700', (_i, face) => {
    expect(face).toMatch(/font-weight:\s*400 700;/)
  })

  // Amatic SC is the display font of the logo and of Archie's big headings (S31 decision 28):
  // Bold only, and the browser must never fake another weight of it.
  it.each(amatic.map((face, i): [number, string] => [i, face]))('Amatic SC face %i is the bold alone', (_i, face) => {
    expect(face).toMatch(/font-weight:\s*700;/)
  })

  it('the two subsets of each font cover the same characters', () => {
    const ranges = (list: string[]) => list.map((face) => /unicode-range:\s*([^;]+);/.exec(face)?.[1]).sort()
    expect(ranges(amatic)).toEqual(ranges(rubik))
  })

  it.each([
    ['OFL.txt', /Rubik/],
    ['OFL-AmaticSC.txt', /Amatic SC/],
  ])('come with their licence: %s', (name, author) => {
    const licence = new URL(`./assets/fonts/${name}`, import.meta.url)
    expect(existsSync(licence)).toBe(true)
    const text = readFileSync(licence, 'utf8')
    expect(text).toMatch(author)
    expect(text).toMatch(/SIL Open Font License/)
  })

  it('Rubik is the first family of --font-sans, with a system fallback', () => {
    expect(css).toMatch(/--font-sans:\s*'Rubik',[^;]*sans-serif;/)
  })

  it('Amatic SC is the first family of --font-display, then Rubik', () => {
    expect(css).toMatch(/--font-display:\s*'Amatic SC',\s*'Rubik',[^;]*sans-serif;/)
  })
})

// `brand` as text is 4.4:1 on the page (S31 decision 18): green text is text-brand-strong. Tailwind
// finds classes as they are written, so a scan of the source finds every use. Tests are left out:
// they may name the class to check that it is not there.
describe('the brand green as text', () => {
  const src = new URL('./', import.meta.url)

  function tsxFiles(dir: URL): URL[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) return tsxFiles(new URL(`${entry.name}/`, dir))
      if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) return [new URL(entry.name, dir)]
      return []
    })
  }

  it('no component uses text-brand', () => {
    const files = tsxFiles(src)
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter((file) => /text-brand(?![-\w])/.test(readFileSync(file, 'utf8')))
    expect(offenders.map((file) => file.pathname.slice(src.pathname.length))).toEqual([])
  })
})

// S34: large text (WCAG: 18.66px bold and up, 3:1). The only one is the initial of an exam
// (ui/ExamMark.tsx, ExamInitial): exam-N on exam-N-soft, in text-title (20px) and font-bold, and
// nowhere smaller or lighter (S34 decision 10).
const LARGE_TEXT_PAIRS: [string, string][] = EXAM.map((n): [string, string] => [`exam-${n}`, `exam-${n}-soft`])

describe('large text pairs (S34)', () => {
  it.each(LARGE_TEXT_PAIRS)('%s on %s passes 3:1 for large text', (fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(3)
  })
})
