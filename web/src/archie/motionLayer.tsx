import type { CSSProperties, ReactNode } from 'react'
import { units, type Particle, type Shape } from './emitters'
import type { ArchieMood } from './moods'

// The motion layer over an illustration: the still pieces of each mood (they move in place, in a
// loop) and the particles the emitters send. Everything here is decoration in cut paper, drawn
// beside the character and never redrawing him. The look of every piece is the one of
// docs/design/prototype/archie-moods.html; the keyframes are in archie.css.
//
// S39: the illustrations are transparent cut-outs with no sky, so every piece is placed on the
// new cut of its mood (a percent of that frame), sized in units of the art (emitters.ts), and
// coloured to read on the light surfaces of the app. Nothing is clipped: a piece that leaves
// fades out inside the frame.

type Vars = CSSProperties & Record<`--${string}`, string>

// The paper shapes of the prototype (its `shapes`), as React SVG. archie-paper gives each the
// small drop shadow that makes it read as one more cut.
function ShapeSvg({ shape, color }: { shape: Exclude<Shape, 'ripple'>; color: string }) {
  switch (shape) {
    case 'leaf':
      return (
        <svg viewBox="0 0 20 26" className="archie-paper">
          <path d="M10 1C18 7 18 17 10 25C2 17 2 7 10 1Z" fill={color} />
          <path d="M10 4V23" stroke="rgba(0,0,0,.25)" strokeWidth="1.2" fill="none" />
        </svg>
      )
    case 'maple':
      return (
        <svg viewBox="0 0 24 24" className="archie-paper">
          <path d="M12 1l2.5 5 4-2-1 5 5 1-4 4 2 4-5-1-1 6h-1l-1-6-5 1 2-4-4-4 5-1-1-5 4 2z" fill={color} />
        </svg>
      )
    case 'petal':
      return (
        <svg viewBox="0 0 16 14" className="archie-paper">
          <path d="M8 1C14 1 16 8 8 13C0 8 2 1 8 1Z" fill={color} />
          <path d="M8 3V8" stroke="rgba(255,255,255,.5)" strokeWidth="1" fill="none" />
        </svg>
      )
    case 'drop':
      return (
        <svg viewBox="0 0 10 14" className="archie-paper">
          <path d="M5 0C8 5 10 8 10 10A5 4 0 0 1 0 10C0 8 2 5 5 0Z" fill={color} />
          <path d="M5 0C6 5 7 8 7 10A2 3 0 0 1 3 10C3 8 4 5 5 0Z" fill="rgba(255,255,255,.45)" />
        </svg>
      )
    case 'spark':
      return (
        <svg viewBox="0 0 20 20" className="archie-paper">
          <path d="M10 0L12 8L20 10L12 12L10 20L8 12L0 10L8 8Z" fill={color} />
        </svg>
      )
    case 'page':
      return (
        <svg viewBox="0 0 16 20" className="archie-paper">
          <rect x="1" y="1" width="14" height="18" rx="1" fill={color} />
          <path d="M4 6H12M4 9H12M4 12H10" stroke="#a3855a" strokeWidth="1" />
        </svg>
      )
    case 'smoke':
      return (
        <svg viewBox="0 0 40 90" className="archie-paper">
          <path d="M20 88C6 70 34 58 20 42S8 18 22 2" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" />
        </svg>
      )
    case 'steam':
      return (
        <svg viewBox="0 0 30 80" className="archie-paper">
          <path d="M15 78C4 60 26 50 15 34S6 12 16 2" fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round" />
        </svg>
      )
  }
}

function Leaf({ color }: { color: string }) {
  return <ShapeSvg shape="leaf" color={color} />
}

// A piece placed by percent of the frame, like the prototype's place().
function at(x: number, y: number, width: string, extra?: Vars): Vars {
  return { left: `${String(x)}%`, top: `${String(y)}%`, width, ...extra }
}

