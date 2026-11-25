import type { BadgeGroup } from '../progress/types'

// The geometry of the five badge stones (S33, plan decision 6), on a 48 grid with 3 units of air.
// Its own file so the tests can measure it (BadgeStone.test.tsx checks that every row of dots fits
// inside its stone).

export interface StoneShapeData {
  /** The outline of the stone; the cairn has two, the lower one first so the upper sits on it. */
  stones: string[]
  /** Facet lines inside the polished stone. */
  facets?: string[]
  /** The centre of the symbol in the 48 grid, and its scale from the 24 grid of the icons. */
  symbol: { cx: number; cy: number; scale: number }
  /** The y of the row of tier dots. */
  dotsY: number
  /** The distance between the centres of two dots: tighter in the narrow standing stone. */
  dotGap: number
}

/** The outline of the stones and of the facets. */
export const STONE_LINE = 1.75
/** A tier dot: its radius, and the line around it. */
export const DOT_R = 1.5
export const DOT_LINE = 1

export const STONE_SHAPES: Record<BadgeGroup, StoneShapeData> = {
  // A low, round pebble.
  first: {
    stones: ['M7.5 30.5C7 21.5 14 15 24 15s16.75 5.5 16.5 14.5C40.25 37 33.5 41.5 24 41.5S8 38 7.5 30.5Z'],
    symbol: { cx: 24, cy: 25.5, scale: 0.62 },
    dotsY: 35.5,
    dotGap: 4.25,
  },
  // A flat, wide river stone.
  blocks: {
    stones: ['M3.5 28.5C3.5 21.5 11.5 17 24 17.5s20.75 4 20.5 11c-.25 6-9 9-21.5 8.5S3.5 34 3.5 28.5Z'],
    symbol: { cx: 24, cy: 24, scale: 0.6 },
    dotsY: 32.25,
    dotGap: 4.25,
  },
  // A tall, narrow standing stone.
  streak: {
    stones: ['M14.5 44C12 34 12.5 20 16 11c1.75-4.75 4.75-7.5 8.5-7.5 4.25 0 7.25 3.75 8.75 9.5 2.5 9.5 2.5 21.5.25 31-.25 1-18.75 1-19 0Z'],
    symbol: { cx: 24, cy: 19.5, scale: 0.6 },
    dotsY: 34,
    dotGap: 3.5,
  },
  // A cairn: a small stone on a wide one.
  level: {
    stones: [
      'M4.5 36C4.25 30 12 26.5 24 26.5S43.75 30 43.5 35.75C43.25 41 36 44 24 44S4.75 41.5 4.5 36Z',
      'M13.75 17.75C13.5 10 18 5 24.5 5s10.75 5 10.25 12.5C34.25 24.5 30 28.5 24 28.5s-10-4-10.25-10.75Z',
    ],
    symbol: { cx: 24, cy: 16.75, scale: 0.6 },
    dotsY: 35.5,
    dotGap: 4.25,
  },
  // A polished stone cut in facets.
  xp: {
    stones: ['M24 3.5 38 10l6 14-5.5 14L24 44.5 9.5 38 4 24l6-14Z'],
    facets: ['M10 10l7 5.5h14l7-5.5', 'M4 24l13-8.5', 'M44 24l-13-8.5'],
    symbol: { cx: 24, cy: 26, scale: 0.6 },
    dotsY: 37.5,
    dotGap: 4.25,
  },
}
