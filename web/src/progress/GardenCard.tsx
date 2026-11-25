import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useProfileTimezone } from '../board/time'
import { GardenScene } from '../garden/GardenScene'
import { gardenModel, storyOf, summaryOf, type GardenItem } from '../garden/model'
import { useGardenExams } from '../garden/useGardenExams'
import { en } from '../i18n/en'
import type { Progress } from './types'

/*
  The garden at the top of the progress screen (S33, Task 7). Three sources, no new request:
  GET /progress (from the page), GET /exams, and the tasks of each exam still open, through the
  queries the calendar and the exam screen already share (useExamProgress).

  An exam joins the garden once its percent is known, so while the exams or their tasks load (or
  GET /exams fails) the garden shows what it has, the archive, without a message: the page around
  it already has its own loading and error states, for GET /progress.

  Tapping a thing selects it and the caption under the scene tells its story; tapping it again, or
  Escape inside the scene, lets it go. The caption is the garden's only live region.
*/

// The opening motion of the screen lasts --duration-ceremony (index.css); after it the scene stops
// asking for it, so a re-render later (a refresh of GET /progress) never plays it again, and a
// re-render during it (the exams arriving) does not cut it short.
const OPENING_MS = 1500

function badgeName(key: string): string {
  const items: Partial<Record<string, { name: string }>> = en.progress.badges.items
  return items[key]?.name ?? en.progress.badges.unknown.name
}

const sameItem = (a: GardenItem, b: GardenItem) =>
  a.kind === b.kind &&
  (a.kind !== 'plant' || b.kind !== 'plant' || a.id === b.id) &&
  (a.kind !== 'stone' || b.kind !== 'stone' || a.key === b.key)

export function GardenCard({ progress }: { progress: Progress }) {
  const titleId = useId()
  const timeZone = useProfileTimezone()
  const exams = useGardenExams()
  const model = useMemo(() => gardenModel({ progress, exams, timeZone }), [exams, progress, timeZone])

  const [selected, setSelected] = useState<GardenItem | null>(null)
  const [opening, setOpening] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => {
      setOpening(false)
    }, OPENING_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [])

  const onSelect = (item: GardenItem) => {
    setSelected((current) => (current !== null && sameItem(current, item) ? null : item))
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && selected !== null) {
      event.stopPropagation()
      setSelected(null)
    }
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="sr-only">
        {en.garden.scene.title}
      </h2>
      {/* Escape from a focused item of the scene; the scene's items handle Enter and Space. */}
      <div onKeyDown={onKeyDown}>
        <GardenScene
          model={model}
          label={summaryOf(model)}
          selected={selected}
          onSelect={onSelect}
          play={opening ? 'open' : null}
        />
      </div>
      <p role="status" className={selected === null ? 'text-small text-ink-muted' : 'text-body'}>
        {selected === null ? en.garden.scene.hint : storyOf(model, selected, badgeName)}
      </p>
    </section>
  )
}
