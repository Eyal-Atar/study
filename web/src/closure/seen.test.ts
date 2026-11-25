import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markShown, seenKey, wasShown } from './seen'

const ITEM = { exam_id: 'exam-1', sitting: 1 }

describe('seen', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keys by exam and sitting', () => {
    expect(seenKey(ITEM)).toBe('exam-1:1')
  })

  it('remembers what was shown, per sitting and per user', () => {
    expect(wasShown('u-a', ITEM)).toBe(false)
    markShown('u-a', ITEM)
    expect(wasShown('u-a', ITEM)).toBe(true)
    expect(wasShown('u-a', { ...ITEM, sitting: 2 })).toBe(false)
    expect(wasShown('u-b', ITEM)).toBe(false)
  })

  it('stores a JSON array under archi.closure.<userId>', () => {
    markShown('u-store', ITEM)
    expect(JSON.parse(window.localStorage.getItem('archi.closure.u-store') ?? 'null')).toEqual(['exam-1:1'])
  })

  it('still knows within the load when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    markShown('u-blocked', ITEM)
    expect(wasShown('u-blocked', ITEM)).toBe(true)
    expect(wasShown('u-blocked', { ...ITEM, sitting: 2 })).toBe(false)
  })

  it.each(['{broken', '{"a":1}', '[1,2]', '"x"'])('treats %s as empty without throwing', (raw) => {
    window.localStorage.setItem('archi.closure.u-bad', raw)
    expect(wasShown('u-bad', ITEM)).toBe(false)
  })

  it('keeps the newest 50', () => {
    for (let i = 0; i < 51; i++) markShown('u-many', { exam_id: `e${String(i)}`, sitting: 1 })
    expect(wasShown('u-many', { exam_id: 'e0', sitting: 1 })).toBe(false)
    expect(wasShown('u-many', { exam_id: 'e1', sitting: 1 })).toBe(true)
    expect(wasShown('u-many', { exam_id: 'e50', sitting: 1 })).toBe(true)
  })
})
