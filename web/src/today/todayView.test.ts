import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTodayView } from './todayView'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useTodayView', () => {
  it('a browser that refuses storage starts with the list, and the switch still works for the visit', () => {
    const refuse = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse)

    const { result } = renderHook(() => useTodayView())
    expect(result.current[0]).toBe('list')
    expect(getItem).toHaveBeenCalled()

    act(() => {
      result.current[1]('timeline')
    })
    expect(result.current[0]).toBe('timeline')
    expect(setItem).toHaveBeenCalled()

    act(() => {
      result.current[1]('list')
    })
    expect(result.current[0]).toBe('list')
  })
})
