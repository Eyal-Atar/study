import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitBloom } from '../closure/bloomEvents'
import { BloomSlot } from './BloomSlot'
import { takeBloom, useBloomListener } from './bloomPlay'

function Listener() {
  useBloomListener()
  return null
}

function bloomEvent(examId: string) {
  return { kind: 'course_bloomed' as const, exam_id: examId, exam_name: 'Probability', color_index: 2 }
}

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: reduce && query.includes('reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T10:00:00Z'))
  mockReducedMotion(false)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('BloomSlot', () => {
  it('plays the opening once for an event, and not on a second mount (a refresh)', () => {
    const listener = render(<Listener />)
    act(() => {
      emitBloom(bloomEvent('e1'))
    })
    const first = render(<BloomSlot examId="e1" colorIndex={2} size={72} />)
    expect(first.container.querySelectorAll('.garden-petal')).toHaveLength(5)
    first.unmount()
    const second = render(<BloomSlot examId="e1" colorIndex={2} size={72} />)
    expect(second.container.querySelector('[data-slot="bloom"] svg')).not.toBeNull()
    expect(second.container.querySelector('.garden-petal')).toBeNull()
    listener.unmount()
  })

  it('plays only for the exam that bloomed', () => {
    const listener = render(<Listener />)
    act(() => {
      emitBloom(bloomEvent('e1'))
    })
    const other = render(<BloomSlot examId="e2" colorIndex={2} size={72} />)
    expect(other.container.querySelector('.garden-petal')).toBeNull()
    expect(takeBloom('e1')).toBe(true)
    expect(takeBloom('e1')).toBe(false)
    listener.unmount()
  })

  it('with reduced motion the flower is open and nothing moves', () => {
    mockReducedMotion(true)
    const listener = render(<Listener />)
    act(() => {
      emitBloom(bloomEvent('e3'))
    })
    const { container } = render(<BloomSlot examId="e3" colorIndex={2} size={72} />)
    expect(container.querySelector('.garden-petal')).toBeNull()
    expect(container.querySelector('[data-growth="bloom"]')).not.toBeNull()
    listener.unmount()
  })

  it('is hidden from assistive technology, since the title already says it', () => {
    const { container } = render(<BloomSlot examId="e4" colorIndex={2} size={118} />)
    expect(container.querySelector('[data-slot="bloom"]')).toHaveAttribute('aria-hidden', 'true')
  })
})
