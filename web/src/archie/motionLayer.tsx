import type { CSSProperties, ReactNode } from 'react'
import type { Particle, Shape } from './emitters'
import type { ArchieMood } from './moods'

// The motion layer over an illustration: the still pieces of each mood (they move in place, in a
// loop) and the particles the emitters send. Everything here is decoration in cut paper, drawn
// beside the character and never on it ("אין לצייר את הדמות מחדש"). The look of every piece is
// the one of docs/design/prototype/archie-moods.html; the keyframes are in archie.css.

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
          <path d="M5 0C6 5 7 8 7 10A2 3 0 0 1 3 10C3 8 4 5 5 0Z" fill="#a9cfe9" />
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
          <path d="M4 6H12M4 9H12M4 12H10" stroke="#b49a73" strokeWidth="1" />
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

// intentions: four green sprouts grow out of the pot rim and sway, one after the other.
const SPROUTS = [
  [60.5, 73, -35, 26],
  [63, 70, -12, 30],
  [72, 70, 18, 30],
  [75, 73, 40, 24],
] as const

// flow: willow leaves hanging from the branch. The prototype picks their green and their pace at
// random; here each leaf has its own fixed one, so a render is the same every time.
const WILLOWS = [
  [58, 4],
  [64, 9],
  [70, 6],
  [77, 12],
  [84, 8],
  [90, 14],
  [52, 10],
  [22, 6],
  [30, 10],
] as const
const WILLOW_GREENS = ['#6f9443', '#87a858', '#5c7f37'] as const

function Statics({ mood }: { mood: ArchieMood }): ReactNode {
  switch (mood) {
    case 'intentions':
      return SPROUTS.map(([x, y, r, size], i) => (
        <span
          key={i}
          className="archie-sprout"
          style={at(x, y, `${String(size)}px`, { '--r': `${String(r)}deg`, animationDelay: `${String(i * 350)}ms` })}
        >
          <Leaf color={i % 2 ? '#6f9a45' : '#4f7a3a'} />
        </span>
      ))
    case 'eureka':
      return (
        <>
          {/* Layered gold rings around his head, turning slowly. */}
          <svg viewBox="0 0 200 200" className="archie-paper archie-halo">
            <circle cx="100" cy="100" r="92" fill="none" stroke="#e7c36b" strokeWidth="2" strokeDasharray="3 9" opacity=".8" />
            <circle cx="100" cy="100" r="78" fill="none" stroke="#d4a24c" strokeWidth="3" strokeDasharray="40 14 8 14" opacity=".7" />
            <circle cx="100" cy="100" r="99" fill="none" stroke="#f3dc9a" strokeWidth="1" strokeDasharray="1 6" opacity=".7" />
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
      return WILLOWS.map(([x, y], i) => (
        <span
          key={i}
          className="archie-willow"
          style={at(x, y, '2.6cqw', {
            animationDuration: `${String(2800 + ((i * 370) % 1000))}ms`,
            animationDelay: `${String(-i * 400)}ms`,
          })}
        >
          <svg viewBox="0 0 14 30" className="archie-paper">
            <path d="M7 0C13 8 12 22 7 30C2 22 1 8 7 0Z" fill={WILLOW_GREENS[i % 3]} />
            <path d="M7 2V28" stroke="rgba(0,0,0,.2)" strokeWidth="1" fill="none" />
          </svg>
        </span>
      ))
    case 'rest':
      return null
    case 'joy':
      // The glow of the gold stone in his hand.
      return <span className="archie-glow archie-glow--hand" />
  }
}

function ParticleView({ particle, onDone }: { particle: Particle; onDone: (id: number) => void }) {
  const { shape, color, x, y, size, motion, duration, vars } = particle
  const style = at(x, y, `${String(size)}cqw`, { ...vars, animationDuration: `${String(Math.round(duration))}ms` })
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
      className="archie-fx pointer-events-none absolute inset-0 overflow-hidden"
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
