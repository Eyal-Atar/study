import { useEffect, useRef, useState } from 'react'
import { Archie } from '../archie/Archie'
import { blockName } from '../board/blockName'
import { blockMinutes, durationText, formatRange, formatTime } from '../board/time'
import type { Block } from '../board/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { examColor } from '../ui/examColor'
import { KIND_ICON } from '../ui/icons'
import { Note } from '../ui/Note'
import { OptionGrid } from '../ui/OptionGrid'
import { Select } from '../ui/Select'
import { ICON_STROKE } from '../ui/styles'
import { UserText } from '../ui/UserText'
import { useFreeTimeWrite, type FreeTimeWrite } from './freeTimeActions'
import { ghostOf, type Ghost } from './ghost'

export interface FreeTimeSheetProps {
  isOpen: boolean
  onClose: () => void
  // The planned blocks that have not started yet, in start order.
  upcoming: Block[]
  now: number
  today: string
  tz: string
  onPreview: (ghosts: Ghost[]) => void
}

const SHOWN_CODES = new Set(['nothing_to_place', 'no_free_time'])
const OTHER_OPTIONS = Array.from({ length: 13 }, (_, i) => 120 + i * 30).map((m) => ({ value: String(m), label: durationText(m) }))
const FIXED: Record<string, number> = { m30: 30, m60: 60, m90: 90 }

// "Good, some free time. How much do you have?": the next blocks come forward to now.
export function FreeTimeSheet(props: FreeTimeSheetProps) {
  const write = useFreeTimeWrite()
  function close() {
    props.onPreview([])
    props.onClose()
  }
  return (
    <Dialog
      title={en.calendar.sheets.freeTime.title}
      isOpen={props.isOpen}
      isDismissable={!write.pending}
      isKeyboardDismissDisabled={write.pending}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      // About 110px of Archi (joy is 702 by 654), standing on the sheet's top edge as in the
      // prototype, so the amounts and "Start now" fit on a phone without scrolling.
      figure={
        <div className="w-[118px]">
          <Archie mood="joy" decorative />
        </div>
      }
    >
      {props.isOpen ? <FreeTimeBody {...props} write={write} onClose={close} /> : null}
    </Dialog>
  )
}

interface Fit {
  block: Block
  startsAt: string
  endsAt: string
  range: string
}

function fitBlocks(upcoming: Block[], minutes: number, now: number, tz: string): Fit[] {
  const fits: Fit[] = []
  let used = 0
  for (const block of upcoming) {
    const length = blockMinutes(block)
    if (used + length > minutes) break
    const startsAt = new Date(now + used * 60_000).toISOString()
    const endsAt = new Date(now + (used + length) * 60_000).toISOString()
    fits.push({ block, startsAt, endsAt, range: formatRange({ starts_at: startsAt, ends_at: endsAt }, tz) })
    used += length
  }
  return fits
}

function FreeTimeBody({
  onClose,
  upcoming,
  now,
  today,
  tz,
  onPreview,
  write,
}: FreeTimeSheetProps & { write: FreeTimeWrite }) {
  const f = en.calendar.sheets.freeTime
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [choice, setChoice] = useState('m60')
  const [other, setOther] = useState('120')
  const [error, setError] = useState<string | null>(null)

  const minutes = choice === 'other' ? Number(other) : (FIXED[choice] ?? 60)
  const fits = fitBlocks(upcoming, minutes, now, tz)
  const ghosts = fits.map((fit) => ghostOf(fit.block, fit.startsAt, fit.endsAt, today, tz, 'target', fit.range))

  // Keyed by content: the parent may pass a new array of the same blocks on every render.
  const previewRef = useRef(onPreview)
  const ghostsRef = useRef(ghosts)
  useEffect(() => {
    previewRef.current = onPreview
    ghostsRef.current = ghosts
  })
  const key = JSON.stringify(ghosts)
  useEffect(() => {
    previewRef.current(ghostsRef.current)
  }, [key])
  useEffect(
    () => () => {
      previewRef.current([])
    },
    [],
  )

  function start() {
    setError(null)
    write.start(minutes, {
      onSuccess: () => {
        if (mounted.current) onClose()
      },
      onError: (failure) => {
        if (!mounted.current) return false
        if (failure.code !== null && SHOWN_CODES.has(failure.code)) {
          setError(codeText(failure.code))
          return true
        }
        onClose()
        return false
      },
    })
  }

  return (
    <>
      <OptionGrid
        aria-label={f.amount}
        columns={4}
        options={[
          { id: 'm30', label: f.options.m30 },
          { id: 'm60', label: f.options.m60 },
          { id: 'm90', label: f.options.m90 },
          { id: 'other', label: f.options.other },
        ]}
        value={choice}
        onChange={(value) => {
          if (value !== null) setChoice(value)
        }}
      />
      {choice === 'other' ? (
        <Select label={f.otherLabel} value={other} options={OTHER_OPTIONS} onChange={setOther} />
      ) : null}
      {fits.length === 0 ? null : (
        <div className="flex flex-col gap-2 rounded-card bg-surface-muted p-3">
          <p className="text-small font-semibold">{fits.length === 1 ? f.nextOne : f.nextMany}</p>
          <ul className="flex flex-col gap-2">
            {fits.map((fit) => {
              const KindIcon = KIND_ICON[fit.block.task_kind]
              return (
                <li key={fit.block.id} className="flex items-start gap-2">
                  <KindIcon
                    aria-hidden="true"
                    size={16}
                    strokeWidth={ICON_STROKE}
                    className={`mt-1 shrink-0 ${examColor(fit.block.exam_color_index).text}`}
                  />
                  <div className="flex min-w-0 flex-col">
                    <UserText truncate className="font-semibold">
                      {blockName(fit.block)}
                    </UserText>
                    <span className="text-small text-ink-muted tabular-nums">
                      {f.instead(fit.range, formatTime(fit.block.starts_at, tz))}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {error === null ? null : (
        <Note tone="warning" role="alert">
          {error}
        </Note>
      )}
      <Button variant="primary" className="w-full" isPending={write.pending} onPress={start}>
        {write.pending ? f.starting : f.start}
      </Button>
    </>
  )
}
