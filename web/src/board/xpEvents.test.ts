import { describe, expect, it, vi } from 'vitest'
import { emitCompleted, onCompleted } from './xpEvents'

describe('xpEvents', () => {
  it('calls every listener with the event', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = onCompleted(first)
    const offSecond = onCompleted(second)
    emitCompleted({ blockId: 'block-1', xp: 20 })
    expect(first).toHaveBeenCalledExactlyOnceWith({ blockId: 'block-1', xp: 20 })
    expect(second).toHaveBeenCalledExactlyOnceWith({ blockId: 'block-1', xp: 20 })
    offFirst()
    offSecond()
  })

  it('does not call a listener that unsubscribed', () => {
    const listener = vi.fn()
    const off = onCompleted(listener)
    off()
    emitCompleted({ blockId: 'block-1', xp: 20 })
    expect(listener).not.toHaveBeenCalled()
  })

  it('a listener that unsubscribes while the event runs does not stop the others', () => {
    const second = vi.fn()
    const offFirst = onCompleted(() => {
      offFirst()
    })
    const offSecond = onCompleted(second)
    emitCompleted({ blockId: 'block-1', xp: 5 })
    expect(second).toHaveBeenCalledOnce()
    offSecond()
  })
})
