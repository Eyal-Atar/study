import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react'
import { en } from '../i18n/en'
import { cx } from '../ui/styles'
import './archie.css'
import { EMITTERS, type Particle } from './emitters'
import { MOOD_ART, type ArchieMood } from './moods'
import { MotionLayer } from './motionLayer'

export type { ArchieMood } from './moods'
export type ArchieSize = 'avatar' | 'card' | 'scene'

// Archie, the cut-paper zen character (S31, decision 23; S39: no sky, no frame, no circle). This
// file is the one place that knows the character's assets: a later change of the art (final
// PNGs, Lottie, Rive) happens here and in moods.ts, and no screen notices.
//
// One component for the six moods and the three sizes. In all of them the cut-out is transparent
// and sits on whatever surface is behind it; nothing here paints a background or clips a shape.
// - avatar: the head and shoulders, fading out below, no motion. 40px unless className sizes it.
// - card: the whole cut-out at the width of its place, with the motion layer of its mood.
// - scene: the same, centred, and never wider than the pixels of the art.
// The illustration is never redrawn: everything that moves is a layer over it (motionLayer.tsx),
// it plays only while on screen, and never for someone who asked the system for less motion.

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => {
    query.removeEventListener('change', onChange)
  }
}

// Read live: a change in the system settings stops (or allows) the motion at once.
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches,
    () => true,
  )
}

// Whether the element is on screen, or 80px from it (the prototype's rootMargin), so the motion
// is already running when it scrolls in. Without IntersectionObserver it never counts as on screen.
function useInView(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting)
      },
      { rootMargin: '80px' },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      setInView(false)
    }
  }, [ref, enabled])
  return inView && enabled
}

// More than this many particles in the air means their animationend did not come (a hidden tab
// that held the animations): the oldest go first.
const MAX_PARTICLES = 60

// The emitters of the mood while playing: each makes one particle at once, then one every
// interval, and skips a beat while the page is hidden. Stopping ends the emitters; the particles
// already in the air finish their way, as in the prototype.
function useParticles(mood: ArchieMood, playing: boolean) {
  const [particles, setParticles] = useState<Particle[]>([])
  const nextId = useRef(0)

  useEffect(() => {
    if (!playing) return
    const emit = (make: () => Omit<Particle, 'id'>) => {
      const particle = { ...make(), id: nextId.current++ }
      setParticles((current) => [...current.slice(-(MAX_PARTICLES - 1)), particle])
    }
    const timers = EMITTERS[mood].map(([interval, make]) => {
      emit(make)
      return window.setInterval(() => {
        if (!document.hidden) emit(make)
      }, interval)
    })
    return () => {
      timers.forEach((timer) => {
        window.clearInterval(timer)
      })
    }
  }, [mood, playing])

  // A new mood starts with nothing in the air.
  const [shownMood, setShownMood] = useState(mood)
  if (shownMood !== mood) {
    setShownMood(mood)
    setParticles([])
  }

  const remove = useCallback((id: number) => {
    setParticles((current) => current.filter((particle) => particle.id !== id))
  }, [])

  return [particles, remove] as const
}

// The width the illustration takes on screen, for the browser's choice between the two files.
const SIZES: Record<ArchieSize, string> = {
  // The image is wider than the avatar's box by 1 / bust.size, about 2.5 to 4.7 times: 128px is
  // near what a 40px avatar draws, so a 3x phone still takes the 450w file.
  avatar: '128px',
  card: '(min-width: 768px) 420px, 100vw',
  scene: '(min-width: 900px) 900px, 100vw',
}

function Illustration({ mood, size, decorative, eager = false, style, className }: { mood: ArchieMood; size: ArchieSize; decorative: boolean; eager?: boolean; style?: CSSProperties; className?: string }) {
  const art = MOOD_ART[mood]
  return (
    <img
      src={art.large}
      srcSet={`${art.small} 450w, ${art.large} ${String(art.width)}w`}
      sizes={SIZES[size]}
      width={art.width}
      height={art.height}
      alt={decorative ? '' : en.archie.alt[mood]}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      style={style}
      className={className}
    />
  )
}

// The avatar's image: scaled so the bust square of the mood is as wide as the box, and moved so
// that square is the box. Percent of the box (a square), so it follows any size the className
// gives.
function avatarStyle(mood: ArchieMood): CSSProperties {
  const { bust, width, height } = MOOD_ART[mood]
  const imageWidth = 100 / bust.size
  const imageHeight = imageWidth * (height / width)
  return {
    position: 'absolute',
    maxWidth: 'none',
    width: `${imageWidth.toFixed(2)}%`,
    height: 'auto',
    left: `${(-bust.x * imageWidth).toFixed(2)}%`,
    top: `${(-bust.y * imageHeight).toFixed(2)}%`,
  }
}

// The motion layer was drawn for a 900px wide illustration, and the cut-outs keep that scale but
// not that width. So its sizes and paths are in units of the art, not of the frame: one unit
// (--archie-u) is 9 pixels of the art, which is 1% of the frame's width only when the cut-out is
// 900px wide. --archie-fall is how far a falling leaf goes: four fifths of the frame's height, so
// it has faded out before it reaches the lower edge.
type FrameStyle = CSSProperties & Record<`--${string}`, string>

function frameStyle(mood: ArchieMood, size: 'card' | 'scene'): FrameStyle {
  const { width, height } = MOOD_ART[mood]
  return {
    '--archie-u': `${(900 / width).toFixed(4)}cqw`,
    '--archie-fall': `${((height / width) * 80).toFixed(2)}cqw`,
    // The art is as wide as its file: wider would blur it.
    ...(size === 'scene' ? { maxWidth: `${String(width)}px` } : {}),
  }
}

function Frame({ mood, size, decorative, eager, className }: { mood: ArchieMood; size: 'card' | 'scene'; decorative: boolean; eager: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const playing = useInView(ref, !reduced)
  const [particles, removeParticle] = useParticles(mood, playing)
  return (
    <div
      ref={ref}
      data-mood={mood}
      data-size={size}
      style={frameStyle(mood, size)}
      className={cx('archie-frame relative w-full', size === 'scene' && 'mx-auto', className)}
    >
      {/* In the flow, at the proportions of its own file: the frame is exactly as tall as he is. */}
      <Illustration
        mood={mood}
        size={size}
        decorative={decorative}
        eager={eager}
        className={cx('block h-auto w-full', playing && 'archie-breathe')}
      />
      <MotionLayer mood={mood} playing={playing} particles={particles} onParticleDone={removeParticle} />
    </div>
  )
}

export function Archie({
  mood,
  size = 'card',
  decorative = false,
  eager = false,
  className,
}: {
  mood: ArchieMood
  size?: ArchieSize
  decorative?: boolean
  // For an Archie that is always on the first screen (the logo): load at once, not lazily.
  eager?: boolean
  className?: string
}) {
  if (size === 'avatar') {
    return (
      // overflow-hidden cuts the image to the bust square, and no edge of that square shows: its
      // top and sides are in the transparent part of the cut-out, and archie.css fades the rest.
      <span data-mood={mood} data-size="avatar" className={cx('archie-avatar relative inline-block shrink-0 overflow-hidden', className)}>
        <Illustration mood={mood} size="avatar" decorative={decorative} eager={eager} style={avatarStyle(mood)} />
      </span>
    )
  }
  return <Frame mood={mood} size={size} decorative={decorative} eager={eager} className={className} />
}
