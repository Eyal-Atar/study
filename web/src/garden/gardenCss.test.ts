// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SWAY_MS } from './GardenScene'

// Read from disk: Vitest does not load CSS content into tests.
const css = readFileSync(new URL('./garden.css', import.meta.url), 'utf8')

// Decision 11: the centre sways once for 1,200ms when the progress screen opens, and the leaf that
// falls with it ends with it, so the timer of GardenCard (SWAY_MS) never cuts either short.
describe('garden.css: the opening motion', () => {
  it('the sway runs 1,200ms, not --duration-ceremony', () => {
    expect(SWAY_MS).toBe(1200)
    expect(css).toMatch(/\.garden-sway\s*\{\s*animation:\s*garden-sway 1200ms /)
    expect(css).not.toMatch(/animation:\s*garden-sway var\(--duration-ceremony\)/)
  })

  it('the falling leaf ends with the sway', () => {
    expect(css).toMatch(/\.garden-leaf-fall\s*\{\s*animation:\s*garden-leaf-fall 1200ms /)
  })
})
