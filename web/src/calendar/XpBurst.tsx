import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { en } from '../i18n/en'
import { XpSparkIcon } from '../ui/icons'
import { onCompleted, type CompletedEvent } from './xpEvents'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const FLY_MS = 600
const GLOW_MS = 400

interface Flight {
  id: number
  xp: number
  x: number
  y: number
  dx: number
  dy: number
}

// The first of the elements that is shown (a hidden one has no offsetParent).
function firstShown(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (el.offsetParent !== null) return el
  }
  return null
}

function centre(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function quiet(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
}

let nextId = 0

// The moment a block is marked done (S32 decision 12): a gold chip of the XP rises from the block's
// box to the ring of the level, which glows once as it lands. It is for the eye only (aria-hidden):
// the toast already says the XP in words. With reduced motion, without Element.animate, or when the
// box or the ring is not on screen, nothing flies at all.
export function XpBurst() {
  const [flights, setFlights] = useState<Flight[]>([])

  useEffect(() => {
    return onCompleted((event: CompletedEvent) => {
      if (quiet() || typeof Element.prototype.animate !== 'function') return
      const box = firstShown(`[data-check="${CSS.escape(event.blockId)}"]`)
      const ring = firstShown('[data-part="level"]')
      if (box === null || ring === null) return
      const from = centre(box)
      const to = centre(ring)
      nextId += 1
      setFlights((current) => [...current, { id: nextId, xp: event.xp, x: from.x, y: from.y, dx: to.x - from.x, dy: to.y - from.y }])
    })
  }, [])

  if (flights.length === 0) return null
  return createPortal(
    flights.map((flight) => (
      <Chip
        key={flight.id}
        flight={flight}
        onDone={() => {
          setFlights((current) => current.filter((f) => f.id !== flight.id))
        }}
      />
    )),
    document.body,
  )
}

function Chip({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const [el, setEl] = useState<HTMLSpanElement | null>(null)
  // The flight starts once, even when StrictMode runs the effect twice; `alive` says whether the
  // chip is still on screen when it lands (an unmount takes the element away by itself).
  const started = useRef(false)
  const alive = useRef(true)
  const done = useRef(onDone)

  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    alive.current = true
    if (el === null || started.current) {
      return () => {
        alive.current = false
      }
    }
    started.current = true
    const fly = el.animate(
      [
        { transform: 'translate(-50%, -50%)' },
        { transform: `translate(calc(-50% + ${String(flight.dx)}px), calc(-50% + ${String(flight.dy)}px)) scale(0.6)` },
      ],
      { duration: FLY_MS, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'forwards' },
    )
    const land = () => {
      if (!alive.current) return
      firstShown('[data-part="level"]')?.animate(
        [
          { boxShadow: '0 0 0 0 var(--color-gold-soft)' },
          { boxShadow: '0 0 0 4px var(--color-gold-soft)' },
          { boxShadow: '0 0 0 0 var(--color-gold-soft)' },
        ],
        { duration: GLOW_MS },
      )
      done.current()
    }
    // A cancelled flight takes the chip away all the same, with no glow.
    fly.finished.then(land, () => {
      if (alive.current) done.current()
    })
    return () => {
      alive.current = false
    }
  }, [el, flight])

  return (
    <span
      ref={setEl}
      aria-hidden="true"
      style={{ left: flight.x, top: flight.y, transform: 'translate(-50%, -50%)' }}
      className="pointer-events-none fixed z-50 inline-flex items-center gap-1 rounded-badge bg-gold-soft px-2 py-0.5 text-small font-semibold text-gold-ink tabular-nums"
    >
      <XpSparkIcon size={14} />
      {en.calendar.page.xp(flight.xp)}
    </span>
  )
}
