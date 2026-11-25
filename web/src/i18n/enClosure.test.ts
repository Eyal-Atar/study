// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en } from './en'
import { enClosure } from './enClosure'

// The texts of S45 (closing an exam and Moed B): the binding sentences of the plan, counts,
// user content and Archi's voice.

const FSI = String.fromCodePoint(0x2068)
const PDI = String.fromCodePoint(0x2069)
const EXAM = 'הסתברות'
const NEXT = 'אלגוריתמים'
const iso = (name: string) => `${FSI}${name}${PDI}`
const { sheet, row, card, waiting, archived, moedB, list, exam, progress } = enClosure

describe('enClosure: the binding sentences of the plan', () => {
  it.each([
    ['sheet.title', sheet.title(EXAM), `You made it through ${iso(EXAM)}. How did it feel?`],
    ['sheet.stats', sheet.stats('21 hours', 86), 'You studied 21 hours and finished 86% of the plan.'],
    ['sheet.statsNoTime', sheet.statsNoTime(86), 'You finished 86% of the plan.'],
    ['sheet.nailed', sheet.nailed, 'Nailed it'],
    ['sheet.keepOpen', sheet.keepOpen, 'Keep open for Moed B'],
    ['sheet.bloomed', sheet.bloomed(EXAM), `${iso(EXAM)} is in full bloom. I’ve moved it to your archive.`],
    [
      'sheet.kept',
      sheet.kept(EXAM),
      `I’ll keep everything for ${iso(EXAM)} safe and quiet. When the Moed B date is out, tell me and I’ll plan a focused round.`,
    ],
    ['sheet.haveDate', sheet.haveDate, 'I have the date'],
    ['sheet.next', sheet.next(NEXT), `Tell me about ${iso(NEXT)}`],
    ['sheet.undone', sheet.undone(EXAM), `I put ${iso(EXAM)} back as it was.`],
    ['sheet.stale', sheet.stale, 'That exam changed in the meantime, so I looked again.'],
    ['row.say', row.say(EXAM), `You made it through ${iso(EXAM)}. How did it feel?`],
    ['row.sayMany', row.sayMany(2), 'You made it through 2 exams. How did they feel?'],
    ['row.open', row.open, 'Tell me'],
    ['card.open', card.open, 'Tell me'],
    ['waiting.say', waiting.say(EXAM), `${iso(EXAM)} is waiting for Moed B.`],
    ['waiting.plan', waiting.plan, 'Plan Moed B'],
    ['waiting.done', waiting.done, 'I’m done with it'],
    ['archived.say', archived.say(EXAM), `${iso(EXAM)} is in full bloom.`],
    ['archived.closedOn', archived.closedOn('16 November 2026'), 'You closed it on 16 November 2026.'],
    ['moedB.title', moedB.title, 'When is Moed B?'],
    ['moedB.date', moedB.date, 'Moed B date'],
    ['moedB.grade', moedB.grade, 'How did Moed A go? (optional)'],
    ['moedB.gradeHint', moedB.gradeHint, 'Your grade, from 0 to 100.'],
    ['moedB.gradeError', moedB.gradeError, 'Enter a whole number from 0 to 100.'],
    ['moedB.hard', moedB.hard, 'What felt hard?'],
    ['moedB.hardHint', moedB.hardHint, 'I’ll put these right after the practice exams.'],
    ['moedB.notes', moedB.notes, 'Anything else that felt hard? (optional)'],
    ['moedB.notesHint', moedB.notesHint, 'If you write a topic’s name as it appears above, I’ll put it right after the practice exams too.'],
    ['moedB.notesTooLong', moedB.notesTooLong, 'That’s a bit long. I can take up to 1,000 characters.'],
    ['moedB.submit', moedB.submit, 'Plan my Moed B'],
    ['moedB.submitting', moedB.submitting, 'Planning…'],
    ['moedB.short', moedB.short, 'Not everything fits before Moed B. Your calendar shows what didn’t fit.'],
    ['moedB.undone', moedB.undone(EXAM), `I put ${iso(EXAM)} back to waiting for Moed B.`],
    ['moedB.cantUndo', moedB.cantUndo, 'Moed B is already under way, so I can’t undo this.'],
    ['list.pending', list.pending, 'How did it go?'],
    ['list.waiting', list.waiting, 'Waiting for Moed B'],
    ['list.done', list.done, 'Done'],
    ['list.moedB', list.moedB('16 December 2026. 42% of the plan done'), 'Moed B. 16 December 2026. 42% of the plan done'],
    ['list.closedOn', list.closedOn('16 Nov', '86% of the plan done'), 'Closed on 16 Nov. 86% of the plan done'],
    ['list.archive', list.archive, 'Archive'],
    ['list.noneComing', list.noneComing, 'No exams coming up. Add the next one when you know its date.'],
    ['exam.moedALine', exam.moedALine('16 November 2026', 55), 'Moed A was on 16 November 2026, grade 55.'],
    ['exam.moedALine', exam.moedALine('16 November 2026', null), 'Moed A was on 16 November 2026.'],
    ['exam.moedALine', exam.moedALine('16 November 2026', 0), 'Moed A was on 16 November 2026, grade 0.'],
    ['progress.title', progress.title, 'Archive'],
    ['progress.closedOn', progress.closedOn('16 November 2026'), 'Closed on 16 November 2026'],
    ['progress.summary', progress.summary('21 hours', 86), '21 hours studied, 86% of the plan'],
  ])('%s = "%s"', (_key, text, expected) => {
    expect(text).toBe(expected)
  })

  it('the row of one exam says what the sheet says', () => {
    expect(row.say(EXAM)).toBe(sheet.title(EXAM))
  })
})

describe('enClosure: counts', () => {
  it('the row counts the exams', () => {
    expect(row.sayMany(2)).toBe('You made it through 2 exams. How did they feel?')
    expect(row.sayMany(3)).toBe('You made it through 3 exams. How did they feel?')
    expect(row.sayMany(1)).toBe('You made it through 1 exam. How did it feel?')
  })

  it.each([
    [3, 17, 'I’m keeping its 3 files and 17 tasks for Moed B.'],
    [0, 17, 'I’m keeping its 17 tasks for Moed B.'],
    [3, 0, 'I’m keeping its 3 files for Moed B.'],
    [0, 0, 'I’ll keep this exam ready for Moed B.'],
    [1, 1, 'I’m keeping its 1 file and 1 task for Moed B.'],
    [1, 0, 'I’m keeping its 1 file for Moed B.'],
    [0, 1, 'I’m keeping its 1 task for Moed B.'],
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
  ['sheet.undone', sheet.undone(EXAM)],
  ['sheet.stale', sheet.stale],
  ['row.say', row.say(EXAM)],
  ['row.sayMany', row.sayMany(2)],
  ['waiting.say', waiting.say(EXAM)],
  ['waiting.kept', waiting.kept(3, 17)],
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
]

const BUTTONS: [string, string][] = [
  ['sheet.nailed', sheet.nailed],
  ['sheet.keepOpen', sheet.keepOpen],
  ['sheet.haveDate', sheet.haveDate],
  ['sheet.next', sheet.next(EXAM)],
  ['row.open', row.open],
  ['card.open', card.open],
  ['waiting.plan', waiting.plan],
  ['waiting.done', waiting.done],
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
    expect(en.closure.sheet.nailed).toBe('Nailed it')
  })
})
