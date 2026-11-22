// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { enExams } from './enExams'

const FSI = String.fromCodePoint(0x2068)
const PDI = String.fromCodePoint(0x2069)
const NAME = 'חדו"א 1 (מועד א)'
const ISOLATED = `${FSI}${NAME}${PDI}`

describe('enExams: the texts that carry an exam name', () => {
  const NAMED: [string, string][] = [['list.progressLabel', enExams.list.progressLabel(NAME)]]

  it.each(NAMED)('%s isolates the name exactly once', (_path, text) => {
    expect(text).toContain(ISOLATED)
    expect(text.split(ISOLATED).join('')).not.toContain(NAME)
    expect(text.split(FSI)).toHaveLength(2)
  })

  it('the table above covers every isolate() call of enExams.ts', () => {
    const source = readFileSync(new URL('./enExams.ts', import.meta.url), 'utf8')
    const calls = source.split('\n').filter((line) => line.includes('${isolate(')).length
    expect(calls).toBe(NAMED.length)
  })
})

describe('enExams: the list', () => {
  it('says the days left in words', () => {
    expect(enExams.list.chip(0)).toBe('Today')
    expect(enExams.list.chip(1)).toBe('Tomorrow')
    expect(enExams.list.chip(22)).toBe('in 22 days')
    expect(enExams.list.chip(-3)).toBe('Exam day passed')
    expect(enExams.list.chip(-3)).toBe(enExams.list.passed)
  })

  it('joins the date and the progress', () => {
    expect(enExams.list.rowDetail('16 December 2026', enExams.list.progress(42))).toBe('16 December 2026. 42% of the plan done')
    expect(enExams.list.noTasks).toBe('No tasks yet')
  })
})
