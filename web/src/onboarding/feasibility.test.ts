import { describe, expect, it } from 'vitest'
import type { Weekday } from '../availability/types'
import { TIGHT_HOURS_PER_EXAM, estimateStudyMinutes, feasibility, type FeasibilityInput } from './feasibility'

// A Sunday, so weekday 0 is today, 1 is tomorrow, and so on.
const TODAY = '2026-11-22'
const EVERY_DAY: Weekday[] = [0, 1, 2, 3, 4, 5, 6]

function inDays(days: number): string {
  const [y, m, d] = TODAY.split('-').map(Number)
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10)
}

const PROFILE: FeasibilityInput['profile'] = {
  wake_time: '07:00',
  sleep_time: '23:00',
  study_start_delay_minutes: 0,
  daily_study_minutes: 960,
  study_windows: ['morning', 'evening'],
  rest_days_before_exam: 0,
}

interface Overrides {
  exams?: FeasibilityInput['exams']
  profile?: Partial<FeasibilityInput['profile']>
  busy?: FeasibilityInput['busy']
}

function input(over: Overrides): FeasibilityInput {
  return {
    today: TODAY,
    exams: over.exams ?? [{ name: 'הסתברות', exam_date: inDays(3) }],
    profile: { ...PROFILE, ...over.profile },
    busy: over.busy ?? [],
  }
}

function everyDay(start_time: string, end_time: string, valid_until?: string | null): FeasibilityInput['busy'] {
  return EVERY_DAY.map((weekday) => ({ weekday, start_time, end_time, valid_until }))
}

// The minutes of the one exam of the input.
function minutesOf(i: FeasibilityInput): number | undefined {
  return estimateStudyMinutes(i).get(i.exams[0]?.exam_date ?? '')
}

