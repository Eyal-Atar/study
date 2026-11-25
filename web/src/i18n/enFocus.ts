// The texts of the focus screen and of the way into it from the calendar (S42). Part of en as en.focus (en.ts).
// The functions take numbers and times that are already worked out: no time is computed here.
import type { TaskKind } from '../board/types'
import { isolate } from './bidi'

// Under the number: the short unit has no plural ("1 min left", "24 min left"), so the count is not read.
// It still takes the count, so a screen passes it and the wording can change here alone.
const unit: (n: number) => string = () => 'min left'

export const enFocus = {
  // The heading while the block loads, and the name of the tab if one is needed.
  title: 'Focus',
  start: 'Start now',
  startLabel: (title: string) => `Start now: ${isolate(title)}`,
  five: 'Just 5 minutes',
  fiveLabel: (title: string) => `Just 5 minutes: ${isolate(title)}`,
  resume: 'Back to focus',
  // Also the aria-label of the arrow button.
  back: 'Back to the calendar',
  stop: 'Stop for now',
  stopped: 'I stopped the timer. The block is still on your calendar.',
  timerLabel: 'Time left',
  // The big number in the ring: only the digits, the unit is under it.
  minutesLeft: (n: number) => String(n),
  unit,
  ofFive: 'left of your 5 minutes',
  until: (time: string) => `Until ${time}`,
  valueText: (n: number, until: string) => `${String(n)} ${n === 1 ? 'minute' : 'minutes'} left, until ${until}`,
  // Picked by the day of the year, like archiLine.
  running: [
    'I’m right here, studying with you.',
    'Take your time. I’ll be here when you look up.',
    'One step at a time. I’m not going anywhere.',
  ],
  // The tiny first step of "Just 5 minutes", by the kind of the task (the audit, 17).
  fiveTask: {
    learn: 'Just open the file and read page 1 with me.',
    review: 'Just open the file and read page 1 with me.',
    practice: 'Just open the first question and read it with me.',
    simulation: 'Just open the exam and read the first question with me.',
    simulation_review: 'Just open your answers and look at the first one with me.',
    custom: 'Just take the first small step with me.',
  } satisfies Record<TaskKind, string>,
  // Not a question, and nothing that asks for an answer: the flow goes on.
  fiveDone: (until: string) => `That’s five minutes. I’ll keep going with you until ${until}.`,
  over: 'That’s the end of the block. If you studied, mark it done.',
  ended: 'This block has already ended. You can still mark it done.',
  alreadyDone: 'This block is already marked done.',
  gone: 'I can’t find this block on today’s calendar.',
  notToday: 'I can only start one of today’s blocks that hasn’t ended yet.',
  // kind comes from en.board.kinds ("Learning").
  meta: (exam: string, kind: string) => `${isolate(exam)}, ${kind}`,
} as const
