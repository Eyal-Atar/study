import type { ArchieMood } from './moods'

// The particles of the motion layer, ported from the emitters of the prototype
// (docs/design/prototype/archie-moods.html, the FX object): which paper shape, where it starts
// (a percent of the frame), how big (cqw: a percent of the frame's width, the prototype's
// w * factor; or px where the prototype used fixed pixels), which keyframes of archie.css move
// it, for how long, and the random numbers of its path as CSS variables.

export type Shape = 'leaf' | 'maple' | 'petal' | 'drop' | 'spark' | 'page' | 'smoke' | 'steam' | 'ripple'
export type Motion = 'fall' | 'drip' | 'rise' | 'twinkle' | 'curl' | 'steam' | 'ripple'

export interface Particle {
  id: number
  shape: Shape
  color: string
  x: number
  y: number
  // The width, in cqw.
  size: number
  motion: Motion
  duration: number
  vars: Record<string, string>
}

export type Spawn = Omit<Particle, 'id'>

// [interval in ms, a function that makes one particle]. The layer calls each one at once when it
// starts, and then every interval, like the prototype's setInterval.
export type Emitter = readonly [number, () => Spawn]

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T

// One fall: a paper shape drifting down the whole frame with a sway (fall() of the prototype).
// drift is px; the rotation starts at a random angle and turns 200 degrees on the way down.
function fall(shape: Shape, color: string, x: number, y: number, size: number, duration: number, drift: number): Spawn {
  return {
    shape,
    color,
    x,
    y,
    size,
    motion: 'fall',
    duration,
    vars: { '--r': `${rnd(-60, 60).toFixed(1)}deg`, '--dx': `${drift.toFixed(1)}px` },
  }
}

// A shape that fades in and floats off by (dx, dy) while it turns by r ("rise" in archie.css).
function rise(shape: Shape, color: string, x: number, y: number, size: number, duration: number, dx: string, dy: string, r: number): Spawn {
  return { shape, color, x, y, size, motion: 'rise', duration, vars: { '--dx': dx, '--dy': dy, '--r': `${r.toFixed(1)}deg` } }
}

// A star that pops, turns 45 degrees and shrinks away by (dx, dy) ("twinkle" in archie.css).
function twinkle(color: string, x: number, y: number, size: number, duration: number, dx: string, dy: string, r: number): Spawn {
  return { shape: 'spark', color, x, y, size, motion: 'twinkle', duration, vars: { '--dx': dx, '--dy': dy, '--r': `${r.toFixed(0)}deg` } }
}

// A curl of smoke or steam that rises and fades ("curl" and "steam" in archie.css: the smoke is
// at its fullest a quarter of the way, the steam at a third).
function curl(shape: 'smoke' | 'steam', color: string, x: number, y: number, size: number, duration: number, opts: { dx: number; dy: number; r: number; from: string; peak: number; scaleFrom: number; scaleTo: number }): Spawn {
  return {
    shape,
    color,
    x,
    y,
    size,
    motion: shape === 'smoke' ? 'curl' : 'steam',
    duration,
    vars: {
      '--dx': `${opts.dx.toFixed(1)}px`,
      '--dy': `${String(opts.dy)}cqw`,
      '--r': `${opts.r.toFixed(1)}deg`,
      '--from': opts.from,
      '--peak': String(opts.peak),
      '--sy0': String(opts.scaleFrom),
      '--sy1': String(opts.scaleTo),
    },
  }
}

const AUTUMN = ['#a4552c', '#c27a3a', '#7d4a2a', '#8a8a3a'] as const
const GOLD_SPARKS = ['#f3dc9a', '#e7c36b', '#fff3c4'] as const
const SMOKE = ['#9aa0a8', '#b6bac0', '#848a92'] as const

