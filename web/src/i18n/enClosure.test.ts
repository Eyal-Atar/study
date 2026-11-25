// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en } from './en'
import { enClosure } from './enClosure'

// The texts of S45 (closing an exam and Moed B): the binding sentences of the plan, counts,
// user content and Archi's voice. S45b: the student never reads Moed, the word is retake.

const FSI = String.fromCodePoint(0x2068)
const PDI = String.fromCodePoint(0x2069)
const EXAM = 'הסתברות'
const NEXT = 'אלגוריתמים'
const iso = (name: string) => `${FSI}${name}${PDI}`
const { sheet, row, card, waiting, archived, moedB, list, exam, progress } = enClosure

describe('enClosure: the binding sentences of the plan', () => {
  it.each([
    ['sheet.title', sheet.title(EXAM), `You made it through ${iso(EXAM)}. What should I do with it now?`],
    ['sheet.stats', sheet.stats('21 hours', 86), 'You studied 21 hours and finished 86% of the plan.'],
    ['sheet.statsNoTime', sheet.statsNoTime(86), 'You finished 86% of the plan.'],
    ['sheet.nailed', sheet.nailed, 'Keep it as a memory'],
    ['sheet.keepOpen', sheet.keepOpen, 'Keep it open for a retake'],
    ['sheet.delete', sheet.delete, 'Delete it'],
    ['sheet.deleted', sheet.deleted(EXAM), `I’ve deleted ${iso(EXAM)}.`],
    ['sheet.bloomed', sheet.bloomed(EXAM), `${iso(EXAM)} is in full bloom. I’ve moved it to your archive.`],
    [
      'sheet.kept',
      sheet.kept(EXAM),
      `I’ll keep everything for ${iso(EXAM)} safe and quiet. When you know the retake date, tell me and I’ll plan a focused round.`,
    ],
    ['sheet.haveDate', sheet.haveDate, 'I have the date'],
    ['sheet.next', sheet.next(NEXT), `Tell me about ${iso(NEXT)}`],
    ['sheet.undone', sheet.undone(EXAM), `I put ${iso(EXAM)} back as it was.`],
    ['sheet.stale', sheet.stale, 'That exam changed in the meantime, so I looked again.'],
    ['row.say', row.say(EXAM), `You made it through ${iso(EXAM)}. What should I do with it now?`],
    ['row.sayMany', row.sayMany(2), 'You made it through 2 exams. What should I do with them now?'],
    ['row.sayMany', row.sayMany(1), 'You made it through 1 exam. What should I do with it now?'],
    ['row.open', row.open, 'Choose'],
    ['card.open', card.open, 'Choose'],
    ['waiting.say', waiting.say(EXAM), `${iso(EXAM)} is waiting for its retake.`],
    ['waiting.kept', waiting.kept(3, 17), 'I’m keeping its 3 files and 17 tasks for the retake.'],
    ['waiting.kept', waiting.kept(0, 17), 'I’m keeping its 17 tasks for the retake.'],
    ['waiting.kept', waiting.kept(3, 0), 'I’m keeping its 3 files for the retake.'],
    ['waiting.kept', waiting.kept(0, 0), 'I’ll keep this exam ready for the retake.'],
    ['waiting.plan', waiting.plan, 'Plan the retake'],
    ['waiting.done', waiting.done, 'Keep it as a memory'],
    ['waiting.delete', waiting.delete, 'Delete it'],
    ['archived.say', archived.say(EXAM), `${iso(EXAM)} is in full bloom.`],
    ['archived.closedOn', archived.closedOn('16 November 2026'), 'You closed it on 16 November 2026.'],
    ['moedB.title', moedB.title, 'When is the retake?'],
    ['moedB.date', moedB.date, 'Retake date'],
    ['moedB.grade', moedB.grade, 'How did the first sitting go? (optional)'],
    ['moedB.gradeHint', moedB.gradeHint, 'Your grade, from 0 to 100.'],
    ['moedB.gradeError', moedB.gradeError, 'Enter a whole number from 0 to 100.'],
    ['moedB.hard', moedB.hard, 'What felt hard?'],
    ['moedB.hardHint', moedB.hardHint, 'I’ll put these right after the practice exams.'],
    ['moedB.notes', moedB.notes, 'Anything else that felt hard? (optional)'],
    ['moedB.notesHint', moedB.notesHint, 'If you write a topic’s name as it appears above, I’ll put it right after the practice exams too.'],
    ['moedB.notesTooLong', moedB.notesTooLong, 'That’s a bit long. I can take up to 1,000 characters.'],
    ['moedB.submit', moedB.submit, 'Plan my retake'],
    ['moedB.submitting', moedB.submitting, 'Planning…'],
    ['moedB.short', moedB.short, 'Not everything fits before the retake. Your calendar shows what didn’t fit.'],
    ['moedB.undone', moedB.undone(EXAM), `I put ${iso(EXAM)} back to waiting for its retake.`],
    ['moedB.cantUndo', moedB.cantUndo, 'The retake is already under way, so I can’t undo this.'],
    ['list.pending', list.pending, 'What next?'],
    ['list.waiting', list.waiting, 'Waiting for a retake'],
    ['list.done', list.done, 'Done'],
    ['list.moedB', list.moedB('16 December 2026. 42% of the plan done'), 'Retake. 16 December 2026. 42% of the plan done'],
    ['list.closedOn', list.closedOn('16 Nov', '86% of the plan done'), 'Closed on 16 Nov. 86% of the plan done'],
    ['list.archive', list.archive, 'Archive'],
    ['list.noneComing', list.noneComing, 'No exams coming up. Add the next one when you know its date.'],
    ['exam.moedALine', exam.moedALine('16 November 2026', 55), 'You first sat it on 16 November 2026 and got 55.'],
    ['exam.moedALine', exam.moedALine('16 November 2026', null), 'You first sat it on 16 November 2026.'],
    ['exam.moedALine', exam.moedALine('16 November 2026', 0), 'You first sat it on 16 November 2026 and got 0.'],
    ['progress.title', progress.title, 'Archive'],
    ['progress.closedOn', progress.closedOn('16 November 2026'), 'Closed on 16 November 2026'],
    ['progress.summary', progress.summary('21 hours', 86), '21 hours studied, 86% of the plan'],
  ])('%s = "%s"', (_key, text, expected) => {
    expect(text).toBe(expected)
    expect(text).not.toMatch(/moed/i)
  })

  it('the row of one exam says what the sheet says', () => {
    expect(row.say(EXAM)).toBe(sheet.title(EXAM))
  })
})

