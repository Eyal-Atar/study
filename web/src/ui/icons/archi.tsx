import { createIcon, PAPER, SOLID } from './Icon'

/** The streak: one leaf, tilted, growing from its stem. */
export const StreakLeafIcon = createIcon(
  'StreakLeafIcon',
  <>
    <path d="M7 17.5C4 11 9.5 4 20 4c0 10.5-6.5 16-13 13.5Z" {...PAPER} />
    <path d="M3.5 20.5C7 17 10.5 13.5 14.5 9.5" />
  </>,
)

/** XP: a warm four-point spark with a small one beside it. */
export const XpSparkIcon = createIcon(
  'XpSparkIcon',
  <>
    <path
      d="M10 5c.7 5 3 7.3 8 8-5 .7-7.3 3-8 8-.7-5-3-7.3-8-8 5-.7 7.3-3 8-8Z"
      {...PAPER}
    />
    <path
      d="M18.5 2.75c.3 1.7 1.05 2.45 2.75 2.75-1.7.3-2.45 1.05-2.75 2.75-.3-1.7-1.05-2.45-2.75-2.75 1.7-.3 2.45-1.05 2.75-2.75Z"
      strokeWidth={1.25}
      {...SOLID}
    />
  </>,
)

/** A break, a rest day: a tea cup without a handle, and two wisps of steam. */
export const TeaCupIcon = createIcon(
  'TeaCupIcon',
  <>
    <path d="M6 9.25h12v3.5a6 6 0 0 1-12 0Z" {...PAPER} />
    <path d="M8 21.5h8" />
    <path d="M9.75 6.5c-1.1-1.2 1.1-2.3 0-3.75" />
    <path d="M14.25 6.5c-1.1-1.2 1.1-2.3 0-3.75" />
  </>,
)

/** The first seed: a seedling with two leaves. */
export const SproutIcon = createIcon(
  'SproutIcon',
  <>
    <path d="M12 14c-4.5 0-7.2-2.2-7.5-6.5 4.3 0 7.2 2.2 7.5 6.5Z" {...PAPER} />
    <path d="M12 10.5c.3-4.3 3-6.5 7.5-6.5 0 4.3-3 6.5-7.5 6.5Z" {...PAPER} />
    <path d="M12 21V10.5" />
    <path d="M7.5 21h9" />
  </>,
)

/** A zen cairn: three stones, one on another. */
export const StoneIcon = createIcon(
  'StoneIcon',
  <>
    <ellipse cx="12" cy="18.25" rx="7.75" ry="3.25" {...PAPER} />
    <ellipse cx="12.75" cy="12.25" rx="5.25" ry="2.75" {...PAPER} />
    <ellipse cx="11.5" cy="7" rx="3.25" ry="2.5" {...PAPER} />
  </>,
)

/** A cherry blossom: five petals cut from one piece of paper. */
export const BlossomIcon = createIcon(
  'BlossomIcon',
  <>
    <path
      d="M9.88 9.09C7.44 1.77 16.56 1.77 14.12 9.09 20.32 4.51 23.14 13.17 15.42 13.11 21.7 17.6 14.33 22.96 12 15.6 9.67 22.96 2.3 17.6 8.58 13.11.86 13.17 3.68 4.51 9.88 9.09Z"
      {...PAPER}
    />
    <circle cx="12" cy="12" r="0.9" {...SOLID} />
  </>,
)
