import { useEffect, useRef, useState } from 'react'
import { Archie } from '../archie/Archie'
import { formatTime } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { nextToday } from '../today/chooseNext'
import { Button } from '../ui/Button'
import { examColor } from '../ui/examColor'
import { KIND_ICON } from '../ui/icons'
import { cx, ICON_STROKE } from '../ui/styles'
import { UserText } from '../ui/UserText'
import { archiMayInterrupt, breakRun } from './archi'

const SHOWN_MS = 20_000

export interface BreakNoticeProps {
  todayBlocks: Block[]
  now: number
  tz: string
}

// "That was 90 minutes in a row. I've poured the tea." (S32 decision 14; the prototype's break):
// after a long run of done blocks Archi, at his tea, rises above a card that floats over the grid.
// It is not a dialog: it takes no focus, blocks nothing, and closes by itself after 20 seconds or
// with its button. Once for each run, and only when Archi may speak up (archiMayInterrupt: not
// within 20 minutes of the last time he did).
export function BreakNotice({ todayBlocks, now, tz }: BreakNoticeProps) {
  // The run is named by its first block, so a further Done in the same run is not a new one.
  const run = breakRun(todayBlocks, now)
  const [shown, setShown] = useState<string | null>(null)
  // The runs already decided: asked once each, so a refetch or StrictMode never asks again.
  const asked = useRef(new Set<string>())

  // Asking is a side effect (it writes down when Archi last spoke up), so it happens here, and the
  // answer is shown on the next tick. That tick is not cancelled: StrictMode runs the effect twice,
  // and the second run finds the run already asked.
  useEffect(() => {
    if (run === null || asked.current.has(run)) return
    asked.current.add(run)
    if (!archiMayInterrupt(Date.now())) return
    setTimeout(() => {
      setShown(run)
    }, 0)
  }, [run])

  const open = shown !== null && shown === run
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      setShown(null)
    }, SHOWN_MS)
    return () => {
      clearTimeout(id)
    }
  }, [open])

  if (!open) return null
  const next = nextToday(todayBlocks)
  const NextIcon = next === undefined ? null : KIND_ICON[next.task_kind]
  return (
    <div className="pointer-events-none fixed inset-x-4 top-40 z-40 flex justify-center lg:absolute lg:top-24">
      <div role="status" className="pointer-events-auto w-full max-w-sm rounded-card bg-surface px-4 pb-3 shadow-raised">
        <div className="flex items-end gap-3">
          {/* He rises above the card, standing on it, with no frame of his own. */}
          <div className="-mt-8 w-[170px] shrink-0">
            <Archie mood="rest" decorative />
          </div>
          <p className="min-w-0 pb-3 text-body font-semibold">{en.calendar.archi.breakTitle}</p>
        </div>
        <div className="border-t border-line pt-2.5">
          <p className="text-small text-ink-muted">{en.calendar.archi.breakBody(next === undefined ? null : formatTime(next.starts_at, tz))}</p>
          {next === undefined || NextIcon === null ? null : (
            <p className="mt-1.5 flex items-center gap-1.5">
              <NextIcon aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className={cx('shrink-0', examColor(next.exam_color_index).text)} />
              <UserText truncate className="flex-1 font-semibold">
                {next.task_title}
              </UserText>
            </p>
          )}
          <div className="mt-2 flex justify-end">
            <Button
              variant="quiet"
              onPress={() => {
                setShown(null)
              }}
            >
              {en.calendar.archi.breakClose}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
