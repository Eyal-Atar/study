// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { enCommitments } from './enCommitments'

// The texts of busy times that hold user content. As in en.test.ts: every function that receives
// a commitment title wraps it in an isolate, and the count check fails when a new isolate() call
// appears in the file without a row here.

const FSI = String.fromCodePoint(0x2068)
const PDI = String.fromCodePoint(0x2069)
const TITLE = 'הרצאה: אלגוריתמים (קבוצה 2)'
const ISOLATED = `${FSI}${TITLE}${PDI}`
const WHEN = 'Wed, 10:00–12:00'

const t = enCommitments.timetable

describe('enCommitments: the names that carry a commitment title', () => {
  const NAMED: [string, string][] = [
    ['timetable.approve', t.approve(TITLE, WHEN)],
    ['timetable.edit', t.edit(TITLE, WHEN)],
  ]

  it.each(NAMED)('%s isolates the title exactly once, and keeps the hours outside it', (_path, text) => {
    expect(text).toContain(ISOLATED)
    expect(text.split(ISOLATED).join('')).not.toContain(TITLE)
    expect(text.split(FSI)).toHaveLength(2)
    expect(text.endsWith(`, ${WHEN}`)).toBe(true)
  })

  it('the table above covers every isolate() call of enCommitments.ts', () => {
    const source = readFileSync(new URL('./enCommitments.ts', import.meta.url), 'utf8')
    const calls = source.split('\n').filter((line) => line.includes('${isolate(')).length
    expect(calls).toBe(NAMED.length)
  })
})

describe('enCommitments: the photo of the timetable', () => {
  it('asks about what it found, in the singular and the plural', () => {
    expect(t.found(3)).toBe('I found 3 busy times in your photo. Should I add them?')
    expect(t.found(1)).toBe('I found 1 busy time in your photo. Should I add it?')
  })

  it('names the daily limit of photos, and when it starts again', () => {
    expect(t.quota(5, '00:00')).toBe('I can read 5 timetable photos a day, and you’ve reached that. You can try again after 00:00.')
    expect(t.quota(1, null)).toBe('I can read 1 timetable photo a day, and you’ve reached that. You can try again tomorrow.')
    expect(t.quota(null, null)).toBe('You’ve reached today’s limit for timetable photos. You can try again tomorrow.')
  })

  it('speaks calmly: no exclamation mark anywhere', () => {
    const texts = [
      ...Object.values(t as Record<string, unknown>).filter((v): v is string => typeof v === 'string'),
      t.found(2),
      t.quota(5, '00:00'),
    ]
    for (const text of texts) expect(text).not.toContain('!')
  })
})