describe('enClosure: counts', () => {
  it('the row counts the exams', () => {
    expect(row.sayMany(2)).toBe('You made it through 2 exams. What should I do with them now?')
    expect(row.sayMany(3)).toBe('You made it through 3 exams. What should I do with them now?')
    expect(row.sayMany(1)).toBe('You made it through 1 exam. What should I do with it now?')
  })

  it.each([
    [3, 17, 'I’m keeping its 3 files and 17 tasks for the retake.'],
    [0, 17, 'I’m keeping its 17 tasks for the retake.'],
    [3, 0, 'I’m keeping its 3 files for the retake.'],
    [0, 0, 'I’ll keep this exam ready for the retake.'],
    [1, 1, 'I’m keeping its 1 file and 1 task for the retake.'],
    [1, 0, 'I’m keeping its 1 file for the retake.'],
    [0, 1, 'I’m keeping its 1 task for the retake.'],
  ])('waiting.kept(%s, %s) = "%s"', (files, tasks, expected) => {
    expect(waiting.kept(files, tasks)).toBe(expected)
  })

  it.each([
    [2, [], 'I’ve put the practice exams first.'],
    [1, [], 'I’ve put the practice exam first.'],
    [2, ['גרפים'], `I’ve put the practice exams first, then ${iso('גרפים')}.`],
    [1, ['גרפים'], `I’ve put the practice exam first, then ${iso('גרפים')}.`],
    [2, ['גרפים', 'עצים'], `I’ve put the practice exams first, then ${iso('גרפים')} and ${iso('עצים')}.`],
    [2, ['גרפים', 'עצים', 'ערימות'], `I’ve put the practice exams first, then ${iso('גרפים')}, ${iso('עצים')} and ${iso('ערימות')}.`],
    [
      2,
      ['גרפים', 'עצים', 'ערימות', 'מיון'],
      `I’ve put the practice exams first, then ${iso('גרפים')}, ${iso('עצים')}, ${iso('ערימות')} and ${iso('מיון')}.`,
    ],
  ])('moedB.done(%s, %j)', (simulations, weak, expected) => {
    expect(moedB.done(simulations, weak)).toBe(expected)
  })

  it('moedB.done promises no general review: the answer cannot tell whether one is left', () => {
    expect(moedB.done(2, ['גרפים'])).not.toMatch(/general review/)
    expect(moedB.done(1, [])).not.toMatch(/general review/)
  })
})

const NAMED: [string, string][] = [
  ['sheet.title', sheet.title(EXAM)],
  ['sheet.bloomed', sheet.bloomed(EXAM)],
  ['sheet.kept', sheet.kept(EXAM)],
  ['sheet.deleted', sheet.deleted(EXAM)],
  ['sheet.next', sheet.next(EXAM)],
  ['sheet.undone', sheet.undone(EXAM)],
  ['row.say', row.say(EXAM)],
  ['waiting.say', waiting.say(EXAM)],
  ['archived.say', archived.say(EXAM)],
  ['moedB.undone', moedB.undone(EXAM)],
  ['moedB.done', moedB.done(2, [EXAM])],
]

