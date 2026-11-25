// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { TaskKind } from '../board/types'
import { en } from './en'
import { enFocus } from './enFocus'

// The texts of the focus screen (S42): counts, user content, Archi's sentences and the buttons.

const FSI = String.fromCodePoint(0x2068)
const PDI = String.fromCodePoint(0x2069)
const TITLE = 'פרק 3: גרפים'
const EXAM = 'אלגוריתמים'

const KINDS: TaskKind[] = ['learn', 'practice', 'review', 'simulation', 'simulation_review', 'custom']

// Everything Archi says on the screen: a sentence, so it ends with a full stop.
const SENTENCES: [string, string][] = [
  ...enFocus.running.map((text, i): [string, string] => [`running[${String(i)}]`, text]),
  ...KINDS.map((kind): [string, string] => [`fiveTask.${kind}`, enFocus.fiveTask[kind]]),
  ['fiveDone', enFocus.fiveDone('15:00')],
  ['over', enFocus.over],
  ['ended', enFocus.ended],
  ['alreadyDone', enFocus.alreadyDone],
  ['gone', enFocus.gone],
  ['notToday', enFocus.notToday],
  ['stopped', enFocus.stopped],
]

// Buttons: short verbs, no full stop.
const BUTTONS: [string, string][] = [
  ['start', enFocus.start],
  ['five', enFocus.five],
  ['resume', enFocus.resume],
  ['back', enFocus.back],
  ['stop', enFocus.stop],
]

const OTHERS: [string, string][] = [
  ['title', enFocus.title],
  ['startLabel', enFocus.startLabel(TITLE)],
  ['fiveLabel', enFocus.fiveLabel(TITLE)],
  ['timerLabel', enFocus.timerLabel],
  ['minutesLeft', enFocus.minutesLeft(24)],
  ['unit', enFocus.unit(24)],
  ['ofFive', enFocus.ofFive],
  ['until', enFocus.until('15:00')],
  ['valueText', enFocus.valueText(24, '15:00')],
  ['meta', enFocus.meta(EXAM, 'Learning')],
]

describe('enFocus: the timer', () => {
  it('says the minutes left in words, singular and plural', () => {
    expect(enFocus.valueText(1, '15:00')).toBe('1 minute left, until 15:00')
    expect(enFocus.valueText(24, '15:00')).toBe('24 minutes left, until 15:00')
  })

  it('the big number is only the digits, and the unit under it has no plural', () => {
    expect(enFocus.minutesLeft(24)).toBe('24')
    expect(enFocus.minutesLeft(1)).toBe('1')
    expect(enFocus.unit(24)).toBe('min left')
    expect(enFocus.unit(1)).toBe('min left')
    expect(enFocus.ofFive).toBe('of your 5 minutes')
    expect(enFocus.until('15:00')).toBe('Until 15:00')
    expect(enFocus.timerLabel).toBe('Time left')
  })
})

describe('enFocus: user content', () => {
  const NAMED: [string, string, string, string][] = [
    ['startLabel', enFocus.startLabel(TITLE), TITLE, `Start now: ${FSI}${TITLE}${PDI}`],
    ['fiveLabel', enFocus.fiveLabel(TITLE), TITLE, `Just 5 minutes: ${FSI}${TITLE}${PDI}`],
    ['meta', enFocus.meta(EXAM, 'Learning'), EXAM, `${FSI}${EXAM}${PDI}, Learning`],
  ]

  it.each(NAMED)('%s isolates the name exactly once', (_key, text, name, expected) => {
    expect(text).toBe(expected)
    expect(text.split(`${FSI}${name}${PDI}`).join('')).not.toContain(name)
    expect(text.split(FSI)).toHaveLength(2)
  })

  it('the table above covers every isolate() call of enFocus.ts', () => {
    const source = readFileSync(new URL('./enFocus.ts', import.meta.url), 'utf8')
    const calls = source.split('\n').filter((line) => line.includes('${isolate(')).length
    expect(calls).toBe(NAMED.length)
  })
})

describe('enFocus: Archi’s voice', () => {
  it('has a tiny first step for each of the six kinds of task', () => {
    expect(Object.keys(enFocus.fiveTask).sort()).toEqual([...KINDS].sort())
    expect(enFocus.fiveTask.learn).toBe('Just open the file and read page 1 with me.')
    expect(enFocus.fiveTask.review).toBe(enFocus.fiveTask.learn)
  })

  it('has three quiet sentences while the timer runs', () => {
    expect(enFocus.running).toHaveLength(3)
    expect(new Set(enFocus.running).size).toBe(3)
  })

  it('the end of the five minutes is not a question', () => {
    expect(enFocus.fiveDone('15:00')).toBe('That’s five minutes. I’ll keep going with you until 15:00.')
    expect(enFocus.fiveDone('15:00')).not.toContain('?')
  })

  it.each(SENTENCES)('%s is a sentence that ends with a full stop', (_key, text) => {
    expect(text).toMatch(/\.$/)
  })

  it.each(BUTTONS)('%s is a button without a full stop', (_key, text) => {
    expect(text).not.toMatch(/\.$/)
  })

  it('names the buttons as the brief says', () => {
    expect(BUTTONS).toEqual([
      ['start', 'Start now'],
      ['five', 'Just 5 minutes'],
      ['resume', 'Back to focus'],
      ['back', 'Back to my calendar'],
      ['stop', 'Stop for now'],
    ])
  })

  it.each([...SENTENCES, ...BUTTONS, ...OTHERS])('%s has no "!", no "session" and no middle dot', (_key, text) => {
    expect(text).not.toContain('!')
    expect(text).not.toMatch(/session/i)
    expect(text).not.toContain('·')
  })

  it('no text literal of the file says "session"', () => {
    const source = readFileSync(new URL('./enFocus.ts', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')
    const literals = source.match(/'[^'\n]*'|`[^`]*`/g) ?? []
    expect(literals.filter((text) => /session|!|·/i.test(text))).toEqual([])
  })
})

describe('enFocus: part of en', () => {
  it('is en.focus', () => {
    expect(en.focus.start).toBe('Start now')
    expect(en.focus).toBe(enFocus)
  })
})