describe('estimateStudyMinutes', () => {
  it('counts every day from tomorrow to the last study day, capped at the daily minutes', () => {
    // Morning 07:00-12:00 (300) and evening 17:00-21:00 (240), capped at 240. An exam in 22 days with
    // one rest day: the last study day is in 20 days, so tomorrow through day 20 is 20 days.
    const i = input({
      exams: [{ name: 'אלגוריתמים', exam_date: inDays(22) }],
      profile: { daily_study_minutes: 240, rest_days_before_exam: 1 },
    })
    expect(minutesOf(i)).toBe(20 * 240)
  })

  it('counts the windows inside the waking hours only, after the start delay', () => {
    // Waking at 07:00 with a 60-minute delay: the morning is 08:00-12:00 (240); sleep at 20:00
    // cuts the evening to 17:00-20:00 (180). An exam in 3 days, no rest: two study days.
    const i = input({ profile: { study_start_delay_minutes: 60, sleep_time: '20:00' } })
    expect(minutesOf(i)).toBe(2 * (240 + 180))
  })

  it('counts the night after midnight when the student is still awake, but not into the exam day', () => {
    // Night 21:00-02:00, awake 07:00-02:00: 300 a day. Without rest days the planner stops at the
    // midnight before the exam (exam_cutoff), so the eve of the exam keeps only 21:00-00:00 (180).
    const i = input({ profile: { study_windows: ['night'], sleep_time: '02:00' } })
    expect(minutesOf(i)).toBe(300 + 180)
  })

  it('takes busy time of 22:00-00:00 out of the night', () => {
    // What is left of the night is 21:00-22:00 and 00:00-02:00: 180 a day; on the eve of the exam
    // only 21:00-22:00 (60).
    const i = input({ profile: { study_windows: ['night'], sleep_time: '02:00' }, busy: everyDay('22:00', '00:00') })
    expect(minutesOf(i)).toBe(180 + 60)
  })

  it('without rest days, an earlier exam’s midnight cuts the night for a later exam too', () => {
    // Exams in 2 and 4 days: days 1, 2, 3 for the later one. Day 1 is the eve of the first exam
    // (180), day 2 is a whole night (300), day 3 is the eve of the second (180).
    const i = input({
      profile: { study_windows: ['night'], sleep_time: '02:00' },
      exams: [
        { name: 'הסתברות', exam_date: inDays(2) },
        { name: 'שפת C', exam_date: inDays(4) },
      ],
    })
    const minutes = estimateStudyMinutes(i)
    expect(minutes.get(inDays(2))).toBe(180)
    expect(minutes.get(inDays(4))).toBe(180 + 300 + 180)
  })

  it('with rest days, no exam’s midnight cuts a night, like the planner', () => {
    // With rest days the planner has no midnight cutoffs: an exam's cutoff is the end of its last
    // study day's waking hours. One rest day, exams in 4 and 5 days. Day 3 is the first exam's rest
    // day and the second's last study day; its night runs into the first exam's day and is whole.
    const i = input({
      profile: { study_windows: ['night'], sleep_time: '02:00', rest_days_before_exam: 1 },
      exams: [
        { name: 'הסתברות', exam_date: inDays(4) },
        { name: 'שפת C', exam_date: inDays(5) },
      ],
    })
    const minutes = estimateStudyMinutes(i)
    expect(minutes.get(inDays(4))).toBe(2 * 300)
    expect(minutes.get(inDays(5))).toBe(3 * 300)
  })

  it('skips an exam whose date is empty or partly typed', () => {
    const i = input({
      exams: [
        { name: 'הסתברות', exam_date: '' },
        { name: 'שפת C', exam_date: '2026-1' },
        { name: 'אלגוריתמים', exam_date: inDays(3) },
      ],
    })
    expect([...estimateStudyMinutes(i).keys()]).toEqual([inDays(3)])
  })

  it('stops at 400 days from tomorrow, so a mistyped year stays quick and finite', () => {
    const i = input({ profile: { daily_study_minutes: 60 }, exams: [{ name: 'הסתברות', exam_date: '2206-11-22' }] })
    const started = performance.now()
    const minutes = minutesOf(i)
    expect(performance.now() - started).toBeLessThan(500)
    expect(minutes).toBe(400 * 60)
  })

  it('takes a commitment that crosses midnight out of the next morning too', () => {
    // A night shift on Monday (tomorrow) 22:00-09:00 takes Tuesday's 07:00-09:00. Monday keeps its
    // morning and its evening up to 21:00 (540); Tuesday keeps 09:00-12:00 and the evening (420).
    const i = input({ busy: [{ weekday: 1, start_time: '22:00', end_time: '09:00' }] })
    expect(minutesOf(i)).toBe(540 + 420)
  })

  it('takes busy time out only on its own weekday', () => {
    // Monday's morning is taken; Tuesday keeps all 540.
    const i = input({ busy: [{ weekday: 1, start_time: '07:00', end_time: '12:00' }] })
    expect(minutesOf(i)).toBe(240 + 540)
  })

  it('gives 0 when busy time covers every window on every day', () => {
    const i = input({
      exams: [{ name: 'הסתברות', exam_date: inDays(30) }],
      profile: { study_windows: ['morning', 'afternoon', 'evening', 'night'], sleep_time: '02:00' },
      busy: everyDay('06:00', '02:00'),
    })
    expect(minutesOf(i)).toBe(0)
  })

  it('does not count a piece shorter than 30 minutes, and counts one of exactly 30', () => {
    const short = input({ profile: { study_windows: ['morning'] }, busy: everyDay('07:20', '12:00') })
    expect(minutesOf(short)).toBe(0)
    const enough = input({ profile: { study_windows: ['morning'] }, busy: everyDay('07:30', '12:00') })
    expect(minutesOf(enough)).toBe(2 * 30)
  })

  it('joins windows that touch before it drops short pieces', () => {
    // Afternoon 12:00-17:00 and evening 17:00-21:00 are one window; busy 12:00-16:40 and
    // 17:20-21:00 leave 16:40-17:20, 40 minutes across the boundary.
    const i = input({
      profile: { study_windows: ['afternoon', 'evening'] },
      busy: [...everyDay('12:00', '16:40'), ...everyDay('17:20', '21:00')],
    })
    expect(minutesOf(i)).toBe(2 * 40)
  })

  it('ignores busy time whose valid_until is before the day, and keeps it on that day', () => {
    // Valid until today: no study day is cut.
    const ended = input({ profile: { study_windows: ['morning'] }, busy: everyDay('07:00', '12:00', TODAY) })
    expect(minutesOf(ended)).toBe(2 * 300)
    // Valid until tomorrow: tomorrow is cut, the day after is not.
    const tomorrow = input({ profile: { study_windows: ['morning'] }, busy: everyDay('07:00', '12:00', inDays(1)) })
    expect(minutesOf(tomorrow)).toBe(300)
    // No end: every day is cut.
    const open = input({ profile: { study_windows: ['morning'] }, busy: everyDay('07:00', '12:00', null) })
    expect(minutesOf(open)).toBe(0)
  })

  it('gives each exam date the minutes from tomorrow to its own last study day', () => {
    const i = input({
      profile: { daily_study_minutes: 60 },
      exams: [
        { name: 'שפת C', exam_date: inDays(8) },
        { name: 'הסתברות', exam_date: inDays(4) },
      ],
    })
    const minutes = estimateStudyMinutes(i)
    expect(minutes.get(inDays(4))).toBe(3 * 60)
    expect(minutes.get(inDays(8))).toBe(7 * 60)
  })
})