// intentions: four green sprouts grow out of the rim of the pot, two on each side of the open
// book, and sway, one after the other. [left, top, rotation, width in units].
const SPROUTS = [
  [65.2, 75.2, -38, 4],
  [67.2, 73.2, -14, 4.6],
  [87, 73.2, 16, 4.6],
  [89.6, 75.2, 40, 3.8],
] as const

function Statics({ mood }: { mood: ArchieMood }): ReactNode {
  switch (mood) {
    case 'intentions':
      return SPROUTS.map(([x, y, r, size], i) => (
        <span
          key={i}
          className="archie-sprout"
          style={at(x, y, units(size), { '--r': `${String(r)}deg`, animationDelay: `${String(i * 350)}ms` })}
        >
          <Leaf color={i % 2 ? '#6f9a45' : '#4f7a3a'} />
        </span>
      ))
    case 'eureka':
      return (
        <>
          {/* Layered gold rings behind his head, turning slowly. Deeper golds than on the old sky:
              they have to read on a light surface. */}
          <svg viewBox="0 0 200 200" className="archie-halo">
            <circle cx="100" cy="100" r="90" fill="none" stroke="#d4a24c" strokeWidth="2.5" strokeDasharray="3 9" opacity=".9" />
            <circle cx="100" cy="100" r="78" fill="none" stroke="#c48f35" strokeWidth="3.5" strokeDasharray="40 14 8 14" opacity=".8" />
            <circle cx="100" cy="100" r="98" fill="none" stroke="#dcb25c" strokeWidth="1.5" strokeDasharray="1 6" opacity=".9" />
          </svg>
          {/* The glow of the stone in his lap. */}
          <span className="archie-glow archie-glow--stone" />
        </>
      )
    case 'wisdom':
      // An ink line being written on the scroll, near the brush tip.
      return (
        <svg viewBox="0 0 100 30" className="archie-ink">
          <path
            d="M4 20C18 4 26 26 40 12S62 6 70 18S88 22 96 10"
            fill="none"
            stroke="#5a3d22"
            strokeWidth="2.4"
            strokeLinecap="round"
            pathLength={100}
          />
        </svg>
      )
    case 'flow':
      // The willow leaves hung from the branch above him, and the branch was painted on the
      // background that is gone: leaves swaying from nothing looked like a mistake, so flow has
      // no still pieces now. Its ripples and its falling leaf stay (emitters.ts).
      return null
    case 'rest':
      return null
    case 'joy':
      // The glow of the gold stone in his hand.
      return <span className="archie-glow archie-glow--hand" />
  }
}

function ParticleView({ particle, onDone }: { particle: Particle; onDone: (id: number) => void }) {
  const { shape, color, x, y, size, motion, duration, vars } = particle
  const style = at(x, y, units(size), { ...vars, animationDuration: `${String(Math.round(duration))}ms` })
  return (
    <span
      className={`archie-p archie-${motion}${shape === 'ripple' ? ' archie-ripple-shape' : ''}`}
      style={shape === 'ripple' ? { ...style, borderColor: color } : style}
      onAnimationEnd={() => {
        onDone(particle.id)
      }}
    >
      {shape === 'ripple' ? null : <ShapeSvg shape={shape} color={color} />}
    </span>
  )
}

export function MotionLayer({
  mood,
  playing,
  particles,
  onParticleDone,
}: {
  mood: ArchieMood
  playing: boolean
  particles: readonly Particle[]
  onParticleDone: (id: number) => void
}) {
  return (
    <div
      aria-hidden="true"
      data-part="motion"
      data-mood={mood}
      data-playing={playing ? '' : undefined}
      className="archie-fx pointer-events-none absolute inset-0"
    >
      <Statics mood={mood} />
      <div data-part="particles">
        {particles.map((particle) => (
          <ParticleView key={particle.id} particle={particle} onDone={onParticleDone} />
        ))}
      </div>
    </div>
  )
}
