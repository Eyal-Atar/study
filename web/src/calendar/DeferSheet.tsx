import { parseDate } from '@internationalized/date'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { useBlockActions, type DeferOptions } from '../board/actions'
import { useDeferSlots } from '../availability/api'
import { blockMinutes, formatRange, formatTime } from '../board/time'
import type { Block } from '../board/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { DatePicker } from '../ui/DatePicker'
import { Dialog } from '../ui/Dialog'
import { ActionCard } from '../ui/ActionCard'
import { MorningIcon, NextSlotIcon, PickTimeIcon, ChevronLeft } from '../ui/icons'
import { Note } from '../ui/Note'
import { OptionGrid } from '../ui/OptionGrid'
import { ErrorState, LoadingState } from '../ui/states'
import { ICON_STROKE } from '../ui/styles'
import { shortDate } from './days'
import { ghostOf, type Ghost } from './ghost'
import { BlockCard } from './BlockCard'

export interface DeferSheetProps {
  block: Block | null
  tz: string
  today: string
  onClose: () => void
  onPreview: (ghosts: Ghost[]) => void
}

const SHOWN_CODES = new Set(['slot_taken', 'slot_busy', 'outside_day'])
type Running = 'next' | 'tomorrow' | 'at' | null

// "Where should I move this block?": the next free spot, tomorrow, or a time of the user's choice
// (with a preview on the grid behind the sheet). Open while `block` is set. Every way out clears
// the preview, and so does the body unmounting.
export function DeferSheet({ block, tz, today, onClose, onPreview }: DeferSheetProps) {
  function close() {
    onPreview([])
    onClose()
  }
  return (
    <Dialog
      title={en.calendar.sheets.defer.title}
      isOpen={block !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      {block === null ? null : (
        <DeferBody key={block.id} block={block} tz={tz} today={today} onClose={close} onPreview={onPreview} />
      )}
    </Dialog>
  )
}

function DeferBody({
  block,
  tz,
  today,
  onClose,
  onPreview,
}: {
  block: Block
  tz: string
  today: string
  onClose: () => void
  onPreview: (ghosts: Ghost[]) => void
}) {
  const actions = useBlockActions()
  const [picking, setPicking] = useState(false)
  const [running, setRunning] = useState<Running>(null)
  const [error, setError] = useState<string | null>(null)

  const previewRef = useRef(onPreview)
  useEffect(() => {
    previewRef.current = onPreview
  })
  useEffect(
    () => () => {
      previewRef.current([])
    },
    [],
  )

  // The request outlives the sheet (Escape while it runs): an answer that comes after it is gone
  // closes nothing, and a refusal is said in a toast, since there is no sheet to say it in.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const options: DeferOptions = {
    onSuccess: () => {
      if (mounted.current) onClose()
    },
    onError: (failure: ApiError) => {
      if (!mounted.current) return false
      if (failure.code !== null && SHOWN_CODES.has(failure.code)) {
        setRunning(null)
        setError(codeText(failure.code))
        return true
      }
      onClose()
      return false
    },
  }

  function run(which: Exclude<Running, null>, request: Parameters<typeof actions.defer>[1]) {
    setError(null)
    setRunning(which)
    actions.defer(block, request, options)
  }

  const d = en.calendar.sheets.defer

  if (picking) {
    return (
      <PickBody
        block={block}
        tz={tz}
        today={today}
        error={error}
        isRunning={running === 'at'}
        onBack={() => {
          setError(null)
          onPreview([])
          setPicking(false)
        }}
        onClearError={() => {
          setError(null)
        }}
        onPreview={onPreview}
        onConfirm={(startsAt) => {
          run('at', { to: 'at', starts_at: startsAt })
        }}
      />
    )
  }

  return (
    <>
      <BlockCard block={block} tz={tz} />
      <div className="flex flex-col gap-2">
        <ActionCard
          icon={NextSlotIcon}
          title={d.next}
          description={d.nextHint}
          isPending={running === 'next'}
          isDisabled={running !== null && running !== 'next'}
          onPress={() => {
            run('next', { to: 'next' })
          }}
        />
        <ActionCard
          icon={MorningIcon}
          title={d.tomorrow}
          description={d.tomorrowHint}
          isPending={running === 'tomorrow'}
          isDisabled={running !== null && running !== 'tomorrow'}
          onPress={() => {
            run('tomorrow', { to: 'tomorrow' })
          }}
        />
        <ActionCard
          icon={PickTimeIcon}
          title={d.pick}
          description={d.pickHint}
          isDisabled={running !== null}
          onPress={() => {
            setPicking(true)
          }}
        />
      </div>
      {error === null ? null : (
        <Note tone="warning" role="alert">
          {error}
        </Note>
      )}
      <div className="flex flex-col gap-2">
        <Button
          variant="danger"
          className="w-full"
          isDisabled={running !== null}
          onPress={() => {
            actions.skip(block)
            onClose()
          }}
        >
          {d.skip}
        </Button>
        <p className="text-small text-ink-muted">{en.calendar.sheets.actions.skipHint}</p>
      </div>
    </>
  )
}

