// The texts of S45: the interface of closing an exam and of Moed B. Part of en as en.closure (en.ts).
// S45b: in the text the student reads the term is retake; the identifiers and keys kept their Moed B names.
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
const madeIt = (name: string) => `You made it through ${isolate(name)}. What should I do with it now?`

export const enClosure = {
  // The closure sheet (ClosureSheet): the question, then the state after the decision.
  sheet: {
    title: madeIt,
    // studied comes from durationText ("21 hours").
    stats: (studied: string, percent: number) => `You studied ${studied} and finished ${String(percent)}% of the plan.`,
    // When studied_minutes is 0: no "You studied 0 min".
    statsNoTime: (percent: number) => `You finished ${String(percent)}% of the plan.`,
    // Keep as a memory: closes the exam done, into the archive.
    nailed: 'Keep it as a memory',
    keepOpen: 'Keep it open for a retake',
    delete: 'Delete it',
    deleted: (name: string) => `I’ve deleted ${isolate(name)}.`,
    bloomed: (name: string) => `${isolate(name)} is in full bloom. I’ve moved it to your archive.`,
    kept: (name: string) =>
      `I’ll keep everything for ${isolate(name)} safe and quiet. When you know the retake date, tell me and I’ll plan a focused round.`,
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
      `You made it through ${plural(count, 'exam', 'exams')}. What should I do with ${count === 1 ? 'it' : 'them'} now?`,
    open: 'Choose',
  },
  // The card on the exam screen of a pending exam.
  card: {
    open: 'Choose',
  },
  // The card on the exam screen of an exam waiting for Moed B.
  waiting: {
    say: (name: string) => `${isolate(name)} is waiting for its retake.`,
    kept: (files: number, tasks: number) => {
      const kept = [files > 0 ? plural(files, 'file', 'files') : '', tasks > 0 ? plural(tasks, 'task', 'tasks') : '']
        .filter(Boolean)
        .join(' and ')
      return kept ? `I’m keeping its ${kept} for the retake.` : 'I’ll keep this exam ready for the retake.'
    },
    plan: 'Plan the retake',
    // Keep as a memory: closes the exam done, into the archive.
    done: 'Keep it as a memory',
    delete: 'Delete it',
  },
  // The card on the exam screen of a closed exam.
  archived: {
    say: (name: string) => `${isolate(name)} is in full bloom.`,
    // date: '16 November 2026'. The student closed it: Archi never closes an exam by himself.
    closedOn: (date: string) => `You closed it on ${date}.`,
  },
  // The Moed B form (MoedBForm) and the state after it.
  moedB: {
    title: 'When is the retake?',
    date: 'Retake date',
    grade: 'How did the first sitting go? (optional)',
    gradeHint: 'Your grade, from 0 to 100.',
    gradeError: 'Enter a whole number from 0 to 100.',
    hard: 'What felt hard?',
    hardHint: 'I’ll put these right after the practice exams.',
    // The notes field and its description, only when the topic list is shown: the server takes a
    // topic from the free text only when its full name appears there (7.13), and nothing else.
    notes: 'Anything else that felt hard? (optional)',
    notesHint: 'If you write a topic’s name as it appears above, I’ll put it right after the practice exams too.',
    notesTooLong: 'That’s a bit long. I can take up to 1,000 characters.',
    submit: 'Plan my retake',
    submitting: 'Planning…',
    // simulations: how many practice exams the round starts with (Moed A's simulations, at most
    // two, or one default); weak: the names of weak_topics, in the order of the answer. No word on
    // general review: the answer cannot tell whether the budget trimmed all of it.
    done: (simulations: number, weak: string[]) => {
      const first = `I’ve put the ${simulations === 1 ? 'practice exam' : 'practice exams'} first`
      return weak.length === 0 ? `${first}.` : `${first}, then ${names(weak)}.`
    },
    // When the answer has a shortfall of this exam (the replan covers the whole board). The calendar
    // shows what did not fit in the banner's row of unplaced tasks.
    short: 'Not everything fits before the retake. Your calendar shows what didn’t fit.',
    undone: (name: string) => `I put ${isolate(name)} back to waiting for its retake.`,
    // Undo of moed_b_opened refused with invalid_state: a Moed B task was done or skipped, or a
    // block of it is running now.
    cantUndo: 'The retake is already under way, so I can’t undo this.',
  },
  // The exams list: the chips, the Moed B detail and the archive card.
  list: {
    pending: 'What next?',
    waiting: 'Waiting for a retake',
    done: 'Done',
    // detail: the usual row detail ('16 December 2026. 42% of the plan done').
    moedB: (detail: string) => `Retake. ${detail}`,
    // 'Closed on 16 Nov. 86% of the plan done'; progress from en.exams.list.progress.
    closedOn: (date: string, progress: string) => `Closed on ${date}. ${progress}`,
    archive: 'Archive',
    noneComing: 'No exams coming up. Add the next one when you know its date.',
  },
  // The heading of the exam screen in Moed B.
  exam: {
    moedALine: (date: string, grade: number | null) =>
      grade === null ? `You first sat it on ${date}.` : `You first sat it on ${date} and got ${String(grade)}.`,
  },
  // The archive section of the progress screen.
  progress: {
    title: 'Archive',
    closedOn: (date: string) => `Closed on ${date}`,
    // studied from durationText.
    summary: (studied: string, percent: number) => `${studied} studied, ${String(percent)}% of the plan`,
  },
} as const
