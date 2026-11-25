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

// The evening values (S43): the block `:root[data-theme='dusk'] { ... }`, which comes after @theme,
// so color() above keeps reading the day.
const DUSK_BLOCK = /:root\[data-theme='dusk'\]\s*\{([\s\S]*?)\n\}/
const THEME_BLOCK = /@theme \{([\s\S]*?)\n\}/
const duskBlock = DUSK_BLOCK.exec(css)?.[1] ?? ''
// The stylesheet without the evening block: what the day defines on its own.
const outsideDusk = css.replace(DUSK_BLOCK, '')

// The colour names a block defines (`--color-<name>:`), sorted.
function colorNamesOf(block: string): string[] {
  return [...new Set([...block.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1] ?? ''))].sort()
}

// The evening-only token: the lantern glow has no day value.
const DUSK_ONLY = ['canvas-glow']

// What the evening block is missing against @theme, and what it has that @theme does not, in a
// stylesheet. Empty both ways means every day colour has an evening value and nothing more.
function duskGaps(text: string): { missing: string[]; extra: string[] } {
  const day = colorNamesOf(THEME_BLOCK.exec(text)?.[1] ?? '')
  const dusk = colorNamesOf(DUSK_BLOCK.exec(text)?.[1] ?? '').filter((n) => !DUSK_ONLY.includes(n))
  return { missing: day.filter((n) => !dusk.includes(n)), extra: dusk.filter((n) => !day.includes(n)) }
}

