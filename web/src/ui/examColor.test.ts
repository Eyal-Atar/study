// @vitest-environment node
/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EXAM_COLOR_COUNT, examColor, examColorIndex } from './examColor.ts'

const source = readFileSync(new URL('./examColor.ts', import.meta.url), 'utf8')

describe('examColor', () => {
  it('has eight colours', () => {
    expect(EXAM_COLOR_COUNT).toBe(8)
  })

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('index %i gives the classes of exam-%i', (n) => {
    expect(examColor(n)).toEqual({
      solid: `bg-exam-${String(n)}`,
      text: `text-exam-${String(n)}`,
      soft: `bg-exam-${String(n)}-soft`,
      line: `border-exam-${String(n)}-line`,
      borderStrong: `border-exam-${String(n)}`,
      fill: `fill-exam-${String(n)}`,
    })
  })

  it('wraps an index outside 0-7, rounds down a fraction, and falls back to slate', () => {
    expect(examColorIndex(8)).toBe(0)
    expect(examColorIndex(15)).toBe(7)
    expect(examColorIndex(-1)).toBe(7)
    expect(examColorIndex(2.7)).toBe(2)
    expect(examColorIndex(null)).toBe(7)
    expect(examColorIndex(undefined)).toBe(7)
    expect(examColorIndex(Number.NaN)).toBe(7)
    expect(examColor(8).solid).toBe('bg-exam-0')
    expect(examColor(null).solid).toBe('bg-exam-7')
  })

  it('writes every class in full in the source: Tailwind finds only classes written as they are', () => {
    for (let n = 0; n < EXAM_COLOR_COUNT; n++) {
      for (const cls of Object.values(examColor(n) as unknown as Record<string, string>)) expect(source).toContain(`'${cls}'`)
    }
  })
})
