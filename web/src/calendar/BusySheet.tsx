import { parseDate } from '@internationalized/date'
import { useEffect, useRef, useState } from 'react'
import type { BusyItem } from '../availability/types'
import { blockName } from '../board/blockName'
import { addDays, dateIn, formatTime } from '../board/time'
import type { Block } from '../board/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { DatePicker } from '../ui/DatePicker'
import { Dialog } from '../ui/Dialog'
import { Note } from '../ui/Note'
import { TextField } from '../ui/TextField'
import { TimeField } from '../ui/TimeField'
import { useBusyWrite, type BusyWrite } from './busyActions'
import { instantOf } from './busyTime'
import { ghostOf, type Ghost } from './ghost'

export interface BusyDraft {
  date: string
  startsAt: string
  endsAt: string
}

export interface BusySheetProps {
  draft: BusyDraft | null
  event: BusyItem | null
  blocks: Block[]
  tz: string
  today: string
  onClose: () => void
  onPreview: (ghosts: Ghost[]) => void
}

const SHOWN_CODES = new Set(['event_in_past', 'too_many_events', 'too_long'])
function minutesOf(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number)
  return h * 60 + m
}

// "What should I keep free?" (new) and the edit of an event. Open while draft or event is set.
export function BusySheet(props: BusySheetProps) {
  const write = useBusyWrite()
  const open = props.draft !== null || props.event !== null
  function close() {
    props.onPreview([])
    props.onClose()
  }
  return (
    <Dialog
      title={props.event === null ? en.calendar.sheets.busy.titleNew : en.calendar.sheets.busy.titleEdit}
      isOpen={open}
      isDismissable={!write.pending}
      isKeyboardDismissDisabled={write.pending}
      onOpenChange={(isOpen) => {
        if (!isOpen) close()
      }}
    >
      {open ? <BusyBody key={props.event?.id ?? 'new'} {...props} write={write} onClose={close} /> : null}
    </Dialog>
  )
}

function BusyBody({
  draft,
  event,
  blocks,
  tz,
  today,
  onClose,
  onPreview,
  write,
}: BusySheetProps & { write: BusyWrite }) {
  const b = en.calendar.sheets.busy
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [title, setTitle] = useState(event?.title ?? '')
  const [date, setDate] = useState(() =>
    event === null ? (draft?.date ?? today) : dateIn(tz, new Date(event.starts_at)),
  )
  const [from, setFrom] = useState(() => formatTime(event === null ? (draft?.startsAt ?? '') : event.starts_at, tz))
  const [to, setTo] = useState(() => formatTime(event === null ? (draft?.endsAt ?? '') : event.ends_at, tz))
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // An event that began on an earlier day keeps its own day valid when edited.
  const eventDay = event === null ? today : dateIn(tz, new Date(event.starts_at))
  const minDate = eventDay < today ? eventDay : today
  // An event over midnight or several days (S34's settings, the timetable import) keeps its
  // length in days: the end is on the same number of days after the (possibly moved) start day.
  const spanDays =
    event === null ? 0 : Math.round((Date.parse(dateIn(tz, new Date(event.ends_at))) - Date.parse(eventDay)) / 86_400_000)
  const endDate = addDays(date, spanDays)
  const startMs = instantOf(date, from, tz)
  const endMs = instantOf(endDate, to, tz)
  const valid = startMs !== null && endMs !== null && endMs > startMs
  const overlapping =
    valid
      ? blocks.filter(
          (block) =>
            block.status === 'planned' && Date.parse(block.starts_at) < endMs && Date.parse(block.ends_at) > startMs,
        )
      : []
  const first = overlapping[0]

  const previewRef = useRef(onPreview)
  const ghostsRef = useRef<Ghost[]>([])
  const ghosts: Ghost[] = valid
    ? [
        {
          id: 'busy-draft',
          date,
          startMin: minutesOf(from),
          endMin: minutesOf(to),
          colorIndex: null,
          title: title.trim() === '' ? en.calendar.grid.newBusy : title.trim(),
          tone: 'target',
        },
        ...overlapping.map((block) => ghostOf(block, block.starts_at, block.ends_at, block.study_date, tz, 'leaving')),
      ]
    : []
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

  function submit() {
    if (startMs === null || endMs === null || endMs <= startMs) {
      setFieldError(en.codes.not_after_starts_at)
      return
    }
    setFieldError(null)
    setError(null)
    const options = {
      // The write outlives this sheet: once it is gone, the toast says the result and nothing
      // here closes whatever sheet is open now.
      onSuccess: () => {
        if (mounted.current) onClose()
      },
      onError: (failure: { code: string | null }) => {
        if (!mounted.current) return false
        if (failure.code === 'not_after_starts_at') {
          setFieldError(en.codes.not_after_starts_at)
          return true
        }
        if (failure.code !== null && SHOWN_CODES.has(failure.code)) {
          setError(codeText(failure.code))
          return true
        }
        onClose()
        return false
      },
    }
    const name = title.trim() === '' ? null : title.trim()
    const startsAt = new Date(startMs).toISOString()
    const endsAt = new Date(endMs).toISOString()
    if (event === null) {
      write.create({ title: name, starts_at: startsAt, ends_at: endsAt }, options)
      return
    }
    // Only what changed: an edit of the title alone leaves the times as the server has them.
    const timesChanged =
      date !== eventDay || from !== formatTime(event.starts_at, tz) || to !== formatTime(event.ends_at, tz)
    const titleChanged = name !== event.title
    write.update(
      event.id,
      {
        ...(titleChanged || !timesChanged ? { title: name } : {}),
        ...(timesChanged ? { starts_at: startsAt, ends_at: endsAt } : {}),
      },
      options,
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <TextField label={b.what} value={title} onChange={setTitle} />
      <DatePicker
        label={b.day}
        value={parseDate(date)}
        minValue={parseDate(minDate)}
        onChange={(value) => {
          if (value !== null) setDate(value.toString())
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <TimeField
          label={b.from}
          value={from}
          onChange={(value) => {
            setFrom(value)
            setFieldError(null)
          }}
        />
        <TimeField
          label={b.to}
          value={to}
          errorMessage={fieldError ?? undefined}
          onChange={(value) => {
            setTo(value)
            setFieldError(null)
          }}
        />
      </div>
      {first === undefined ? null : <Note>{b.willMove(overlapping.length, blockName(first))}</Note>}
      {error === null ? null : (
        <Note tone="warning" role="alert">
          {error}
        </Note>
      )}
      <Button type="submit" variant="primary" className="w-full" isPending={write.pending}>
        {write.pending ? b.saving : event === null ? b.save : b.saveEdit}
      </Button>
      {event === null ? null : (
        <Button
          variant="danger"
          className="w-full"
          onPress={() => {
            write.remove(event)
            onClose()
          }}
        >
          {b.delete}
        </Button>
      )}
    </form>
  )
}