describe('enClosure: user content', () => {
  it.each(NAMED)('%s isolates the name exactly once, without quotes', (_key, text) => {
    expect(text).toContain(iso(EXAM))
    expect(text.split(iso(EXAM)).join('')).not.toContain(EXAM)
    expect(text.split(FSI)).toHaveLength(2)
    expect(text.split(PDI)).toHaveLength(2)
    expect(text).not.toMatch(/["“”‘]/)
  })
})

// Every value of the file, with a sample input, for the voice checks.
const SENTENCES: [string, string][] = [
  ['sheet.title', sheet.title(EXAM)],
  ['sheet.stats', sheet.stats('21 hours', 86)],
  ['sheet.statsNoTime', sheet.statsNoTime(86)],
  ['sheet.bloomed', sheet.bloomed(EXAM)],
  ['sheet.kept', sheet.kept(EXAM)],
  ['sheet.deleted', sheet.deleted(EXAM)],
  ['sheet.undone', sheet.undone(EXAM)],
  ['sheet.stale', sheet.stale],
  ['row.say', row.say(EXAM)],
  ['row.sayMany', row.sayMany(2)],
  ['row.sayMany', row.sayMany(1)],
  ['waiting.say', waiting.say(EXAM)],
  ['waiting.kept', waiting.kept(3, 17)],
  ['waiting.kept', waiting.kept(0, 17)],
  ['waiting.kept', waiting.kept(3, 0)],
  ['waiting.kept', waiting.kept(0, 0)],
  ['archived.say', archived.say(EXAM)],
  ['archived.closedOn', archived.closedOn('16 November 2026')],
  ['moedB.gradeHint', moedB.gradeHint],
  ['moedB.gradeError', moedB.gradeError],
  ['moedB.hardHint', moedB.hardHint],
  ['moedB.notesTooLong', moedB.notesTooLong],
  ['moedB.done', moedB.done(2, ['a', 'b'])],
  ['moedB.notesHint', moedB.notesHint],
  ['moedB.short', moedB.short],
  ['moedB.undone', moedB.undone(EXAM)],
  ['moedB.cantUndo', moedB.cantUndo],
  ['list.noneComing', list.noneComing],
  ['exam.moedALine', exam.moedALine('16 November 2026', 55)],
  ['exam.moedALine', exam.moedALine('16 November 2026', null)],
]

const BUTTONS: [string, string][] = [
  ['sheet.nailed', sheet.nailed],
  ['sheet.keepOpen', sheet.keepOpen],
  ['sheet.delete', sheet.delete],
  ['sheet.haveDate', sheet.haveDate],
  ['sheet.next', sheet.next(EXAM)],
  ['row.open', row.open],
  ['card.open', card.open],
  ['waiting.plan', waiting.plan],
  ['waiting.done', waiting.done],
  ['waiting.delete', waiting.delete],
  ['moedB.submit', moedB.submit],
]

const OTHERS: [string, string][] = [
  ['moedB.title', moedB.title],
  ['moedB.date', moedB.date],
  ['moedB.grade', moedB.grade],
  ['moedB.hard', moedB.hard],
  ['moedB.notes', moedB.notes],
  ['moedB.submitting', moedB.submitting],
  ['list.pending', list.pending],
  ['list.waiting', list.waiting],
  ['list.done', list.done],
  ['list.moedB', list.moedB('16 Dec')],
  ['list.closedOn', list.closedOn('16 Nov', '86% of the plan done')],
  ['list.archive', list.archive],
  ['progress.title', progress.title],
  ['progress.closedOn', progress.closedOn('16 November 2026')],
  ['progress.summary', progress.summary('21 hours', 86)],
]

const EMOJI = /[\p{Extended_Pictographic}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}]|\u{FE0F}/u

describe('enClosure: Archi’s voice', () => {
  it.each(SENTENCES)('%s is a sentence of Archi and ends with a full stop', (_key, text) => {
    expect(text).toMatch(/[.?]$/)
  })

  it.each(BUTTONS)('%s is a button without a full stop', (_key, text) => {
    expect(text).not.toMatch(/[.!]$/)
  })

  it.each([...SENTENCES, ...BUTTONS, ...OTHERS])('%s has no "!", no middle dot, no emoji and no straight apostrophe', (_key, text) => {
    expect(text).not.toContain('!')
    expect(text).not.toContain('·')
    expect(text).not.toMatch(EMOJI)
    expect(text).not.toContain("'")
    expect(text).not.toMatch(/\bArchie?\b/)
  })

  it('no text of the file speaks of Archi in the third person, shouts or uses a middle dot', () => {
    const code = readFileSync(new URL('./enClosure.ts', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/\bArchie?\s+(will|would|can|could|is|was|has|had|does|did|may|might|should|must|shall|[a-z]+s)\b/)
    expect(code).not.toMatch(/\bArchie\b|\bthe (app|system) (will|has|can)\b/)
    const literals = code.match(/'[^'\n]*'|`[^`]*`/g) ?? []
    expect(literals.filter((text) => /!|·/.test(text) || EMOJI.test(text))).toEqual([])
  })

  it('every function of the file is probed, and every one that takes a name is in NAMED', () => {
    // A sample call for every function of enClosure, by its path. A new function fails the first
    // check until it is added here; one that takes a name fails the second until it is in NAMED.
    const PROBES: Record<string, unknown[]> = {
      'sheet.title': [EXAM],
      'sheet.stats': ['21 hours', 86],
      'sheet.statsNoTime': [86],
      'sheet.bloomed': [EXAM],
      'sheet.kept': [EXAM],
      'sheet.deleted': [EXAM],
      'sheet.next': [EXAM],
      'sheet.undone': [EXAM],
      'row.say': [EXAM],
      'row.sayMany': [2],
      'waiting.say': [EXAM],
      'waiting.kept': [3, 17],
      'archived.say': [EXAM],
      'archived.closedOn': ['16 November 2026'],
      'moedB.done': [2, [EXAM]],
      'moedB.undone': [EXAM],
      'list.moedB': ['16 Dec'],
      'list.closedOn': ['16 Nov', '86% of the plan done'],
      'exam.moedALine': ['16 November 2026', 55],
      'progress.closedOn': ['16 November 2026'],
      'progress.summary': ['21 hours', 86],
    }
    const functions = Object.entries(enClosure).flatMap(([group, values]) =>
      Object.entries(values as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'function')
        .map(([key, value]) => [`${group}.${key}`, value as (...args: unknown[]) => string] as const),
    )
    expect(functions.map(([path]) => path).sort()).toEqual(Object.keys(PROBES).sort())
    const takesName = functions
      .filter(([path]) => PROBES[path]?.some((arg) => arg === EXAM || (Array.isArray(arg) && arg.includes(EXAM))))
      .map(([path, fn]) => {
        expect(fn(...(PROBES[path] ?? []))).toContain(iso(EXAM))
        return path
      })
    expect(takesName.sort()).toEqual(NAMED.map(([path]) => path).sort())
  })
})

describe('enClosure: part of en', () => {
  it('is en.closure', () => {
    expect(en.closure).toBe(enClosure)
    expect(en.closure.sheet.nailed).toBe('Keep it as a memory')
  })
})

// A sample call for every function of en.closure, by its path, for the Moed scan below.
const CLOSURE_ARGS: Record<string, unknown[]> = {
  'sheet.title': ['X'],
  'sheet.stats': ['21 hours', 86],
  'sheet.statsNoTime': [86],
  'sheet.bloomed': ['X'],
  'sheet.kept': ['X'],
  'sheet.deleted': ['X'],
  'sheet.next': ['X'],
  'sheet.undone': ['X'],
  'row.say': ['X'],
  'row.sayMany': [2],
  'waiting.say': ['X'],
  'waiting.kept': [3, 17],
  'archived.say': ['X'],
  'archived.closedOn': ['16 November 2026'],
  'moedB.done': [2, ['A', 'B']],
  'moedB.undone': ['X'],
  'list.moedB': ['16 Dec'],
  'list.closedOn': ['16 Nov', '86% of the plan done'],
  'exam.moedALine': ['16 November 2026', 55],
  'progress.closedOn': ['16 November 2026'],
  'progress.summary': ['21 hours', 86],
}

describe('enClosure: the student never reads Moed (S45b)', () => {
  it('no string of en and no output of a function of en.closure says Moed', () => {
    const found: string[] = []
    const called: string[] = []
    const walk = (value: unknown, path: string) => {
      if (typeof value === 'string') {
        if (/moed/i.test(value)) found.push(`${path}: ${value}`)
      } else if (typeof value === 'function') {
        if (!path.startsWith('closure.')) return
        const key = path.slice('closure.'.length)
        const args = CLOSURE_ARGS[key]
        if (!args) {
          found.push(`${path}: no sample arguments`)
          return
        }
        called.push(key)
        const text = (value as (...a: unknown[]) => unknown)(...args)
        if (typeof text !== 'string' || /moed/i.test(text)) found.push(`${path}: ${String(text)}`)
      } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key)
      }
    }
    walk(en, '')
    expect(found).toEqual([])
    expect(called.sort()).toEqual(Object.keys(CLOSURE_ARGS).sort())
  })

  it('moedALine says the first sitting for every grade, 0 included', () => {
    for (const grade of [55, null, 0]) expect(exam.moedALine('16 November 2026', grade)).not.toMatch(/moed/i)
  })
})
