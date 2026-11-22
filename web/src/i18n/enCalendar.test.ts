// @vitest-environment node
/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isolate } from './bidi'
import { en } from './en'

// The text part files of the calendar: Archi's voice, the set of files, and no leftovers of the Hebrew era.

const I18N = __dirname
const SRC = join(__dirname, '..')

const files = readdirSync(I18N).filter((f) => /^enCalendar.*\.ts$/.test(f) && !/\.test\.ts$/.test(f))

describe('enCalendar part files', () => {
  it('are exactly the six', () => {
    expect([...files].sort()).toEqual([
      'enCalendarArchi.ts',
      'enCalendarCodes.ts',
      'enCalendarGrid.ts',
      'enCalendarPage.ts',
      'enCalendarSheets.ts',
      'enCalendarSide.ts',
    ])
  })

  it.each(files)('%s never speaks of Archi in the third person', (f) => {
    const code = readFileSync(join(I18N, f), 'utf8').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/\bArchie?\s+(will|would|can|could|is|was|has|had|does|did|may|might|should|must|shall|[a-z]+s)\b/)
    expect(code).not.toMatch(/\bArchie\b|\bthe (app|system) (will|has|can)\b/)
  })

  it('no file of the Hebrew era is left', () => {
    const names = (readdirSync(SRC, { recursive: true }) as string[]).map((p) => p.split('/').pop() ?? '')
    expect(names.filter((n) => n.startsWith('heCalendar'))).toEqual([])
    expect(existsSync(join(I18N, 'he.ts'))).toBe(false)
  })
})

const { grid, sheets, side, archi } = en.calendar
const split = side.banner.split

describe('enCalendar: counts', () => {
  it.each([
    ['sheets.freeTime.done', sheets.freeTime.done(1, '14:00–15:30'), 'I brought 1 block forward to 14:00–15:30.'],
    ['sheets.freeTime.done', sheets.freeTime.done(3, '14:00–17:00'), 'I brought 3 blocks forward to 14:00–17:00.'],
    ['sheets.busy.willMove', sheets.busy.willMove(1, 'Integrals'), `I’ll move 1 block to make room: ${isolate('Integrals')}.`],
    ['sheets.busy.willMove', sheets.busy.willMove(2, 'Integrals'), 'I’ll move 2 blocks to make room.'],
    ['sheets.busy.savedMoved', sheets.busy.savedMoved(1), 'I marked it as busy and moved 1 block.'],
    ['sheets.busy.savedMoved', sheets.busy.savedMoved(2), 'I marked it as busy and moved 2 blocks.'],
    ['sheets.busy.savedUnplaced', sheets.busy.savedUnplaced(1), 'I marked it as busy, but 1 task didn’t fit anywhere else.'],
    ['sheets.busy.savedUnplaced', sheets.busy.savedUnplaced(2), 'I marked it as busy, but 2 tasks didn’t fit anywhere else.'],
    ['side.peekLeft', side.peekLeft(0, ''), 'All done for today'],
    ['side.peekLeft', side.peekLeft(3, '2.5 hours'), '3 left, 2.5 hours'],
    ['side.stripDay', side.stripDay('Sunday', 22, 0), 'Sunday 22, no blocks'],
    ['side.stripDay', side.stripDay('Sunday', 22, 1), 'Sunday 22, 1 block'],
    ['side.stripDay', side.stripDay('Sunday', 22, 3), 'Sunday 22, 3 blocks'],
    ['side.banner.report', side.banner.report(1), 'One task didn’t fit before the exam.'],
    ['side.banner.report', side.banner.report(2), '2 tasks didn’t fit before their exams.'],
    ['side.banner.split.action', split.action(3, 30, true), 'Split into 3×30m'],
    ['side.banner.split.action', split.action(2, 30, true), 'Split into 2×30m'],
    ['side.banner.split.action', split.action(2, 30, false), 'Split into 30m bites'],
    ['side.banner.split.action', split.action(4, 25, false), 'Split into 25m bites'],
    ['side.banner.split.where', split.where(1), 'Here’s where the bite would go:'],
    ['side.banner.split.where', split.where(3), 'Here’s where the 3 bites would go:'],
    ['side.banner.split.part', split.part('Tue, 24 Nov', '18:00–18:30', '30 min'), 'Tue, 24 Nov, 18:00–18:30, 30 min'],
    ['side.banner.split.whole', split.whole('3 hours'), 'I’d split every block of this task that’s still ahead, 3 hours in all.'],
    ['side.banner.split.done', split.done(2, 'Tomorrow', '09:00'), 'I split it into 2 bites. The first is tomorrow at 09:00.'],
    ['side.banner.split.done', split.done(3, 'Sun, 22 Nov', '18:00'), 'I split it into 3 bites. The first is Sun, 22 Nov at 18:00.'],
    ['side.banner.split.done', split.done(1, 'Today', '21:00'), 'I split it into 1 bite. It’s today at 21:00.'],
    ['archi.summary', archi.summary(4, 1, '12:00'), 'I’ve set 4 blocks for today. 1 is done. The next starts at 12:00.'],
    ['archi.summary', archi.summary(4, 2, null), 'I’ve set 4 blocks for today. 2 are done.'],
    ['archi.summary', archi.summary(1, 0, null), 'I’ve set 1 block for today.'],
  ])('%s: %#', (_name, text, expected) => {
    expect(text).toBe(expected)
  })
})

