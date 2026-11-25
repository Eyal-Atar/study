import type { Stage } from './model'

// The geometry of the garden scene (S33, Task 5): the plant at the centre for each stage, the
// leaf, the pond and the raked lines of the sand. Its own file, like stoneShapes.ts, so parts.tsx
// exports only components. Coordinates are from the base of the plant: up is negative y.

// A small almond leaf, 6 units long, centred on its origin.
export const LEAF = 'M-3 0c1.6-1.6 4.4-1.6 6 0-1.6 1.6-4.4 1.6-6 0Z'

// A leaf at a point, turned by `angle` degrees.
export type LeafSpot = readonly [x: number, y: number, angle: number]
// A pad of foliage: an ellipse.
type Pad = readonly [cx: number, cy: number, rx: number, ry: number]

export interface StageArt {
  /** The height of the plant above its base (14 for the seed up to 92 for the whole garden). */
  height: number
  /** The width of its hit area. */
  width: number
  /** The trunk and its branches, in clay; the seed and the sprout have none. */
  wood: string[]
  /** The foliage, sprout green on a brand line. */
  pads: Pad[]
  /** The ten fixed places of the leaves; the seed and the sprout keep them on the sand around the base. */
  leaves: readonly LeafSpot[]
  /** Where the leaf of the opening motion starts its fall. */
  fall: readonly [x: number, y: number]
}

const AROUND_BASE: readonly LeafSpot[] = [
  [-16, 2, -20],
  [16, 1, 20],
  [-24, 4, 10],
  [24, 3, -10],
  [-10, 6, 30],
  [11, 6, -30],
  [-31, 2, -5],
  [31, 1, 5],
  [-20, 8, 15],
  [20, 8, -15],
]

export const STAGE_ART: Record<Stage, StageArt> = {
  seed: { height: 14, width: 44, wood: [], pads: [], leaves: AROUND_BASE, fall: [6, -10] },
  sprout: { height: 28, width: 44, wood: [], pads: [], leaves: AROUND_BASE, fall: [10, -22] },
  sapling: {
    height: 44,
    width: 44,
    wood: ['M-3 0C-2-10-2-20-.5-30h2C3-20 3-10 4 0Z'],
    pads: [
      [-9, -28, 8, 6],
      [9, -29, 8, 6],
      [0, -34, 14, 10],
    ],
    leaves: [
      [-8, -38, -25],
      [7, -40, 25],
      [0, -43, -5],
      [11, -32, 40],
      [-12, -30, -40],
      [2, -31, 10],
      [-5, -34, -60],
      [13, -27, 60],
      [-15, -25, -20],
      [6, -35, -35],
    ],
    fall: [10, -36],
  },
  young: {
    height: 60,
    width: 48,
    wood: ['M-5 0C-4-14-3-28-.5-42h3C4-28 5-14 6 0Z', 'M1-24C6-28 10-30 14-34l1 2C11-28 7-25 2-21Z'],
    pads: [
      [-14, -40, 10, 7],
      [14, -38, 10, 7],
      [0, -48, 18, 12],
    ],
    leaves: [
      [-10, -52, -25],
      [9, -54, 25],
      [0, -57, 0],
      [15, -44, 40],
      [-16, -42, -40],
      [3, -46, 10],
      [-6, -48, -60],
      [18, -36, 60],
      [-19, -37, -20],
      [8, -42, -35],
    ],
    fall: [14, -50],
  },
  // A bonsai: an S-shaped trunk and three flat pads of foliage.
  bonsai: {
    height: 76,
    width: 64,
    wood: [
      'M-8 0C-6-12 6-18 4-30 2-40-6-44-4-62h4C0-46 8-40 9-30 11-16 0-12 4 0Z',
      'M2-34C-6-36-14-38-20-42l1-2C-12-41-5-39 3-37Z',
      'M2-48C8-50 14-54 18-58l1 2C15-52 9-48 3-45Z',
    ],
    pads: [
      [-22, -44, 15, 6],
      [20, -58, 15, 6],
      [-2, -68, 17, 8],
    ],
    leaves: [
      [-30, -45, -15],
      [-20, -47, 10],
      [-12, -43, -30],
      [13, -59, 15],
      [24, -60, -10],
      [30, -57, 30],
      [-10, -70, -20],
      [0, -73, 5],
      [8, -68, 25],
      [-24, -41, 40],
    ],
    fall: [24, -60],
  },
  // The whole zen garden: a full bonsai with a flowering branch, beside its pond.
  garden: {
    height: 92,
    width: 72,
    wood: [
      'M-10 0C-8-16 8-22 6-36 4-50-8-54-5-76h5C-1-56 10-50 11-36 13-18 0-14 5 0Z',
      'M3-40C-6-42-18-44-26-50l1-2C-16-47-6-45 4-43Z',
      'M2-56C10-58 18-62 24-68l1 2C20-60 12-55 3-52Z',
      'M8-22C12-22 16-24 20-28l1 2C17-22 13-20 9-19Z',
    ],
    pads: [
      [-28, -52, 17, 7],
      [26, -70, 17, 7],
      [22, -30, 10, 4],
      [-3, -82, 20, 10],
    ],
    leaves: [
      [-38, -53, -15],
      [-27, -56, 10],
      [-18, -51, -30],
      [18, -72, 15],
      [29, -73, -10],
      [36, -69, 30],
      [-14, -84, -20],
      [-3, -88, 5],
      [8, -83, 25],
      [19, -31, 10],
    ],
    fall: [30, -72],
  },
}

/** The pond of the full garden, on the back of the sand left of the centre, behind the row of stones (from the base). */
export const POND = { cx: -58, cy: -2, rx: 16, ry: 3.5 } as const

/** A raked line across the whole ground, from x=-200 to x=560: gentle waves of 40 units. */
export function rakeLine(y: number): string {
  let d = `M-200 ${String(y)}q10 -1.5 20 0`
  for (let x = -180; x < 560; x += 20) d += 't20 0'
  return d
}
