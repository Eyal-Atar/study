import { act, renderHook } from '@testing-library/react'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion, REDUCED_MOTION, useReducedMotion } from './reducedMotion'

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

describe('useReducedMotion', () => {
  it('follows the system setting live', () => {
    let matches = false
    const listeners = new Set<() => void>()
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        get matches() {
          return query === REDUCED_MOTION && matches
        },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      })),
    )
    const { result, unmount } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
    act(() => {
      matches = true
      for (const listener of listeners) listener()
    })
    expect(result.current).toBe(true)
    unmount()
    expect(listeners.size).toBe(0)
  })

  it('is false without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })
})

// One source for the query: a component asks this file, it does not write its own. Archie keeps
// his own subscription (archie/Archie.tsx is not touched by the screens' scopes).
describe('the reduced-motion query', () => {
  it('is written only here and in Archie', () => {
    const src = join(process.cwd(), 'src')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return walk(path)
        // Tests and their fixtures stand for the system: they may write the query.
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|^testFixtures\.ts$/.test(entry.name) ? [path] : []
      })
    const writers = walk(src)
      .filter((path) => readFileSync(path, 'utf8').includes("'(prefers-reduced-motion: reduce)'"))
      .map((path) => relative(src, path).split(sep).join('/'))
    expect(writers.sort()).toEqual(['archie/Archie.tsx', 'ui/reducedMotion.ts'])
  })
})