export const EMITTERS: Record<ArchieMood, readonly Emitter[]> = {
  intentions: [
    // Water drops from the spout into the pot.
    [380, () => ({ shape: 'drop', color: '#7fb3d9', x: rnd(57, 59), y: rnd(63, 65), size: 2.2, motion: 'drip', duration: 900, vars: {} })],
    // Autumn leaves falling across the sky.
    [1500, () => fall(pick(['maple', 'leaf'] as const), pick(AUTUMN), rnd(2, 95), -6, rnd(3, 5), rnd(7000, 10000), rnd(-60, 40))],
    // A page lifting off the book.
    [2600, () => rise('page', '#efe2c4', rnd(66, 72), rnd(55, 60), 3, 4200, `${rnd(-20, 30).toFixed(1)}px`, '-22cqw', rnd(-40, 40))],
  ],
  eureka: [
    // Sparkles around the halo (an ellipse: the frame is wider than tall).
    [260, () => {
      const a = rnd(0, Math.PI * 2)
      const r = rnd(0.24, 0.42)
      return twinkle(pick(GOLD_SPARKS), 50 + Math.cos(a) * r * 100, 31 + Math.sin(a) * r * 136, rnd(1.5, 3.5), rnd(1400, 2400), '0px', '-4cqw', 90)
    }],
    // Gold paper flecks rising from the stone.
    [700, () => rise('leaf', '#e2b252', rnd(44, 52), 78, 1.2, rnd(3000, 4200), `${rnd(-30, 30).toFixed(1)}px`, '-30cqw', rnd(-200, 200))],
  ],
  wisdom: [
    // Curls of grey paper smoke rising from the incense burner.
    [1100, () => curl('smoke', pick(SMOKE), rnd(82, 85), 40, 7, 5200, { dx: rnd(-14, 10), dy: -16, r: rnd(-12, 12), from: '30px', peak: 0.85, scaleFrom: 0.6, scaleTo: 1.2 })],
  ],
  flow: [
    // A new sand ripple drawn around the rake.
    [1600, () => ({ shape: 'ripple', color: 'rgba(140,105,65,.55)', x: 30, y: 83, size: 10, motion: 'ripple', duration: 4200, vars: {} })],
    // A leaf falling from the tree.
    [3400, () => fall('leaf', pick(['#a4552c', '#c27a3a', '#6f9443']), rnd(40, 95), 2, 2.8, rnd(8000, 11000), rnd(-80, -20))],
  ],
  rest: [
    // Steam from Archie's cup, and from the cup on the mat.
    [900, () => curl('steam', 'rgba(255,255,255,.95)', rnd(48, 50), 18, 4, 3600, { dx: rnd(-8, 8), dy: -8, r: 0, from: '10px', peak: 0.8, scaleFrom: 0.5, scaleTo: 1.1 })],
    [1500, () => curl('steam', 'rgba(255,255,255,.95)', rnd(20, 21.5), 70, 3, 3600, { dx: rnd(-8, 8), dy: -8, r: 0, from: '10px', peak: 0.8, scaleFrom: 0.5, scaleTo: 1.1 })],
    // Blossom petals (and a leaf now and then), mostly from the cherry tree on the left.
    [900, () => {
      const left = Math.random() < 0.6
      return fall(
        pick(['petal', 'petal', 'leaf'] as const),
        pick(['#e7a7b4', '#f1c3cb', '#d98a9a', '#b0683c']),
        left ? rnd(2, 30) : rnd(70, 96),
        left ? rnd(4, 18) : rnd(2, 12),
        rnd(2, 3.2),
        rnd(7000, 10000),
        rnd(10, 70),
      )
    }],
  ],
  joy: [
    // Sparkles bursting out of the gold stone in his hand.
    [420, () => {
      const a = rnd(0, Math.PI * 2)
      const r = rnd(0.06, 0.16)
      return twinkle(pick(['#f3dc9a', '#fff3c4']), 75 + Math.cos(a) * r * 100, 50 + Math.sin(a) * r * 136, rnd(1.5, 3), 1600, `${(Math.cos(a) * 30).toFixed(1)}px`, `${(Math.sin(a) * 30).toFixed(1)}px`, 45)
    }],
    // A leaf drifting down on the left.
    [1800, () => fall('leaf', pick(['#6f9443', '#a4552c', '#c27a3a']), rnd(2, 40), -5, 3, rnd(8000, 10000), rnd(20, 80))],
  ],
}
