import { createIcon, PAPER, PAPER_ONLY, SOLID } from './Icon'

/** "I have free time now": an hourglass. */
export const FreeTimeIcon = createIcon(
  'FreeTimeIcon',
  <>
    <path
      d="M7 3v3.5c0 3 5 3.5 5 5.5s-5 2.5-5 5.5V21h10v-3.5c0-3-5-3.5-5-5.5s5-2.5 5-5.5V3Z"
      {...PAPER}
    />
    <path d="M5 3h14" />
    <path d="M5 21h14" />
  </>,
)

/** To the next free slot: forward, up to the slot. */
export const NextSlotIcon = createIcon(
  'NextSlotIcon',
  <>
    <path
      d="M4.5 6.25v11.5a1 1 0 0 0 1.55.83l8.45-5.75a1 1 0 0 0 0-1.66L6.05 5.42a1 1 0 0 0-1.55.83Z"
      {...PAPER}
    />
    <path d="M19 5.5v13" />
  </>,
)

/** Pick a time: a clock. */
export const PickTimeIcon = createIcon(
  'PickTimeIcon',
  <>
    <circle cx="12" cy="12" r="9" {...PAPER} />
    <path d="M12 7v5l3.25 2" />
  </>,
)

/** A practice exam: a sheet and a pencil. */
export const PracticeExamIcon = createIcon(
  'PracticeExamIcon',
  <>
    <rect x="4.5" y="3" width="12.5" height="18" rx="2" {...PAPER_ONLY} />
    <path d="M10 21H6.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2H15a2 2 0 0 1 2 2v4" />
    <path d="M8 7.5h5.5" />
    <path d="M8 11h3" />
    <path d="m18.75 11.25 2.5 2.5-6.25 6.25-3.25.750.75-3.25Z" />
  </>,
)

/** Offline: signal waves, crossed out. The waves stop short of the slash, so it stays clear at 16px. */
export const OfflineIcon = createIcon(
  'OfflineIcon',
  <>
    <path d="M2.28 9.78a13.75 13.75 0 0 1 19.44 0L12 19.5Z" {...PAPER_ONLY} />
    <path d="M2.28 9.78a13.75 13.75 0 0 1 2.48-1.97" />
    <path d="M9.44 5.99a13.75 13.75 0 0 1 12.28 3.79" />
    <path d="M5.46 12.96a9.25 9.25 0 0 1 2.45-1.76" />
    <path d="M13.37 10.35a9.25 9.25 0 0 1 5.17 2.61" />
    <path d="M8.64 16.14a4.75 4.75 0 0 1 2.56-1.32" />
    <circle cx="12" cy="19.5" r="0.9" {...SOLID} />
    <path d="m4 3.5 15.5 17" />
  </>,
)

/** Work: a briefcase. */
export const WorkIcon = createIcon(
  'WorkIcon',
  <>
    <rect x="3" y="7.5" width="18" height="12.5" rx="2.5" {...PAPER} />
    <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
    <path d="M3 12.5c3 1.5 6 2.25 9 2.25s6-.750 9-2.25" />
  </>,
)

/** A class: a graduation cap. */
export const ClassIcon = createIcon(
  'ClassIcon',
  <>
    <path d="m12 4.5 9.5 4.75L12 14 2.5 9.25Z" {...PAPER} />
    <path d="M6.5 11.5v4.25c0 1.5 2.5 2.75 5.5 2.75s5.5-1.25 5.5-2.75V11.5" />
    <path d="M21.5 9.25v5" />
  </>,
)

/** Done: a check cut by hand, a short stroke down and a long sweep up. */
export const CheckMarkIcon = createIcon(
  'CheckMarkIcon',
  <path d="M4.5 12.75c2 1.5 3.5 3.25 4.75 5.5C11.75 12.5 15 8.5 19.75 5.5" />,
)