describe('enCalendar: user content in a sentence', () => {
  const FSI = String.fromCodePoint(0x2068)
  const PDI = String.fromCodePoint(0x2069)
  // A Hebrew exam name with brackets and a digit: the case where bidi reordering bites.
  const NAME = 'חדו״א 1 (מועד ב׳)'
  const ISOLATED = `${FSI}${NAME}${PDI}`

  // Every function of the part files that receives user content, one row per isolate() call
  // (NAME where the user content goes). The count check below fails when a new call has no row.
  const NAMED: [string, string][] = [
    ['grid.blockLabel (the task)', grid.blockLabel(NAME, '09:00–10:30', 'Algebra', 'Practice', 'done', true)],
    ['grid.blockLabel (the exam)', grid.blockLabel('Integrals', '09:00–10:30', NAME, 'Practice', null, false)],
    ['grid.busyLabel', grid.busyLabel(NAME, '09:00–10:30')],
    ['sheets.defer.skipped', sheets.defer.skipped(NAME)],
    ['sheets.busy.willMove', sheets.busy.willMove(1, NAME)],
    ['side.examLabel', side.examLabel(NAME, 'Sun, 22 Nov')],
    ['side.banner.split.say', split.say(NAME, 90, 30)],
  ]

  it.each(NAMED)('%s isolates the name exactly once', (_path, text) => {
    expect(text).toContain(ISOLATED)
    // Nothing of the name outside the isolate.
    expect(text.split(ISOLATED).join('')).not.toContain(NAME)
    expect(text.split(ISOLATED)).toHaveLength(2)
  })

  it('the table above covers every isolate() call of the part files', () => {
    const calls = files
      .map((f) => readFileSync(join(I18N, f), 'utf8').split('${isolate(').length - 1)
      .reduce((sum, n) => sum + n, 0)
    expect(calls).toBe(NAMED.length)
  })

  it('the split offer names the task, the length of the block and the length of a bite', () => {
    const title = 'תרגול: malloc ו-free'
    const text = split.say(title, 90, 30)
    expect(text).toBe(
      `I noticed we keep pushing ${isolate(title)} back. Want me to split this 90-minute block into 30-minute bites instead?`,
    )
    expect(text).toContain(`${FSI}${title}${PDI}`)
    expect(split.say(title, 120, 45)).toContain('this 120-minute block into 45-minute bites')
  })

  it('the label of a block reads in order, with and without a state and a lock', () => {
    expect(grid.blockLabel('Integrals', '09:00–10:30', 'Algebra', 'Practice', 'done', true)).toBe(
      `${isolate('Integrals')}, 09:00–10:30, ${isolate('Algebra')}, Practice, done, locked`,
    )
    expect(grid.blockLabel('Integrals', '09:00–10:30', 'Algebra', 'Practice', null, false)).toBe(
      `${isolate('Integrals')}, 09:00–10:30, ${isolate('Algebra')}, Practice`,
    )
  })
})

describe('enCalendar: the fixed moments of Archi', () => {
  it.each(['review', 'report', 'restDay', 'openDay', 'dayDone', 'deepWork'] as const)('%s has three different lines', (moment) => {
    const lines: readonly string[] = archi[moment]
    expect(lines).toHaveLength(3)
    expect(new Set(lines).size).toBe(3)
    for (const line of lines) {
      expect(line.endsWith('.')).toBe(true)
      expect(line).not.toContain('!')
    }
  })
})

describe('enCalendar: the split offer of the banner', () => {
  it('the buttons are short and have no full stop', () => {
    expect(split.show).toBe('Show me')
    expect(split.notNow).toBe('Not now')
    for (const label of [split.show, split.notNow, split.action(3, 30, true), split.action(3, 30, false)]) {
      expect(label).not.toMatch(/[.!]$/)
    }
  })

  it('every sentence of Archi is in the first person, ends with a full stop and never shouts', () => {
    const lines = [split.done(3, 'Tomorrow', '09:00'), split.done(1, 'Tomorrow', '09:00'), split.undone, split.dismissed, split.stale, split.whole('3 hours')]
    for (const line of lines) {
      expect(line.endsWith('.')).toBe(true)
      expect(line).not.toContain('!')
      expect(line).not.toMatch(/Archi/)
    }
    for (const line of [split.undone, split.dismissed, split.stale, split.whole('3 hours')]) expect(line).toMatch(/\bI\b|\bI’ll\b/)
  })

  it('no text of the offer holds a number of its own: every digit comes from the offer', () => {
    const fixed = [split.show, split.notNow, split.undone, split.dismissed, split.stale, split.where(1)]
    for (const text of fixed) expect(text).not.toMatch(/\d/)
    expect(split.action(7, 11, true).match(/\d+/g)).toEqual(['7', '11'])
    expect(split.action(7, 11, false).match(/\d+/g)).toEqual(['11'])
    expect(split.where(7).match(/\d+/g)).toEqual(['7'])
    expect(split.say('x', 77, 11).match(/\d+/g)).toEqual(['77', '11'])
    expect(split.done(7, 'Tomorrow', 'T').match(/\d+/g)).toEqual(['7'])
  })
})
