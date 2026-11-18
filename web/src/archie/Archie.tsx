import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react'
import { he } from '../i18n/he'
import { cx } from '../ui/styles'
import './archie.css'
import { EMITTERS, type Particle } from './emitters'
import { MOOD_ART, type ArchieMood } from './moods'
import { MotionLayer } from './motionLayer'

export type { ArchieMood } from './moods'
export type ArchieSize = 'avatar' | 'card' | 'scene'

// Archie, the cut-paper zen character (S31, decision 23; docs/superpowers/specs/
// 2026-11-18-archie-look-and-gamification.md, section 3). One component for the six moods and the
// three sizes:
// - avatar: a circle cut around the face, no motion. 40px unless className sizes it.
// - card: the illustration framed on the dawn sky, with the motion layer of its mood.
// - scene: the same at the full width of its place, without the frame.
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

  // A new mood starts with an empty sky.
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
  // The face is zoomed in the circle (about 2.6 times a 40px avatar), so 104px: a 3x phone takes
  // the 450w file.
  avatar: '104px',
  card: '(min-width: 768px) 420px, 100vw',
  scene: '100vw',
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
      alt={decorative ? '' : he.archie.alt[mood]}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      style={style}
      className={className}
    />
  )
}

// The avatar's image: wider than the circle by the mood's zoom, and moved so the face is in the
// middle. Percent of the circle (a square), so it follows any size the className gives.
function avatarStyle(mood: ArchieMood): CSSProperties {
  const { face, width, height } = MOOD_ART[mood]
  const imageWidth = face.zoom * 100
  const imageHeight = imageWidth * (height / width)
  return {
    position: 'absolute',
    maxWidth: 'none',
    width: `${imageWidth.toFixed(2)}%`,
    height: 'auto',
    left: `${(50 - face.x * imageWidth).toFixed(2)}%`,
    top: `${(50 - face.y * imageHeight).toFixed(2)}%`,
  }
}

function Frame({ mood, size, decorative, className }: { mood: ArchieMood; size: 'card' | 'scene'; decorative: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const playing = useInView(ref, !reduced)
  const [particles, removeParticle] = useParticles(mood, playing)
  return (
    <div
      ref={ref}
      data-mood={mood}
      data-size={size}
      className={cx(
        'archie-frame relative aspect-[900/655] w-full overflow-hidden bg-sky bg-linear-to-b from-sky-from to-sky-to',
        size === 'card' && 'rounded-card shadow-raised',
        className,
      )}
    >
      <Illustration
        mood={mood}
        size={size}
        decorative={decorative}
        className={cx('absolute inset-0 size-full object-cover', playing && 'archie-breathe')}
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
      <span
        data-mood={mood}
        data-size="avatar"
        className={cx('archie-avatar relative inline-block shrink-0 overflow-hidden rounded-full bg-sky', className)}
      >
        <Illustration mood={mood} size="avatar" decorative={decorative} eager={eager} style={avatarStyle(mood)} />
      </span>
    )
  }
  return <Frame mood={mood} size={size} decorative={decorative} className={className} />
}