describe('feasibility', () => {
  it('is null without exams', () => {
    expect(feasibility(input({ exams: [] }))).toBeNull()
  })

  it('is null while the only exam’s date is still being typed, and ignores such an exam otherwise', () => {
    expect(feasibility(input({ exams: [{ name: 'הסתברות', exam_date: '' }] }))).toBeNull()
    expect(feasibility(input({ exams: [{ name: 'הסתברות', exam_date: '2026-12-' }] }))).toBeNull()
    const estimate = feasibility(
      input({
        profile: { daily_study_minutes: 240 },
        exams: [
          { name: 'שפת C', exam_date: '' },
          { name: 'הסתברות', exam_date: inDays(11) },
        ],
      }),
    )
    expect(estimate).toEqual({ level: 'roomy', firstExamName: 'הסתברות', firstExamMinutes: 10 * 240 })
  })

  it('an exam tomorrow with a rest day is none, and names the exam', () => {
    const estimate = feasibility(
      input({ exams: [{ name: 'הסתברות', exam_date: inDays(1) }], profile: { rest_days_before_exam: 1 } }),
    )
    expect(estimate).toEqual({
      level: 'none',
      firstExamName: 'הסתברות',
      firstExamMinutes: 0,
      tightExamName: 'הסתברות',
      tightExamMinutes: 0,
    })
  })

  it('an exam in 22 days at 4 hours a day is roomy, with all its minutes', () => {
    const estimate = feasibility(
      input({
        exams: [{ name: 'אלגוריתמים', exam_date: inDays(22) }],
        profile: { daily_study_minutes: 240, rest_days_before_exam: 1 },
      }),
    )
    expect(estimate).toEqual({ level: 'roomy', firstExamName: 'אלגוריתמים', firstExamMinutes: 20 * 240 })
  })

  it('busy time over every window is none', () => {
    const estimate = feasibility(
      input({
        exams: [{ name: 'הסתברות', exam_date: inDays(30) }],
        profile: { study_windows: ['morning', 'afternoon', 'evening', 'night'], sleep_time: '02:00' },
        busy: everyDay('06:00', '02:00'),
      }),
    )
    expect(estimate?.level).toBe('none')
    expect(estimate?.tightExamName).toBe('הסתברות')
  })

  it('three exams within a week at an hour a day is tight, at the first exam it happens', () => {
    // Last study days in 2, 4 and 6 days: 120 minutes for the first exam alone.
    const estimate = feasibility(
      input({
        profile: { daily_study_minutes: 60 },
        exams: [
          { name: 'שפת C', exam_date: inDays(7) },
          { name: 'הסתברות', exam_date: inDays(3) },
          { name: 'אלגוריתמים', exam_date: inDays(5) },
        ],
      }),
    )
    expect(estimate).toEqual({
      level: 'tight',
      firstExamName: 'הסתברות',
      firstExamMinutes: 120,
      tightExamName: 'הסתברות',
      tightExamMinutes: 120,
      tightExamCount: 1,
    })
  })

  it('divides by the exams up to the tight one, which may be a later exam', () => {
    // 12 hours before the first exam (enough for one); 13 hours before the second, 6.5 for each.
    const estimate = feasibility(
      input({
        profile: { daily_study_minutes: 60 },
        exams: [
          { name: 'הסתברות', exam_date: inDays(13) },
          { name: 'שפת C', exam_date: inDays(14) },
        ],
      }),
    )
    expect(estimate).toEqual({
      level: 'tight',
      firstExamName: 'הסתברות',
      firstExamMinutes: 12 * 60,
      tightExamName: 'שפת C',
      tightExamMinutes: (13 * 60) / 2,
      tightExamCount: 2,
    })
  })

  it('counts exams on the same date together', () => {
    // 15 hours before a date with two exams: 7.5 for each.
    const estimate = feasibility(
      input({
        profile: { daily_study_minutes: 60 },
        exams: [
          { name: 'הסתברות', exam_date: inDays(16) },
          { name: 'שפת C', exam_date: inDays(16) },
        ],
      }),
    )
    expect(estimate?.level).toBe('tight')
    expect(estimate?.tightExamMinutes).toBe((15 * 60) / 2)
    expect(estimate?.tightExamCount).toBe(2)
  })

  it('exactly the threshold for each exam is roomy', () => {
    // 10 days at 60 minutes before the exam: exactly TIGHT_HOURS_PER_EXAM hours.
    expect(TIGHT_HOURS_PER_EXAM).toBe(10)
    const estimate = feasibility(
      input({ profile: { daily_study_minutes: 60 }, exams: [{ name: 'הסתברות', exam_date: inDays(11) }] }),
    )
    expect(estimate).toEqual({ level: 'roomy', firstExamName: 'הסתברות', firstExamMinutes: 600 })
  })

  it('is none when the first exam has no study day, even if a later one has plenty', () => {
    // Two rest days before an exam in 2 days: its last study day is yesterday.
    const estimate = feasibility(
      input({
        profile: { rest_days_before_exam: 2 },
        exams: [
          { name: 'הסתברות', exam_date: inDays(2) },
          { name: 'שפת C', exam_date: inDays(10) },
        ],
      }),
    )
    expect(estimate?.level).toBe('none')
    expect(estimate?.tightExamName).toBe('הסתברות')
    expect(estimate?.firstExamName).toBe('הסתברות')
  })
})
