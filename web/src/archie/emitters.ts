import type { ArchieMood } from './moods'

// The particles of the motion layer, ported from the emitters of the prototype
// (docs/design/prototype/archie-moods.html, the FX object): which paper shape, where it starts
// (a percent of the frame: the cut-out of its mood), how big, which keyframes of archie.css move
// it, for how long, and the numbers of its path as CSS variables.
//
// Sizes and paths are in units of the art (S39): one unit is 9 pixels of the illustration, the
// 1% of the 900px frame the prototype measured in. The cut-outs have different widths, so
// Archie.tsx gives each frame its own --archie-u, and a drop is as big beside the pot in every
// mood and at every width.

export type Shape = 'leaf' | 'maple' | 'petal' | 'drop' | 'spark' | 'page' | 'smoke' | 'steam' | 'ripple'
export type Motion = 'fall' | 'drip' | 'rise' | 'twinkle' | 'curl' | 'steam' | 'ripple'

export interface Particle {
  id: number
  shape: Shape
  color: string
  x: number
  y: number
  // The width, in units of the art.
  size: number
  motion: Motion
  duration: number
  vars: Record<string, string>
}

export type Spawn = Omit<Particle, 'id'>

// [interval in ms, a function that makes one particle]. The layer calls each one at once when it
// starts, and then every interval, like the prototype's setInterval.
export type Emitter = readonly [number, () => Spawn]

// A length in units of the art, as CSS.
export const units = (n: number) => `calc(${n.toFixed(2)} * var(--archie-u))`

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T

// One fall: a paper shape drifting down the frame with a sway (fall() of the prototype). It goes
// down by --archie-fall, four fifths of the frame, and fades all the way, so it is gone before
// the lower edge and nothing has to clip it. drift is in units; the rotation starts at a random
// angle and turns 200 degrees on the way down.
function fall(shape: Shape, color: string, x: number, y: number, size: number, duration: number, drift: number): Spawn {
  return {
    shape,
    color,
    x,
    y,
    size,
    motion: 'fall',
    duration,
    vars: { '--r': `${rnd(-60, 60).toFixed(1)}deg`, '--dx': units(drift) },
  }
}

// A shape that fades in and floats off by (dx, dy) units while it turns by r ("rise" in
// archie.css).
function rise(shape: Shape, color: string, x: number, y: number, size: number, duration: number, dx: number, dy: number, r: number): Spawn {
  return { shape, color, x, y, size, motion: 'rise', duration, vars: { '--dx': units(dx), '--dy': units(dy), '--r': `${r.toFixed(1)}deg` } }
}

// A star that pops, turns 45 degrees and shrinks away by (dx, dy) units ("twinkle" in archie.css).
function twinkle(color: string, x: number, y: number, size: number, duration: number, dx: number, dy: number, r: number): Spawn {
  return { shape: 'spark', color, x, y, size, motion: 'twinkle', duration, vars: { '--dx': units(dx), '--dy': units(dy), '--r': `${r.toFixed(0)}deg` } }
}

// A curl of smoke or steam that rises and fades ("curl" and "steam" in archie.css: the smoke is
// at its fullest a quarter of the way, the steam at a third). from, dx and dy are in units.
function curl(shape: 'smoke' | 'steam', color: string, x: number, y: number, size: number, duration: number, opts: { dx: number; dy: number; r: number; from: number; peak: number; scaleFrom: number; scaleTo: number }): Spawn {
  return {
    shape,
    color,
    x,
    y,
    size,
    motion: shape === 'smoke' ? 'curl' : 'steam',
    duration,
    vars: {
      '--dx': units(opts.dx),
      '--dy': units(opts.dy),
      '--r': `${opts.r.toFixed(1)}deg`,
      '--from': units(opts.from),
      '--peak': String(opts.peak),
      '--sy0': String(opts.scaleFrom),
      '--sy1': String(opts.scaleTo),
    },
  }
}

// The colours are the paper of the illustrations themselves. On the old sky the pale ones stood
// out; on the light surfaces of the app (canvas, surface) they are a tone deeper, so a spark is
// gold and not a smudge, and steam is warm paper and not a grey line.
const AUTUMN = ['#a4552c', '#c27a3a', '#7d4a2a', '#8a8a3a'] as const
const GOLD_SPARKS = ['#e2b252', '#d4a24c', '#ecc66e'] as const
// The warm grey of the smoke painted over the incense burner.
const SMOKE = ['#8f8780', '#a69e96', '#7a726c'] as const
// Steam over a cup: the pale rose of the steam painted on the cup of the mat.
const STEAM = 'rgba(226, 205, 194, 0.95)'
const PETALS = ['#e7a7b4', '#ecb4bf', '#d98a9a', '#b0683c'] as const

