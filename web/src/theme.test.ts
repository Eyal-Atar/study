// @vitest-environment node
/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Read from disk: Vitest does not load CSS content into tests.
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

function color(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
  if (match?.[1] === undefined) throw new Error(`--color-${name} is not defined as #rrggbb`)
  return match[1]
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// WCAG AA for normal text: 4.5:1 (spec 7.9).
const PAIRS: [string, string][] = [
  ['ink', 'surface'],
  ['ink', 'surface-muted'],
  ['ink-muted', 'surface'],
  ['ink-muted', 'surface-muted'],
  ['on-brand', 'brand'],
  ['on-brand', 'brand-strong'],
  ['brand', 'surface'],
  ['brand-strong', 'brand-soft'],
  ['danger', 'surface'],
  ['danger', 'danger-soft'],
  ['success', 'success-soft'],
  ['warning', 'warning-soft'],
]

describe('theme colours', () => {
  it.each(PAIRS)('%s on %s passes AA', (fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5)
  })
})
