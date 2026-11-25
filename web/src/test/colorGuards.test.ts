import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// S43 (Dusk mode): a theme switch works only if no screen paints a colour outside the tokens of
// web/src/index.css. This guard fails on a hard-coded colour in product code, so a later scope
// cannot bring one back. Product code means .ts, .tsx and .css under src, without tests.

const SRC = join(process.cwd(), 'src')

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : []
  })
}

const name = (path: string) => relative(SRC, path).split(sep).join('/')

const isProductCode = (file: string) =>
  !/\.test\.tsx?$/.test(file) && !file.startsWith('test/')

// Files that may hold a colour literal, each with its reason. A directory entry ends in '/'.
const ALLOW: { path: string; reason: string }[] = [
  { path: 'index.css', reason: 'the source of the colour tokens themselves' },
  { path: 'archie/', reason: 'the paper colours of the Archi illustration, drawn as art' },
  { path: 'pwa/manifest.ts', reason: 'the web app manifest is not CSS and needs literal colours' },
  { path: 'theme/', reason: 'the browser theme-color meta, set per theme (Task 3); a missing folder allows nothing' },
  { path: 'commitments/downscale.ts', reason: 'a white background painted under an image before upload' },
]

const isAllowed = (file: string) =>
  ALLOW.some(({ path }) => (path.endsWith('/') ? file.startsWith(path) : file === path))

const FILES = filesUnder(SRC)
  .map((path) => ({ name: name(path), text: readFileSync(path, 'utf8') }))
  .filter((file) => isProductCode(file.name))

const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/
const COLOR_FUNCTION = /\b(?:rgba?|hsla?)\(/
const TAILWIND_BASE = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|decoration|placeholder|caret|accent|shadow)-/
const TAILWIND_WHITE_BLACK = new RegExp(`${TAILWIND_BASE.source}(?:white|black)\\b`)
const TAILWIND_PALETTE =
  new RegExp(`${TAILWIND_BASE.source}(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b`)
const TEXT_OPACITY = /\btext-[a-z-]+\/\d/

const PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'hex colour', pattern: HEX },
  { label: 'rgb/hsl function', pattern: COLOR_FUNCTION },
  { label: 'Tailwind white or black', pattern: TAILWIND_WHITE_BLACK },
  { label: 'Tailwind palette colour', pattern: TAILWIND_PALETTE },
  { label: 'text opacity', pattern: TEXT_OPACITY },
]

function linesWith(text: string, pattern: RegExp): string[] {
  return text
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => pattern.test(line))
    .map(({ line, number }) => `${String(number)}: ${line.trim().slice(0, 80)}`)
}

describe('the colour rules of the source', () => {
  it('has no hard-coded colour outside the allow list', () => {
    const hits = FILES.filter((file) => !isAllowed(file.name)).flatMap((file) =>
      PATTERNS.flatMap(({ label, pattern }) =>
        linesWith(file.text, pattern).map((line) => `${file.name}:${line} (${label})`),
      ),
    )
    expect(hits).toEqual([])
  })

  it('the patterns catch what they are for', () => {
    expect(HEX.test('color: #4f7a3a')).toBe(true)
    expect(COLOR_FUNCTION.test("background: 'rgb(0 0 0)'")).toBe(true)
    expect(TAILWIND_WHITE_BLACK.test('className="bg-white"')).toBe(true)
    expect(TAILWIND_PALETTE.test('className="text-slate-600"')).toBe(true)
    expect(TEXT_OPACITY.test('className="text-ink/70"')).toBe(true)
    expect(HEX.test('href="#main"')).toBe(false)
    expect(HEX.test('href="#report"')).toBe(false)
    expect(HEX.test('&#123;')).toBe(false)
    expect(TAILWIND_PALETTE.test('bg-sky-from')).toBe(false)
    expect(TAILWIND_BASE.test('bg-sky-from')).toBe(true)
    expect(TEXT_OPACITY.test('bg-surface/97')).toBe(false)
    expect(TAILWIND_WHITE_BLACK.test('bg-whiteboard')).toBe(false)
  })
})