function PickBody({
  block,
  tz,
  today,
  error,
  isRunning,
  onBack,
  onClearError,
  onPreview,
  onConfirm,
}: {
  block: Block
  tz: string
  today: string
  error: string | null
  isRunning: boolean
  onBack: () => void
  onClearError: () => void
  onPreview: (ghosts: Ghost[]) => void
  onConfirm: (startsAt: string) => void
}) {
  const d = en.calendar.sheets.defer
  const [date, setDate] = useState(today)
  const [chosen, setChosen] = useState<string | null>(null)
  const slots = useDeferSlots(block.id, date)
  const list = slots.data?.slots ?? []
  const length = blockMinutes(block) * 60_000

  function rangeOf(startsAt: string) {
    const endsAt = new Date(Date.parse(startsAt) + length).toISOString()
    return { endsAt, text: formatRange({ starts_at: startsAt, ends_at: endsAt }, tz) }
  }

  function choose(startsAt: string | null) {
    setChosen(startsAt)
    onClearError()
    if (startsAt === null) {
      onPreview([])
      return
    }
    const { endsAt, text } = rangeOf(startsAt)
    onPreview([ghostOf(block, startsAt, endsAt, date, tz, 'target', text)])
  }

  const next = chosen === null ? null : rangeOf(chosen)

  return (
    <>
      <BlockCard block={block} tz={tz} />
      <div>
        <Button variant="quiet" isDisabled={isRunning} onPress={onBack}>
          <ChevronLeft aria-hidden="true" size={16} strokeWidth={ICON_STROKE} />
          {d.back}
        </Button>
      </div>
      <DatePicker
        label={d.day}
        value={parseDate(date)}
        minValue={parseDate(today)}
        onChange={(value) => {
          if (value === null) return
          setDate(value.toString())
          setChosen(null)
          onClearError()
          onPreview([])
        }}
      />
      {slots.isPending ? <LoadingState shape="text" rows={2} label={d.loading} /> : null}
      {slots.isError ? (
        <ErrorState
          message={en.move.loadFailed}
          onRetry={() => {
            void slots.refetch()
          }}
        />
      ) : null}
      {slots.isSuccess && list.length === 0 ? <Note>{d.noSlots}</Note> : null}
      {slots.isSuccess && list.length > 0 ? (
        <OptionGrid
          aria-label={d.slots}
          ltr
          options={list.map((startsAt) => ({ id: startsAt, label: formatTime(startsAt, tz) }))}
          value={chosen}
          onChange={choose}
        />
      ) : null}
      {next === null ? null : (
        <p aria-live="polite" className="text-small tabular-nums">
          {d.preview(formatRange(block, tz), `${shortDate(date)}, ${next.text}`)}
        </p>
      )}
      {error === null ? null : (
        <Note tone="warning" role="alert">
          {error}
        </Note>
      )}
      {chosen === null ? null : (
        <Button
          variant="primary"
          className="w-full"
          isPending={isRunning}
          onPress={() => {
            onConfirm(chosen)
          }}
        >
          {d.confirmAt(formatTime(chosen, tz))}
        </Button>
      )}
    </>
  )
}
