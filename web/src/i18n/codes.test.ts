import { describe, expect, it } from 'vitest'
import { codeText, shortfallText, unscheduledText } from './codes'
import { en } from './en'

// Every code that S07–S12 send to the web (spec 7.5–7.8, and the roadmap items of S13).
const CODES = [
  'no_study_days', 'not_enough_time', 'no_contiguous_window', 'dependency_cycle', 'dependency_not_scheduled',
  'dependency_too_late', 'longer_than_daily_minutes', 'dependent_too_early',
  'file_missing', 'file_too_large', 'unsupported_file', 'pdf_unreadable', 'storage_unavailable', 'material_missing',
  'internal_error', 'worker_crashed', 'pages_truncated', 'text_truncated', 'too_many_materials', 'already_exists',
  'exam_missing', 'already_analyzed', 'no_study_time', 'analysis_invalid', 'ai_unavailable', 'ai_rejected',
  'ai_refused', 'ai_not_configured', 'response_truncated', 'under_budget', 'trimmed_to_budget',
  'materials_not_ready', 'scanned_pages_skipped', 'budget_raised_to_minimum',
  'ai_no_credit', 'ai_quota_exceeded', 'nothing_to_analyze', 'materials_processing',
  'unauthenticated', 'not_found', 'validation_error', 'database_unavailable', 'plan_conflict', 'stale_plan',
  'placement_failed', 'invalid_state', 'nothing_to_undo', 'exam_in_past', 'network', 'timeout',
]

describe('codeText', () => {
  it.each(CODES)('%s has its own Hebrew text', (code) => {
    const text = codeText(code)
    expect(text).not.toBe(en.errors.generic)
    expect(text).toMatch(/[א-ת]/)
  })

  it('no_study_time also names the daily time for yourself, which the planner subtracts too', () => {
    expect(codeText('no_study_time')).toContain('הזמן לעצמי')
  })

  it('an unknown code gets the generic text, never the code', () => {
    expect(codeText('something_new')).toBe(en.errors.generic)
  })

  it('the quota text shows the reset time in Jerusalem', () => {
    // 22:00Z on 16.11 is 00:00 on 17.11 in Jerusalem (UTC+2).
    const text = codeText('ai_quota_exceeded', { resets_at: '2026-11-16T22:00:00Z' }, new Date('2026-11-16T22:30:00Z'))
    expect(text).toContain('00:00')
    expect(text).not.toContain('22:00')
  })

  it('the quota text names the date when the reset is not today', () => {
    const text = codeText('ai_quota_exceeded', { resets_at: '2026-11-16T22:00:00Z' }, new Date('2026-11-16T10:00:00Z'))
    expect(text).toContain('00:00')
    expect(text).toContain('17.11')
  })

  it('size and count limits come from the problem', () => {
    expect(codeText('file_too_large', { limit_bytes: 20971520 })).toContain('20 MB')
    expect(codeText('too_many_materials', { limit: 15 })).toContain('15')
  })
})

describe('reports', () => {
  it('a shortfall with a daily amount suggests it', () => {
    const text = shortfallText('חדו"א', 240, 300)
    expect(text).toContain('4 שעות')
    expect(text).toContain('5 שעות')
    expect(text).toContain('חדו"א')
  })

  it('a shortfall without a daily amount suggests the other ways, with no number', () => {
    const text = shortfallText('פיזיקה', 90, null)
    expect(text).toContain('1.5 שעות')
    expect(text).toContain('לוותר על משימות')
    expect(text).not.toMatch(/ביום/)
  })

  it('a cycle reason has its own wording', () => {
    expect(unscheduledText('dependency_cycle')).toBe(en.report.cycle)
    expect(unscheduledText('not_enough_time')).toBe(en.codes.not_enough_time)
  })
})
