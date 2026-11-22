// The texts of the grid of the calendar and its blocks (S32 Tasks 7, 8). Part of en.calendar (en.ts).
import { isolate } from './bidi'

export const enCalendarGrid = {
  label: (range: string) => `Calendar, ${range}`,
  today: 'Today',
  streakDay: 'Streak kept',
  freeDay: 'Free day',
  busyUntitled: 'Busy',
  // The accessible name of a block: the task and the exam are user content.
  blockLabel: (name: string, range: string, exam: string, kind: string, state: string | null, locked: boolean) =>
    `${isolate(name)}, ${range}, ${isolate(exam)}, ${kind}${state === null ? '' : `, ${state}`}${locked ? ', locked' : ''}`,
  busyLabel: (title: string, range: string) => `Busy time: ${isolate(title)}, ${range}`,
  // Busy time with no title: not "Busy time: Busy".
  busyLabelUntitled: (range: string) => `Busy time, ${range}`,
  meta: (kind: string, range: string) => `${kind}. ${range}`,
  metaState: (state: string) => `. ${state}`,
  metaLocked: ', locked',
  instructions:
    'Press Enter for actions. To move the block, press the up or down arrow. Each press moves it 15 minutes, Page Up and Page Down move it an hour, Enter confirms and Escape cancels.',
  // What a candidate time is while a block is being moved, by the server's code.
  problem: {
    free: 'free',
    slot_taken: 'taken',
    slot_busy: 'busy time',
    outside_day: 'outside your day',
    invalid_state: 'can’t move',
  },
  candidate: (range: string, state: string) => `${range}, ${state}`,
  ghostLeaving: 'Will move',
  newBusy: 'New busy time',
} as const
