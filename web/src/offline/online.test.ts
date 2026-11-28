import { onlineManager } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initOnline, useOnline } from './online'

afterEach(() => {
  vi.restoreAllMocks()
  onlineManager.setOnline(true)
})

describe('initOnline', () => {
  it('starts offline when the browser already is', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    initOnline()
    expect(onlineManager.isOnline()).toBe(false)
  })

  it('follows the online and offline events', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    initOnline()
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(onlineManager.isOnline()).toBe(false)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(onlineManager.isOnline()).toBe(true)
  })
})

describe('useOnline', () => {
  it('returns the current value and follows changes', () => {
    const { result } = renderHook(() => useOnline())
    expect(result.current).toBe(true)
    act(() => {
      onlineManager.setOnline(false)
    })
    expect(result.current).toBe(false)
  })
})
