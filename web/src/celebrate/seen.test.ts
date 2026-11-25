import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCelebrated, writeCelebrated } from './seen'

const DEFAULT = { day: null, level: 1, badges: [] }

describe('celebrate/seen', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the default when nothing is stored', () => {
    expect(readCelebrated('u-none')).toEqual(DEFAULT)
  })

  it('reads back what was written, per user', () => {
    const value = { day: '2026-11-16', level: 4, badges: ['first_task', 'xp_1000'] }
    writeCelebrated('u-a', value)
    expect(readCelebrated('u-a')).toEqual(value)
    expect(readCelebrated('u-b')).toEqual(DEFAULT)
  })

  it('stores JSON under archi.celebrated.<userId>', () => {
    writeCelebrated('u-store', { day: null, level: 2, badges: ['first_task'] })
    expect(JSON.parse(window.localStorage.getItem('archi.celebrated.u-store') ?? 'null')).toEqual({
      day: null,
      level: 2,
      badges: ['first_task'],
    })
  })

  it('still knows within the load when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readCelebrated('u-blocked')).toEqual(DEFAULT)
    const value = { day: '2026-11-16', level: 3, badges: ['iron_will_7'] }
    expect(() => {
      writeCelebrated('u-blocked', value)
    }).not.toThrow()
    expect(readCelebrated('u-blocked')).toEqual(value)
    expect(readCelebrated('u-other')).toEqual(DEFAULT)
  })

  it.each([
    '{broken',
    '[1,2]',
    '"x"',
    'null',
    '{"day":null,"level":"3","badges":[]}',
    '{"day":5,"level":3,"badges":[]}',
    '{"day":null,"level":3,"badges":[1]}',
    '{"day":null,"level":3}',
    '{"day":null,"level":0,"badges":[]}',
    '{"day":null,"level":2.5,"badges":[]}',
    '{"day":null,"level":-1,"badges":[]}',
  ])('treats %s as the default without throwing', (raw) => {
    window.localStorage.setItem('archi.celebrated.u-bad', raw)
    expect(readCelebrated('u-bad')).toEqual(DEFAULT)
  })
})
