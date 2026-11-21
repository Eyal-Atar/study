import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { en } from '../i18n/en'
import { cx } from '../ui/styles'

// The small week of the onboarding (S34 decision 6): whole hours from firstHour up to lastHour
// (exclusive; above 24 adds the hours after midnight), Sunday first. The student marks busy hours by
// dragging or by tapping, and the keyboard reaches every cell. A cell is `${column}-${clock hour}`,
// the key of paintedRanges and cellsOf in model.ts. A saved cell is shown and never changes here.
//
// A press decides the gesture by its first cell: on a free cell it marks, on a marked one it clears.
// The moves are read with document.elementFromPoint, because a touch pointer stays captured by the
// element it started on. pointerup and pointercancel on the document end it wherever they happen,
// so a drag that leaves the grid stops marking. Only the grid has touch-action: none.

export interface WeekPainterProps {
  firstHour: number
  lastHour: number
  painted: ReadonlySet<string>
  saved: ReadonlySet<string>
  onChange: (next: Set<string>) => void
}

interface Drag {
  pointerId: number
  mark: boolean
  cells: Set<string>
  saved: ReadonlySet<string>
  onChange: (next: Set<string>) => void
}

// The click that follows a press is the same gesture; a click with no press before it (the
// keyboard, a screen reader) toggles. A touch's click may come a moment after its pointerup.
const CLICK_AFTER_PRESS_MS = 1000

const pad = (n: number) => String(n).padStart(2, '0')

// The hatch of busy time (the prototype's marked cell): busy-line stripes on busy-soft.
const HATCH = 'bg-[repeating-linear-gradient(135deg,var(--color-busy-line)_0_4px,var(--color-busy-soft)_4px_8px)]'

export function WeekPainter({ firstHour, lastHour, painted, saved, onChange }: WeekPainterProps) {
  const t = en.commitments
  const rows = Array.from({ length: Math.max(0, lastHour - firstHour) }, (_, i) => firstHour + i)
  const [active, setActive] = useState({ column: 0, row: 0 })
  const gridRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const detach = useRef<(() => void) | null>(null)
  // While a press is held this is Infinity; after it ends, the time until which its click is ignored.
  const clickIgnoredUntil = useRef(0)

  useEffect(
    () => () => {
      detach.current?.()
    },
    [],
  )

  const cellAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell]')
    if (!el || !gridRef.current?.contains(el)) return null
    return el.dataset.cell ?? null
  }

  const paint = (d: Drag, key: string) => {
    if (d.saved.has(key) || d.cells.has(key) === d.mark) return
    if (d.mark) d.cells.add(key)
    else d.cells.delete(key)
    d.onChange(new Set(d.cells))
  }

  const stop = () => {
    drag.current = null
    clickIgnoredUntil.current = performance.now() + CLICK_AFTER_PRESS_MS
    detach.current?.()
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-cell]')
    const key = target?.dataset.cell
    if (!target || !key) return
    detach.current?.()
    setActive({ column: Number(target.dataset.column), row: Number(target.dataset.row) })
    // A press on a saved cell is no gesture: it would decide nothing, and its click changes nothing.
    if (saved.has(key)) return
    clickIgnoredUntil.current = Number.POSITIVE_INFINITY
    const d: Drag = { pointerId: event.pointerId, mark: !painted.has(key), cells: new Set(painted), saved, onChange }
    drag.current = d
    paint(d, key)

    const onMove = (e: globalThis.PointerEvent) => {
      const current = drag.current
      if (!current || e.pointerId !== current.pointerId) return
      // A mouse released outside the window sends no pointerup; its next move has no button held.
      if (e.pointerType === 'mouse' && e.buttons === 0) {
        stop()
        return
      }
      const over = cellAt(e.clientX, e.clientY)
      if (over) paint(current, over)
    }
    const onEnd = (e: globalThis.PointerEvent) => {
      if (drag.current && e.pointerId !== drag.current.pointerId) return
      stop()
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onEnd)
    document.addEventListener('pointercancel', onEnd)
    detach.current = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onEnd)
      document.removeEventListener('pointercancel', onEnd)
      detach.current = null
    }
  }

  const onClick = (key: string) => {
    if (performance.now() < clickIgnoredUntil.current) {
      clickIgnoredUntil.current = 0
      return
    }
    if (saved.has(key)) return
    const next = new Set(painted)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  const focusCell = (column: number, row: number) => {
    setActive({ column, row })
    gridRef.current?.querySelector<HTMLElement>(`[data-column="${String(column)}"][data-row="${String(row)}"]`)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A key press is never the click of a pointer press.
    clickIgnoredUntil.current = 0
    const { column, row } = active
    const last = rows.length - 1
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [Math.max(0, column - 1), row],
      ArrowRight: [Math.min(6, column + 1), row],
      ArrowUp: [column, Math.max(0, row - 1)],
      ArrowDown: [column, Math.min(last, row + 1)],
      Home: [0, row],
      End: [6, row],
    }
    const to = moves[event.key]
    if (!to) return
    event.preventDefault()
    focusCell(to[0], to[1])
  }

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={t.painter.label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="touch-none overflow-hidden rounded-control border border-line bg-field select-none"
    >
      <div role="row" className="grid grid-cols-[34px_repeat(7,minmax(0,1fr))] bg-surface-muted">
        <div role="columnheader" />
        {t.weekdayShort.map((day) => (
          <div key={day} role="columnheader" className="py-1 text-center text-caption font-semibold text-ink">
            {day}
          </div>
        ))}
      </div>
      {rows.map((hour, row) => {
        const clock = hour % 24
        const time = `${pad(clock)}:00`
        return (
          <div key={hour} role="row" className="grid grid-cols-[34px_repeat(7,minmax(0,1fr))] border-t border-line">
            <div role="rowheader" className="text-center text-caption leading-4 text-ink-muted tabular-nums">
              {pad(clock)}
            </div>
            {t.weekdayLong.map((_, column) => {
              const key = `${String(column)}-${String(clock)}`
              const isSaved = saved.has(key)
              const isPainted = !isSaved && painted.has(key)
              // The hours after midnight belong to this column but are the next day by the clock.
              const day = t.weekdayLong[(column + (hour >= 24 ? 1 : 0)) % 7] ?? ''
              const isActive = active.column === column && active.row === row
              return (
                <div key={column} role="gridcell" className="border-s border-line">
                  <button
                    type="button"
                    data-cell={key}
                    data-column={column}
                    data-row={row}
                    tabIndex={isActive ? 0 : -1}
                    aria-pressed={isSaved || isPainted}
                    aria-disabled={isSaved || undefined}
                    aria-label={isSaved ? t.painter.cellSaved(day, time) : t.painter.cell(day, time)}
                    onClick={() => {
                      onClick(key)
                    }}
                    className={cx(
                      'relative block h-6 w-full outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset sm:h-4',
                      isSaved ? 'cursor-default bg-busy-line ring-1 ring-busy ring-inset' : 'cursor-pointer hover:bg-surface-muted',
                    )}
                  >
                    {!isSaved && (
                      <span
                        aria-hidden="true"
                        data-painted={isPainted || undefined}
                        className={cx(
                          'pointer-events-none absolute inset-0 motion-safe:transition-opacity motion-safe:duration-[120ms] motion-safe:ease-out',
                          HATCH,
                          isPainted ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
