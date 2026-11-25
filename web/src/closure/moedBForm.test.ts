import { parseDate } from '@internationalized/date'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { validateMoedB, type MoedBDraft } from './moedBForm'

const TODAY = '2026-11-24'
const f = en.onboardingExams

function draft(overrides: Partial<MoedBDraft> = {}): MoedBDraft {
  return {
    date: parseDate('2026-12-20'),
    grade: '',
    topicIds: [],
    notes: '',
    ...overrides,
  }
}

describe('validateMoedB', () => {
  it('requires a date', () => {
    const r = validateMoedB(draft({ date: null }), TODAY)
    expect(r.errors.date).toBe(f.dateRequired)
    expect(r.body).toBeNull()
  })
  it('rejects today, accepts tomorrow, rejects 731 days ahead', () => {
    expect(validateMoedB(draft({ date: parseDate('2026-11-24') }), TODAY).errors.date).toBe(f.dateTooEarly)
    const ok = validateMoedB(draft({ date: parseDate('2026-11-25') }), TODAY)
    expect(ok.errors).toEqual({})
    expect(ok.body).toEqual({ exam_date: '2026-11-25' })
    expect(validateMoedB(draft({ date: parseDate('2028-11-24') }), TODAY).errors.date).toBe(f.dateTooLate)
  })
  it('sends a grade only when given', () => {
    expect(validateMoedB(draft({ grade: '' }), TODAY).body).not.toHaveProperty('grade')
    expect(validateMoedB(draft({ grade: ' ' }), TODAY).body).not.toHaveProperty('grade')
    expect(validateMoedB(draft({ grade: '55' }), TODAY).body?.grade).toBe(55)
    expect(validateMoedB(draft({ grade: '0' }), TODAY).body?.grade).toBe(0)
    expect(validateMoedB(draft({ grade: '100' }), TODAY).body?.grade).toBe(100)
  })
  it.each(['101', '5.5', 'abc', '-1'])('rejects the grade %s', (grade) => {
    const r = validateMoedB(draft({ grade }), TODAY)
    expect(r.errors.grade).toBe(en.closure.moedB.gradeError)
    expect(r.body).toBeNull()
  })
  it('limits the notes to 1,000 characters before trimming', () => {
    const r = validateMoedB(draft({ notes: 'a'.repeat(1001) }), TODAY)
    expect(r.errors.notes).toBe(en.closure.moedB.notesTooLong)
    expect(r.body).toBeNull()
    expect(validateMoedB(draft({ notes: 'a'.repeat(1000) }), TODAY).body?.hard_notes).toHaveLength(1000)
    expect(validateMoedB(draft({ notes: ' '.repeat(1001) }), TODAY).errors.notes).toBe(en.closure.moedB.notesTooLong)
  })
  it('trims notes and drops blank ones', () => {
    expect(validateMoedB(draft({ notes: '   ' }), TODAY).body).not.toHaveProperty('hard_notes')
    expect(validateMoedB(draft({ notes: ' hard ' }), TODAY).body?.hard_notes).toBe('hard')
  })
  it('sends topics only when chosen', () => {
    expect(validateMoedB(draft(), TODAY).body).not.toHaveProperty('hard_topic_ids')
    expect(validateMoedB(draft({ topicIds: ['t1', 't2'] }), TODAY).body?.hard_topic_ids).toEqual(['t1', 't2'])
  })
})