export const EMITTERS: Record<ArchieMood, readonly Emitter[]> = {
  intentions: [
    // Water drops from the end of the spout into the open book in the pot. The water of the
    // illustration is clay brown paper; the drops are a quiet grey green, not a sky blue.
    [380, () => ({ shape: 'drop', color: '#8fb1ad', x: rnd(68.6, 70), y: rnd(63, 64.5), size: 2.2, motion: 'drip', duration: 900, vars: {} })],
    // Autumn leaves falling around him.
    [1500, () => fall(pick(['maple', 'leaf'] as const), pick(AUTUMN), rnd(8, 88), rnd(0, 3), rnd(3, 5), rnd(7000, 10000), rnd(-7, 5))],
    // A page lifting off the book, towards the books already in the air.
    [2600, () => rise('page', '#e6d3aa', rnd(76, 85), rnd(69, 73), 3, 4200, rnd(-2, 3), -20, rnd(-40, 40))],
  ],
  eureka: [
    // Sparkles around the halo: an arc over his head and down to his shoulders, inside the frame.
    [260, () => {
      const a = rnd(Math.PI - 0.45, Math.PI * 2 + 0.45)
      const r = rnd(0.22, 0.38)
      return twinkle(pick(GOLD_SPARKS), 47.5 + Math.cos(a) * r * 100, Math.max(1.5, 18 + Math.sin(a) * r * 52), rnd(1.5, 3.5), rnd(1400, 2400), 0, -3, 90)
    }],
    // Gold paper flecks rising from the stone in his lap.
    [700, () => rise('leaf', '#e2b252', rnd(45, 52), 71, 1.2, rnd(3000, 4200), rnd(-4, 4), -24, rnd(-200, 200))],
  ],
  wisdom: [
    // Curls of paper smoke rising from the incense burner at the end of the table.
    [1100, () => curl('smoke', pick(SMOKE), rnd(81.6, 83.6), 37, 7, 5200, { dx: rnd(-1.6, 1.2), dy: -14, r: rnd(-12, 12), from: 3.3, peak: 0.85, scaleFrom: 0.6, scaleTo: 1.2 })],
  ],
  flow: [
    // A new sand ripple drawn around the head of the rake. It stays on the sand.
    [1600, () => ({ shape: 'ripple', color: 'rgba(140,105,65,.55)', x: 17, y: 84, size: 10, motion: 'ripple', duration: 4200, vars: {} })],
    // A leaf drifting down beside him.
    [3400, () => fall('leaf', pick(['#a4552c', '#c27a3a', '#6f9443']), rnd(48, 92), rnd(1, 4), 2.8, rnd(8000, 11000), rnd(-9, -2))],
  ],
  rest: [
    // Steam from the cup in his hands, and from the cup on the mat.
    [900, () => curl('steam', STEAM, rnd(49.3, 50.5), 30, 3.4, 3600, { dx: rnd(-0.9, 0.9), dy: -6, r: 0, from: 1.1, peak: 0.8, scaleFrom: 0.5, scaleTo: 1.1 })],
    [1500, () => curl('steam', STEAM, rnd(20, 21.2), 65, 3, 3600, { dx: rnd(-0.9, 0.9), dy: -7, r: 0, from: 1.1, peak: 0.8, scaleFrom: 0.5, scaleTo: 1.1 })],
    // Blossom petals (and a leaf now and then) drifting down on both sides of him. The cherry
    // branches they came from are no longer painted, so there are fewer of them.
    [1400, () => {
      const left = Math.random() < 0.6
      return fall(
        pick(['petal', 'petal', 'leaf'] as const),
        pick(PETALS),
        left ? rnd(4, 30) : rnd(68, 88),
        left ? rnd(3, 14) : rnd(2, 10),
        rnd(2, 3.2),
        rnd(7000, 10000),
        rnd(1, 8),
      )
    }],
  ],
  joy: [
    // Sparkles bursting out of the gold stone in his hand.
    [420, () => {
      const a = rnd(0, Math.PI * 2)
      const r = rnd(0.04, 0.11)
      return twinkle(pick(GOLD_SPARKS), 84 + Math.cos(a) * r * 100, 51 + Math.sin(a) * r * 107, rnd(1.5, 3), 1600, Math.cos(a) * 3.3, Math.sin(a) * 3.3, 45)
    }],
    // A leaf drifting down on the left, beside his head.
    [1800, () => fall('leaf', pick(['#6f9443', '#a4552c', '#c27a3a']), rnd(4, 28), rnd(0, 3), 3, rnd(8000, 10000), rnd(2, 9))],
  ],
}
