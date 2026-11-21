import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// The three language rules of S39 (docs/design/2026-11-21-archi-ux-audit.md, sections 1, 2 and 6),
// checked on the source itself, so a later scope cannot bring back what S39 removed:
// 1. the product speaks English: no Hebrew letter outside tests and sample user content;
// 2. no emoji anywhere: an icon is a component of ui/icons;
// 3. Archi speaks in the first person: en.ts never says "Archi will", "Archi is", "Archi builds".

const SRC = join(process.cwd(), 'src')
const PROTOTYPE = join(process.cwd(), '..', 'docs', 'design', 'prototype', 'all-screens.html')

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : []
  })
}

const name = (path: string) => relative(SRC, path).split(sep).join('/')
const FILES = filesUnder(SRC).map((path) => ({ name: name(path), text: readFileSync(path, 'utf8') }))

// Where Hebrew may appear: user content is in the user's language, so the tests and the sample
// data that stand for it keep theirs. Product text never does.
const SAMPLE_USER_CONTENT = new Set(['dev/sampleContent.ts'])
const mayHoldHebrew = (file: string) =>
  /\.test\.tsx?$/.test(file) || file.startsWith('test/') || SAMPLE_USER_CONTENT.has(file)

const HEBREW = /[֐-׿יִ-ﭏ]/
// Every pictograph, the dingbats (the check mark and the cross among them), the miscellaneous
// symbols, and the selector that turns a plain character into an emoji.
const EMOJI = /[\p{Extended_Pictographic}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}\u{FE0F}]/u
// "Archi" as the subject of a finite verb. A description of a picture ("Archi watering a pot")
// and an introduction ("I'm Archi") are not.
const THIRD_PERSON =
  /\bArchie?\s+(will|would|can|could|is|was|has|had|does|did|may|might|should|must|shall|[a-z]+s)\b/

function linesWith(text: string, pattern: RegExp): string[] {
  return text
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => pattern.test(line))
    .map(({ line, number }) => `${String(number)}: ${line.trim().slice(0, 80)}`)
}

function offenders(pattern: RegExp, skip: (file: string) => boolean = () => false): string[] {
  return FILES.filter((file) => !skip(file.name)).flatMap((file) =>
    linesWith(file.text, pattern).map((line) => `${file.name}:${line}`),
  )
}

describe('the language rules of the source', () => {
  it('has no Hebrew letter outside tests and sample user content', () => {
    expect(offenders(HEBREW, mayHoldHebrew)).toEqual([])
  })

  it('has no emoji, in code, text, comments or tests', () => {
    // This file names the ranges as escapes, never as characters.
    expect(offenders(EMOJI)).toEqual([])
  })

  it('has no emoji in the binding prototype', () => {
    expect(linesWith(readFileSync(PROTOTYPE, 'utf8'), EMOJI)).toEqual([])
  })

  it('en.ts speaks in the first person: Archi is never the subject of a verb', () => {
    const texts = FILES.filter((file) => /^i18n\/en(Crash|Pwa)?\.ts$/.test(file.name))
    expect(texts.map((file) => file.name).sort()).toEqual(['i18n/en.ts', 'i18n/enCrash.ts', 'i18n/enPwa.ts'])
    for (const file of texts) {
      expect(linesWith(file.text, THIRD_PERSON)).toEqual([])
      // The name is Archi: not the old spelling, and not "the app" or "the system" speaking.
      expect(linesWith(file.text.replace(/\/\/.*$/gm, ''), /\bArchie\b|\bthe (app|system) (will|is|has)\b/)).toEqual([])
    }
  })

  it('the patterns catch what they are for', () => {
    expect(THIRD_PERSON.test('Archi will build your plan')).toBe(true)
    expect(THIRD_PERSON.test('Archi builds your path')).toBe(true)
    expect(THIRD_PERSON.test("Hi, I'm Archi. What exams are we preparing for?")).toBe(false)
    expect(THIRD_PERSON.test('Archi watering a pot')).toBe(false)
    expect(EMOJI.test(String.fromCodePoint(0x1f33f))).toBe(true)
    expect(EMOJI.test(String.fromCodePoint(0x2713))).toBe(true)
    expect(EMOJI.test(String.fromCodePoint(0x2b50))).toBe(true)
    expect(EMOJI.test('09:00–10:30, 1.5 hours…')).toBe(false)
    expect(HEBREW.test(String.fromCodePoint(0x5d0))).toBe(true)
  })
})
