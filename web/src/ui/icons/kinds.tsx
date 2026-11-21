import { createIcon, PAPER, PAPER_ONLY, SOLID } from './Icon'

/*
  The kinds of a task. Each has its own silhouette, so a day's load reads at a glance: a wide open
  book (learning), a slanted pencil (practice), a round returning arrow (review), a tall sheet with
  a clock (a simulation).
*/

/** Learning: an open book. */
export const LearningIcon = createIcon(
  'LearningIcon',
  <>
    <path
      d="M12 6.75C10 5.25 7 4.75 3 5.25v13c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5v-13c-4-.5-7 0-9 1.5Z"
      {...PAPER}
    />
    <path d="M12 6.75v13" />
  </>,
)

/** Practice: a pencil writing a line. */
export const PracticeIcon = createIcon(
  'PracticeIcon',
  <>
    <path d="m15.5 3.5 4 4L8.75 18.25 3.5 19.5l1.25-5.25Z" {...PAPER} />
    <path d="m12.75 6.25 4 4" />
    <path d="M13 20.5h8" />
  </>,
)

/** Review: going back over the page, an arrow that returns around two lines of text. */
export const ReviewIcon = createIcon(
  'ReviewIcon',
  <>
    <circle cx="12" cy="12" r="8.75" {...PAPER_ONLY} />
    <path d="M4.5 7.5A8.75 8.75 0 1 1 3.25 12" />
    <path d="M4.5 3.25V7.5h4.25" />
    <path d="M9 10.5h6" />
    <path d="M9 14h3.5" />
  </>,
)

/** A simulation: an exam sheet with a clock running at its corner. */
export const SimulationIcon = createIcon(
  'SimulationIcon',
  <>
    <rect x="4.5" y="3" width="12.5" height="18" rx="2" {...PAPER_ONLY} />
    <path d="M11 21H6.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2H15a2 2 0 0 1 2 2v5" />
    <path d="M8 7.5h5.5" />
    <path d="M8 11h3" />
    <circle cx="17.25" cy="17" r="4.25" />
    <path d="M17.25 14.75V17l1.5 1" />
  </>,
)

/** Going over a simulation: the sheet, checked. */
export const SimulationReviewIcon = createIcon(
  'SimulationReviewIcon',
  <>
    <rect x="5" y="3" width="14" height="18" rx="2" {...PAPER} />
    <path d="M9 7.5h6" />
    <path d="m8.75 14.25 2.25 2.25 4.25-4.75" />
  </>,
)

/** A task of the user's own: one item on a card. */
export const TaskIcon = createIcon(
  'TaskIcon',
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" {...PAPER} />
    <circle cx="8.5" cy="12" r="0.9" {...SOLID} />
    <path d="M12 12h4" />
  </>,
)
