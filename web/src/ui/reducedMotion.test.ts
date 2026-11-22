import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion, REDUCED_MOTION } from './reducedMotion'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prefersReducedMotion', () => {
  it('asks the system the one reduced-motion query', () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === REDUCED_MOTION }))
    vi.stubGlobal('matchMedia', matchMedia)
    expect(prefersReducedMotion()).toBe(true)
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })

  it('is false when the system does not ask for less motion', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    expect(prefersReducedMotion()).toBe(false)
  })

  it('is false without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })
})
