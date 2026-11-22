import { describe, expect, it } from 'vitest'
import { instantOf } from './busyTime'

describe('instantOf', () => {
  it('converts a wall clock in the zone', () => {
    expect(instantOf('2026-11-16', '10:00', 'Asia/Jerusalem')).toBe(Date.parse('2026-11-16T08:00:00Z'))
  })

  it('is right on the day the clock goes back (25 October 2026)', () => {
    expect(instantOf('2026-10-25', '00:30', 'Asia/Jerusalem')).toBe(Date.parse('2026-10-24T21:30:00Z'))
    expect(instantOf('2026-10-25', '03:00', 'Asia/Jerusalem')).toBe(Date.parse('2026-10-25T01:00:00Z'))
  })

  it('refuses a malformed time', () => {
    expect(instantOf('2026-11-16', '', 'Asia/Jerusalem')).toBeNull()
  })
})
