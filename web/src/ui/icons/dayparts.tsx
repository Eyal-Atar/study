import { createIcon, PAPER, SOLID } from './Icon'

/** Morning: the sun coming up over the horizon, short rays, on its way up. */
export const MorningIcon = createIcon(
  'MorningIcon',
  <>
    <path d="M7 19a5 5 0 0 1 10 0Z" {...PAPER} />
    <path d="M2.5 19h19" />
    <path d="M12 10.5V3.5" />
    <path d="m9 6.5 3-3 3 3" />
    <path d="m6.5 13.5-1.25-1.25" />
    <path d="m17.5 13.5 1.25-1.25" />
  </>,
)

/** The middle of the day: the whole sun. */
export const NoonIcon = createIcon(
  'NoonIcon',
  <>
    <circle cx="12" cy="12" r="4.25" {...PAPER} />
    <path d="M12 2.5V5" />
    <path d="M12 19v2.5" />
    <path d="M2.5 12H5" />
    <path d="M19 12h2.5" />
    <path d="m5.6 5.6 1.4 1.4" />
    <path d="m17 17 1.4 1.4" />
    <path d="m18.4 5.6-1.4 1.4" />
    <path d="m7 17-1.4 1.4" />
  </>,
)

/** Evening: the sun low on the water, long rays above it and its light on the surface below. */
export const EveningIcon = createIcon(
  'EveningIcon',
  <>
    <path d="M7 13a5 5 0 0 1 10 0Z" {...PAPER} />
    <path d="M2.5 13h19" />
    <path d="M12 5.25V2.75" />
    <path d="m6.7 7.7-1.8-1.8" />
    <path d="m17.3 7.7 1.8-1.8" />
    <path d="M6.5 17h11" />
    <path d="M9.5 20.75h5" />
  </>,
)

/** Night: a crescent moon and one star. */
export const NightIcon = createIcon(
  'NightIcon',
  <>
    <path d="M10.5 6A7.5 7.5 0 1 0 18 13.5 5.5 5.5 0 1 1 10.5 6Z" {...PAPER} />
    <path
      d="M17.75 3.25c.3 1.7 1.05 2.45 2.75 2.75-1.7.3-2.45 1.05-2.75 2.75-.3-1.7-1.05-2.45-2.75-2.75 1.7-.3 2.45-1.05 2.75-2.75Z"
      strokeWidth={1.25}
      {...SOLID}
    />
  </>,
)
