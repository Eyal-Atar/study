import { describe, expect, it } from 'vitest'
import { asOf } from './asOf'

const TZ = 'Asia/Jerusalem'
// Sunday 22 November 2026, 12:00 in Jerusalem (UTC+2).
const NOW = Date.parse('2026-11-22T12:00:00+02:00')

describe('asOf', () => {
  it('data of today is the time alone', () => {
    expect(asOf(Date.parse('2026-11-22T11:20:00+02:00'), TZ, NOW)).toBe('11:20')
  })

  it('data of another day is the short date and the time', () => {
    expect(asOf(Date.parse('2026-11-21T09:00:00+02:00'), TZ, NOW)).toBe('Sat, 21 Nov, 09:00')
  })

  it('the day is the profile’s, not UTC’s: 00:30 in Jerusalem is today there and yesterday in UTC', () => {
    expect(asOf(Date.parse('2026-11-22T00:30:00+02:00'), TZ, NOW)).toBe('00:30')
    // 23:30 on Saturday in Jerusalem.
    expect(asOf(Date.parse('2026-11-21T23:30:00+02:00'), TZ, NOW)).toBe('Sat, 21 Nov, 23:30')
  })

  it('follows the timezone it is given', () => {
    // 11:20 in Jerusalem is 04:20 in New York, the same Sunday.
    expect(asOf(Date.parse('2026-11-22T11:20:00+02:00'), 'America/New_York', NOW)).toBe('04:20')
  })

  it('no data yet is null', () => {
    expect(asOf(0, TZ, NOW)).toBeNull()
    expect(asOf(undefined, TZ, NOW)).toBeNull()
  })

  it('uses the clock when no "now" is given', () => {
    expect(asOf(Date.now(), TZ)).toMatch(/^\d{2}:\d{2}$/)
  })
})
