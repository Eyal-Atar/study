// The texts of S45: the interface of closing an exam and of Moed B. Part of en as en.closure (en.ts).
// The functions take what is already worked out: a duration from durationText, a date from
// longDate / dayMonth of exam/dates.ts, a progress line from en.exams.list.progress. Nothing is computed here.
import { isolate } from './bidi'

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

// "a", "a and b", "a, b and c": every name is user content, so each one is isolated.
const names = (list: string[]) => {
  const parts = list.map((name) => isolate(name))
  if (parts.length < 2) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`
}

// The question of the evening of the exam: the sheet, the row of the calendar and the card say it alike.
const madeIt = (name: string) => `You made it through ${isolate(name)}. How did it feel?`

export const enClosure = {
  // The closure sheet (ClosureSheet): the question, then the state after the decision.
  sheet: {
    title: madeIt,
    // studied comes from durationText ("21 hours").
    stats: (studied: string, percent: number) => `You studied ${studied} and finished ${String(percent)}% of the plan.`,
    // When studied_minutes is 0: no "You studied 0 min".
    statsNoTime: (percent: number) => `You finished ${String(percent)}% of the plan.`,
    nailed: 'Nailed it',
    keepOpen: 'Keep open for Moed B',
    bloomed: (name: string) => `${isolate(name)} is in full bloom. I’ve freed up its time for what’s next.`,
    kept: (name: string) =>
      `I’ll keep everything for ${isolate(name)} safe and quiet. When the Moed B date is out, tell me and I’ll plan a focused round.`,
    haveDate: 'I have the date',
    // The primary button after a decision, when another exam is still waiting for its answer.
    next: (name: string) => `Tell me about ${isolate(name)}`,
    undone: (name: string) => `I put ${isolate(name)} back as it was.`,
    // A 409 invalid_state: the exam was closed elsewhere, or its date changed.
    stale: 'That exam changed in the meantime, so I looked again.',
  },
  // The closure row of the calendar banner.
  row: {
    say: madeIt,
    sayMany: (count: number) =>
      `You made it through ${plural(count, 'exam', 'exams')}. How did ${count === 1 ? 'it' : 'they'} feel?`,
    open: 'Tell me',
  },
  // The card on the exam screen of a pending exam.
  card: {
    open: 'Tell me',
  },
  // The card on the exam screen of an exam waiting for Moed B.
  waiting: {
    say: (name: string) => `${isolate(name)} is waiting for Moed B.`,
    kept: (files: number, tasks: number) => {
      const kept = [files > 0 ? plural(files, 'file', 'files') : '', tasks > 0 ? plural(tasks, 'task', 'tasks') : '']
        .filter(Boolean)
        .join(' and ')
      return kept ? `I’m keeping its ${kept} for Moed B.` : 'I’m keeping everything for Moed B.'
    },
    plan: 'Plan Moed B',
    done: 'I’m done with it',
  },
  // The card on the exam screen of a closed exam.
  archived: {
    say: (name: string) => `${isolate(name)} is in full bloom.`,
    // date: '16 November 2026'
    closedOn: (date: string) => `I closed it on ${date}.`,
  },
  // The Moed B form (MoedBForm) and the state after it.
  moedB: {
    title: 'When is Moed B?',
    date: 'Moed B date',
    grade: 'How did Moed A go? (optional)',
    gradeHint: 'Your grade, from 0 to 100.',
    gradeError: 'Enter a whole number from 0 to 100.',
    hard: 'What felt hard?',
    hardHint: 'I’ll put these first, right after the practice exams.',
    notes: 'Anything else that felt hard? (optional)',
    notesTooLong: 'That’s a bit long. I can take up to 1,000 characters.',
    submit: 'Plan my Moed B',
    submitting: 'Planning…',
    // weak: the names of weak_topics, in the order of the answer.
    done: (weak: string[]) =>
      weak.length === 0
        ? 'I’ve put the practice exams first, then a general review.'
        : `I’ve put the practice exams first, then ${names(weak)}, then a general review.`,
    // When unscheduled or shortfalls are not empty.
    short: 'Not everything fits before Moed B. Your calendar shows what’s left.',
    undone: (name: string) => `I put ${isolate(name)} back to waiting for Moed B.`,
    // Undo of moed_b_opened refused with invalid_state.
    cantUndo: 'You’ve already studied for Moed B, so I can’t undo this.',
  },
  // The exams list: the chips, the Moed B detail and the archive card.
  list: {
    pending: 'How did it go?',
    waiting: 'Waiting for Moed B',
    done: 'Done',
    // detail: the usual row detail ('16 December 2026. 42% of the plan done').
    moedB: (detail: string) => `Moed B. ${detail}`,
    // 'Closed on 16 Nov. 86% of the plan done'; progress from en.exams.list.progress.
    closedOn: (date: string, progress: string) => `Closed on ${date}. ${progress}`,
    archive: 'Archive',
    noneComing: 'No exams coming up. Add the next one when you know its date.',
  },
  // The heading of the exam screen in Moed B.
  exam: {
    moedALine: (date: string, grade: number | null) =>
      grade === null ? `Moed A was on ${date}.` : `Moed A was on ${date}, grade ${String(grade)}.`,
  },
  // The archive section of the progress screen.
  progress: {
    title: 'Archive',
    closedOn: (date: string) => `Closed on ${date}`,
    // studied from durationText.
    summary: (studied: string, percent: number) => `${studied} studied, ${String(percent)}% of the plan`,
  },
} as const
