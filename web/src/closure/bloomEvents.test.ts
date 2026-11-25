import { afterEach, describe, expect, it, vi } from 'vitest'
import { emitBloom, onBloom } from './bloomEvents'
import type { BloomEvent } from './types'

const EVENT: BloomEvent = {
  kind: 'course_bloomed',
  exam_id: 'exam-1',
  exam_name: 'הסתברות',
  color_index: 2,
}

describe('bloomEvents', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  it('delivers to a listener until it unsubscribes', () => {
    const listener = vi.fn()
    const off = onBloom(listener)
    emitBloom(EVENT)
    expect(listener).toHaveBeenCalledWith(EVENT)
    off()
    emitBloom(EVENT)
    expect(listener).toHaveBeenCalledTimes(1)
  })
  it('a throwing listener does not stop the next one or the emit', () => {
    vi.useFakeTimers()
    const second = vi.fn()
    const off1 = onBloom(() => {
      throw new Error('boom')
    })
    const off2 = onBloom(second)
    expect(() => {
      emitBloom(EVENT)
    }).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
    off1()
    off2()
    vi.clearAllTimers()
  })
})
