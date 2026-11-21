// @vitest-environment node
/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

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
