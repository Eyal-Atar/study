// The texts of the sheets of the calendar: block actions, defer, free time, busy time (S32 Tasks 9, 10). Part of en.calendar (en.ts).
import { isolate } from './bidi'

export const enCalendarSheets = {
  actions: {
    title: 'What would you like to do with this block?',
    skipHint: 'The task leaves your plan.',
  },
  defer: {
    title: 'Where should I move this block?',
    next: 'Next free spot',
    nextHint: 'I’ll find the nearest free time.',
    tomorrow: 'Tomorrow',
    tomorrowHint: 'I’ll find a spot for this tomorrow.',
    pick: 'Pick a time',
    pickHint: 'From your free hours',
    day: 'Day',
    slots: 'Free times',
    loading: 'Looking for free times…',
    noSlots: 'There’s no free time that day.',
    back: 'Back',
    confirmAt: (time: string) => `Defer to ${time}`,
    preview: (from: string, to: string) => `It’s at ${from} now. I’ll move it to ${to}.`,
    skip: 'Skip',
    skipped: (title: string) => `I took this task out of your plan: ${isolate(title)}.`,
  },
  freeTime: {
    title: 'Good, some free time. How much do you have?',
    amount: 'How much time',
    options: { m30: '30 min', m60: '1 hour', m90: '1.5 hours', other: 'Other' },
    otherLabel: 'How long?',
    nextOne: 'I’ll bring this one forward to now',
    nextMany: 'I’ll bring these forward to now',
    instead: (range: string, was: string) => `${range}, instead of ${was}`,
    start: 'Start now',
    starting: 'Starting…',
    done: (count: number, range: string) =>
      count === 1
        ? `I brought 1 block forward to ${range}.`
        : `I brought ${String(count)} blocks forward to ${range}.`,
    undone: 'I put your blocks back where they were.',
  },
  busy: {
    titleNew: 'What should I keep free?',
    titleEdit: 'Busy time',
    what: 'What is it? (optional)',
    day: 'Day',
    from: 'From',
    to: 'To',
    // One block is named; several are only counted, so no title sits in the middle of a long line.
    willMove: (count: number, title: string) =>
      count === 1
        ? `I’ll move 1 block to make room: ${isolate(title)}.`
        : `I’ll move ${String(count)} blocks to make room.`,
    save: 'Mark as busy',
    saveEdit: 'Save',
    saving: 'Saving…',
    delete: 'Delete',
    saved: 'Busy time marked',
    savedMoved: (count: number) =>
      count === 1 ? 'I marked it as busy and moved 1 block.' : `I marked it as busy and moved ${String(count)} blocks.`,
    savedUnplaced: (count: number) =>
      count === 1
        ? 'I marked it as busy, but 1 task didn’t fit anywhere else.'
        : `I marked it as busy, but ${String(count)} tasks didn’t fit anywhere else.`,
    updated: 'Busy time updated',
    deleted: 'Busy time deleted',
    undone: 'Change undone',
  },
  commitment: {
    lead: 'This is one of your weekly busy times. I plan around it every week.',
    edit: 'Edit in settings',
    kinds: { work: 'Work', class: 'Class', other: 'Busy time' },
  },
} as const