function duskColor(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(duskBlock)
  if (match?.[1] === undefined) throw new Error(`--color-${name} is not defined as #rrggbb in the dusk block`)
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
  ['success', 'track'],
  ['brand', 'track'],
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

// S34: large text (WCAG: 18.66px bold and up, 3:1). The only one is the initial of an exam
// (ui/ExamMark.tsx, ExamInitial): exam-N on exam-N-soft, in text-title (20px) and font-bold, and
// nowhere smaller or lighter (S34 decision 10).
const LARGE_TEXT_PAIRS: [string, string][] = EXAM.map((n): [string, string] => [`exam-${n}`, `exam-${n}-soft`])

// The tokens the design language names (docs/design/design-language.md). S26-S28 build on these
// names, so removing or renaming one is a breaking change.
const COLOR_NAMES = [
    'canvas', 'surface', 'surface-muted', 'ink', 'ink-muted', 'line', 'line-strong', 'brand', 'brand-strong',
    'brand-soft', 'on-brand', 'sprout', 'clay', 'on-clay', 'sand', 'gold', 'gold-soft', 'gold-ink', 'gold-track',
    'field', 'sky-from', 'sky-to', 'sky', 'now',
    'now-text', 'danger', 'danger-soft', 'success', 'success-soft', 'warning', 'warning-soft', 'inverse',
    'on-inverse', 'inverse-action', 'inverse-success', 'inverse-danger',
    ...EXAM.flatMap((n) => [`exam-${n}`, `exam-${n}-soft`, `exam-${n}-line`]),
    'busy', 'busy-soft', 'busy-line', 'scrim', 'track',
]

const TOKENS = [
  ...COLOR_NAMES.map((name) => `--color-${name}`),
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
  // Outside the evening block, so a day token removed from @theme is not "defined" by the dusk one.
  it.each(TOKENS)('%s is defined', (token) => {
    expect(outsideDusk).toMatch(new RegExp(`${token}:\\s*[^;]+;`))
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

// The empty track of a progress bar (ui/ProgressBar, ExamProgressBar; S43 closing patch): its own
// token, so the evening can lift it without lifting every quiet fill. In the day it is surface-muted
// exactly, so the day stays pixel-identical.
describe('the progress track', () => {
  it('in the day is surface-muted', () => {
    expect(color('track')).toBe(color('surface-muted'))
  })

  // 3:1 is not reachable in this dark theme: the filled part must keep 3:1 on the track, which caps
  // how light the track can be. The day value itself is 1.09 on canvas; the evening floor is 1.5.
  it.each(['canvas', 'surface'])('in the evening reaches 1.5:1 on %s', (bg) => {
    expect(contrast(duskColor('track'), duskColor(bg))).toBeGreaterThanOrEqual(1.5)
  })
})

describe('large text pairs (S34)', () => {
  it.each(LARGE_TEXT_PAIRS)('%s on %s passes 3:1 for large text', (fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(3)
  })
})

// ---- Dusk (S43): the evening values, checked by the same pairs as the day ----
const DUSK_VALUES: [string, string][] = [
  ['canvas', '#1b1612'], ['canvas-glow', '#2c2219'], ['surface', '#251e18'], ['surface-muted', '#322920'],
  ['field', '#15110d'], ['ink', '#f1e6d3'], ['ink-muted', '#bfae96'], ['line', '#3d332a'], ['line-strong', '#8a7a66'],
  ['brand', '#7fae63'], ['brand-strong', '#9cc47f'], ['brand-soft', '#23331f'], ['on-brand', '#16120e'],
  ['sprout', '#5f8a45'], ['clay', '#c98558'], ['on-clay', '#16120e'], ['sand', '#8a6f50'], ['gold', '#845a18'],
  ['gold-soft', '#3a2d14'], ['gold-ink', '#f0c36a'], ['gold-track', '#2b241a'],
  ['sky-from', '#1d2a3a'], ['sky-to', '#33465a'], ['sky', '#26364a'], ['now', '#e0784f'], ['now-text', '#ec8c66'],
  ['danger', '#f08a6c'], ['danger-soft', '#3d1f17'], ['success', '#9cc47f'], ['success-soft', '#23331f'],
  ['warning', '#e2b05a'], ['warning-soft', '#382a12'], ['inverse', '#efe3cc'], ['on-inverse', '#241c15'],
  ['inverse-action', '#2f5a22'], ['inverse-success', '#3f6a2c'], ['inverse-danger', '#9a3518'],
  ['busy', '#a39684'], ['busy-soft', '#2c261f'], ['busy-line', '#463d33'], ['scrim', '#080604'], ['track', '#463b31'],
  ['exam-0', '#b5c36e'], ['exam-0-soft', '#2a2d18'], ['exam-0-line', '#4a5128'],
  ['exam-1', '#e8946d'], ['exam-1-soft', '#3a221a'], ['exam-1-line', '#63392a'],
  ['exam-2', '#94b6d1'], ['exam-2-soft', '#1d2833'], ['exam-2-line', '#34495b'],
  ['exam-3', '#cf9cc0'], ['exam-3-soft', '#33212e'], ['exam-3-line', '#573a4e'],
  ['exam-4', '#dcb558'], ['exam-4-soft', '#352a12'], ['exam-4-line', '#5c4a1f'],
  ['exam-5', '#7cc6b3'], ['exam-5-soft', '#17302b'], ['exam-5-line', '#2a5249'],
  ['exam-6', '#e494a5'], ['exam-6-soft', '#3a1f25'], ['exam-6-line', '#633844'],
  ['exam-7', '#d0a682'], ['exam-7-soft', '#33261c'], ['exam-7-line', '#574131'],
]

describe('dusk: the block', () => {
  it('exists and comes after @theme, so the day stays what color() reads', () => {
    expect(duskBlock).not.toBe('')
    expect(/:root\[data-theme='dusk'\]\s*\{/.exec(css)?.index ?? -1).toBeGreaterThan(css.indexOf('@theme {'))
  })

  // The set is read from @theme, not from a list: a new day colour without an evening value (or an
  // evening colour with no day one) fails here (I1 of the final review).
  it('defines exactly the colours of @theme, plus the evening-only canvas-glow', () => {
    expect(colorNamesOf(THEME_BLOCK.exec(css)?.[1] ?? '').length).toBeGreaterThan(0)
    expect(duskGaps(css)).toEqual({ missing: [], extra: [] })
  })

  it('the check fails on a colour added to @theme only, and on one added to the evening only', () => {
    const dayOnly = css.replace('@theme {', '@theme {\n  --color-foo: #123456;')
    expect(duskGaps(dayOnly)).toEqual({ missing: ['foo'], extra: [] })
    const duskOnly = css.replace(":root[data-theme='dusk'] {", ":root[data-theme='dusk'] {\n  --color-bar: #123456;")
    expect(duskGaps(duskOnly)).toEqual({ missing: [], extra: ['bar'] })
  })

  // So the pairs and the tables above never fall behind @theme either.
  it('COLOR_NAMES is the colours of @theme', () => {
    expect([...COLOR_NAMES].sort()).toEqual(colorNamesOf(THEME_BLOCK.exec(css)?.[1] ?? ''))
  })

  it.each(COLOR_NAMES)('%s is defined in the block as #rrggbb', (name) => {
    expect(() => duskColor(name.replace('--color-', ''))).not.toThrow()
  })

  it('canvas-glow is defined in the block', () => {
    expect(() => duskColor('canvas-glow')).not.toThrow()
  })

  it.each(DUSK_VALUES)('--color-%s is %s', (name, value) => {
    expect(duskColor(name).toLowerCase()).toBe(value)
  })

  it('has the dark colour scheme, the heavier scrim and the four shadows', () => {
    expect(duskBlock).toMatch(/color-scheme:\s*dark;/)
    expect(duskBlock).toMatch(/--scrim-opacity:\s*60%;/)
    for (const s of ['raised', 'overlay', 'lift', 'sheet']) {
      expect(duskBlock).toMatch(new RegExp(`--shadow-${s}:[^;]*rgb\\(0 0 0 /`))
    }
  })

  it('the day scrim and the theme duration are set outside the block', () => {
    expect(outsideDusk).toMatch(/--scrim-opacity:\s*35%;/)
    expect(outsideDusk).toMatch(/--duration-theme:\s*400ms;/)
  })

  it('the day scrim is the day ink, so the dialog backdrop matches the old bg-ink/35', () => {
    expect(color('scrim')).toBe('#3b2a1e')
    expect(color('scrim')).toBe(color('ink'))
  })
})

describe('dusk: contrast', () => {
  it.each(PAIRS)('%s on %s passes AA in the evening', (fg, bg) => {
    expect(contrast(duskColor(fg), duskColor(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(NON_TEXT_PAIRS)('%s on %s passes 3:1 in the evening', (fg, bg) => {
    expect(contrast(duskColor(fg), duskColor(bg))).toBeGreaterThanOrEqual(3)
  })

  it.each(LARGE_TEXT_PAIRS)('%s on %s passes 3:1 for large text in the evening', (fg, bg) => {
    expect(contrast(duskColor(fg), duskColor(bg))).toBeGreaterThanOrEqual(3)
  })

  it('text passes AA on the lantern glow', () => {
    for (const fg of TEXT) expect(contrast(duskColor(fg), duskColor('canvas-glow'))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['line-strong', 'brand', 'now'])('%s passes 3:1 on the lantern glow', (fg) => {
    expect(contrast(duskColor(fg), duskColor('canvas-glow'))).toBeGreaterThanOrEqual(3)
  })

  it('the eight exam colours differ, and none is a brand green of the evening', () => {
    const strong = EXAM.map((n) => duskColor(`exam-${n}`).toLowerCase())
    expect(new Set(strong).size).toBe(8)
    const greens = [duskColor('brand').toLowerCase(), duskColor('brand-strong').toLowerCase()]
    for (const c of strong) expect(greens).not.toContain(c)
  })

  it('busy time keeps its own tone in the evening', () => {
    const fill = duskColor('busy-soft').toLowerCase()
    expect(fill).not.toBe(duskColor('surface-muted').toLowerCase())
    expect(fill).not.toBe(duskColor('exam-7-soft').toLowerCase())
  })
})

describe('dusk: the rules outside the block', () => {
  it('the focus ring offset follows the surface, in @layer base', () => {
    const base = /@layer base \{[\s\S]*?\n\}/.exec(css)?.[0] ?? ''
    expect(base).toContain(":root[data-theme='dusk'] *")
    expect(base).toContain('--tw-ring-offset-color: var(--color-surface)')
  })

  it('the transition exists only inside prefers-reduced-motion: no-preference', () => {
    const media = /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/.exec(css)?.[0] ?? ''
    expect(media).toContain('data-theme-switching')
    expect(css.replace(media, '')).not.toContain('data-theme-switching')
  })

  // S2 of the screenshots: on the dark page the day glow of Archi's gold stone reads as a lit disc
  // with an edge. In the evening both glows (stone and hand) get a softer gradient that fades out
  // over many steps, and the day rule stays as it was.
  it("Archi's glow is softer in the evening, and the day glow is unchanged", () => {
    const archie = readFileSync(new URL('./archie/archie.css', import.meta.url), 'utf8')
    const rule = /:root\[data-theme='dusk'\] \.archie-glow[^{]*\{([^}]*)\}/.exec(archie)?.[1] ?? ''
    expect(rule).toMatch(/radial-gradient\(/)
    const alphas = [...rule.matchAll(/rgba\([^)]*,\s*([0-9.]+)\)/g)].map((m) => Number(m[1]))
    expect(alphas.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.6)
    expect(rule).toMatch(/transparent\s*7\d%\)/)
    expect(archie).toContain('background: radial-gradient(circle, rgba(255, 226, 140, 0.85), rgba(255, 200, 80, 0.25) 45%, transparent 70%);')
    expect(archie).toContain('background: radial-gradient(circle, rgba(255, 226, 140, 0.8), rgba(255, 200, 80, 0.2) 45%, transparent 70%);')
  })

  // M3 / S3: the page background is the document's, so a size in % follows the page height and
  // the glow stretched down long pages. It is one viewport high, at the top, and does not repeat.
  it('the lantern glow is one viewport high, whatever the page height', () => {
    const rule = /:root\[data-theme='dusk'\] body \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/background-size:\s*100% 100vh;/)
    expect(rule).toMatch(/background-repeat:\s*no-repeat;/)
  })

  it('the lantern glow is drawn only in the evening', () => {
    const lines = css.split('\n').filter((l) => l.includes('radial-gradient'))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l.startsWith(":root[data-theme='dusk'] body")).toBe(true)
  })
})
