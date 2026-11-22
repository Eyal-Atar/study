// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { enOnboardingFlow } from './enOnboardingFlow'

// The texts of the onboarding conversation that hold user content. As in en.test.ts: every
// function that receives an exam name wraps it in an isolate, and the count check fails when a
// new isolate() call appears in the file without a row here.

const FSI = String.fromCodePoint(0x2068)
const PDI = String.fromCodePoint(0x2069)
const NAME = 'חדו״א 1 (מועד ב׳)'
const ISOLATED = `${FSI}${NAME}${PDI}`

const t = enOnboardingFlow.feasibility

describe('enOnboardingFlow: the recap of the exams', () => {
  it('counts the exams, in the singular and the plural, and leaves the names raw for RecapLine', () => {
    expect(enOnboardingFlow.examsRecap(['a', 'b', 'c']).label).toBe('3 exams:')
    expect(enOnboardingFlow.examsRecap(['a']).label).toBe('1 exam:')
    expect(enOnboardingFlow.examsRecap([NAME, 'b']).value).toBe(`${NAME}, b`)
    // RecapLine isolates the value itself (<UserText truncate>), so the sentence must not.
    expect(enOnboardingFlow.examsRecap([NAME]).value).not.toContain(FSI)
  })
})

describe('enOnboardingFlow: the live feasibility sentences', () => {
  const NAMED: [string, string][] = [
    ['feasibility.roomy', t.roomy(88 * 60, NAME)],
    ['feasibility.tight', t.tight(6 * 60, NAME)],
    ['feasibility.none', t.none(NAME)],
    // The same check holds for a busy time's title.
    ['fixedHours.remove', enOnboardingFlow.fixedHours.remove(NAME, 'Sun, 14:00–17:00')],
  ]

  it.each(NAMED)('%s isolates the exam name exactly once', (_path, text) => {
    expect(text).toContain(ISOLATED)
    expect(text.split(ISOLATED).join('')).not.toContain(NAME)
    expect(text.split(FSI)).toHaveLength(2)
  })

  it('the table above covers every isolate() call of enOnboardingFlow.ts', () => {
    const source = readFileSync(new URL('./enOnboardingFlow.ts', import.meta.url), 'utf8')
    const calls = source.split('\n').filter((line) => line.includes('${isolate(')).length
    expect(calls).toBe(NAMED.length)
  })

  it('hours are whole and always "about", in the singular and the plural', () => {
    expect(t.roomy(88 * 60, NAME)).toContain('about 88 study hours')
    expect(t.roomy(88 * 60 + 29, NAME)).toContain('about 88 study hours')
    expect(t.roomy(88 * 60 + 30, NAME)).toContain('about 89 study hours')
    expect(t.roomy(60, NAME)).toContain('about 1 study hour ')
    expect(t.tight(60, NAME)).toContain('about 1 study hour ')
    expect(t.tight(6 * 60, NAME)).toContain('about 6 study hours for each exam')
  })

  it('under half an hour is never "about 0 study hours"', () => {
    expect(t.tight(20, NAME)).toContain('less than 1 study hour ')
    expect(t.tight(20, NAME)).not.toContain('about')
  })

  it('roomy: the hours are yours, and the room is how it looks, not a promise', () => {
    expect(t.roomy(88 * 60, NAME)).toBe(
      `That gives you about 88 study hours before ${ISOLATED}. It looks like room for a steady pace.`,
    )
  })

  // The minutes are for each exam among those up to the named one, itself included: "before" alone
  // would read as the exams that come before it.
  it('tight: the hours are for each exam up to and including the named one', () => {
    expect(t.tight(6 * 60, NAME)).toBe(
      `That gives you about 6 study hours for each exam up to and including ${ISOLATED}. It’s tight. If you can, one more hour a day could give you more room.`,
    )
    expect(t.tight(60, NAME)).toContain(`about 1 study hour for each exam up to and including ${ISOLATED}.`)
    expect(t.tight(20, NAME)).toContain(`less than 1 study hour for each exam up to and including ${ISOLATED}.`)
  })

  it('none: names what you can change, without an order and without an alarm', () => {
    expect(t.none(NAME)).toBe(
      `I can’t find any study time before ${ISOLATED} yet. You can change its date, your study hours or your rest days before an exam.`,
    )
  })

  const EVERY: string[] = [
    t.roomy(88 * 60, NAME),
    t.roomy(60, NAME),
    t.tight(6 * 60, NAME),
    t.tight(60, NAME),
    t.tight(20, NAME),
    t.none(NAME),
  ]

  it('speaks calmly: no exclamation mark, and a full stop at the end', () => {
    for (const text of EVERY) {
      expect(text).not.toContain('!')
      expect(text.endsWith('.')).toBe(true)
    }
  })

  it('the study hours are the student’s: "you", never a shared "we"', () => {
    for (const text of EVERY) expect(text).not.toMatch(/\b(we|us|our|ours|ourselves)\b/i)
  })

  it('an estimate, never a promise that the plan fits', () => {
    for (const text of EVERY) expect(text).not.toMatch(/\b(will|plenty|enough|definitely|guarantee\w*)\b|’ll\b/i)
  })

  it('every number comes with "about" or "less than"', () => {
    for (const text of EVERY) {
      for (const match of text.matchAll(/\d+ study hours?/g)) {
        const lead = text.slice(0, match.index)
        expect(lead.endsWith('about ') || lead.endsWith('less than ')).toBe(true)
      }
    }
  })
})
