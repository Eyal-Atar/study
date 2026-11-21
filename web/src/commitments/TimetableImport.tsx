import { parseDate } from '@internationalized/date'
import { useId, useState } from 'react'
import { Button as AriaButton, FileTrigger } from 'react-aria-components'
import { ApiError } from '../api/client'
import { useApplyTimetable } from '../availability/api'
import type {
  CommitmentInput,
  CommitmentKind,
  TimetableApplyResponse,
  TimetableProposal,
  TimetableResult,
  Weekday,
} from '../availability/types'
import { en } from '../i18n/en'
import { codeText, isKnownCode, resetTime } from '../i18n/codes'
import { useJob } from '../onboarding/api'
import { ACCEPTED_FILE_TYPES, UploadError } from '../onboarding/upload'
import { Button } from '../ui/Button'
import { CheckButton } from '../ui/CheckButton'
import { DatePicker } from '../ui/DatePicker'
import { Camera, LoaderCircle } from '../ui/icons'
import { Note } from '../ui/Note'
import { cx, FOCUS_RING, ICON_STROKE } from '../ui/styles'
import { UserText } from '../ui/UserText'
import { CommitmentDialog, type CommitmentDraft } from './CommitmentDialog'
import { kindIcon } from './kindIcon'
import { groupSubtitle, type CommitmentGroup } from './model'
import { MAX_TIMETABLE_PDF_BYTES, timetableMime, useUploadTimetable } from './timetableUpload'

const t = en.commitments.timetable

// Each step fades in, and only where motion is welcome (prefers-reduced-motion: no animation).
const APPEAR = 'motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out motion-safe:starting:opacity-0'

export interface TimetableImportProps {
  // Called once the approved busy times are saved (POST /timetables/{job_id}/apply).
  onApplied: (response: TimetableApplyResponse) => void
  // onboarding: a full-width secondary button. row: a row of the Busy time card in the settings.
  buttonVariant?: 'onboarding' | 'row'
}

// One busy time of the proposals: one title at the same hours, on one day or several (the
// prototype's "Sun, Tue, 14:00–17:00"). The student approves or edits it as a whole.
export interface ProposalRow {
  key: string
  title: string
  kind: CommitmentKind
  weekdays: Weekday[]
  start_time: string
  end_time: string
  valid_until: string | null
  approved: boolean
}

// The proposals of the job as rows, in the order the photo gave them: the proposals that share a
// title, a kind and their hours become one row with their days.
function proposalRows(proposals: readonly TimetableProposal[]): ProposalRow[] {
  const rows = new Map<string, ProposalRow>()
  for (const p of proposals) {
    const key = JSON.stringify([p.title, p.kind, p.start, p.end])
    const row = rows.get(key)
    if (row === undefined) {
      rows.set(key, { key, title: p.title, kind: p.kind, weekdays: [p.weekday], start_time: p.start, end_time: p.end, valid_until: null, approved: true })
    } else if (!row.weekdays.includes(p.weekday)) {
      row.weekdays = [...row.weekdays, p.weekday].sort((a, b) => a - b)
    }
  }
  return [...rows.values()]
}

function asGroup(row: ProposalRow): CommitmentGroup {
  return {
    key: row.key,
    title: row.title,
    kind: row.kind,
    weekdays: row.weekdays,
    start_time: row.start_time,
    end_time: row.end_time,
    valid_from: '',
    valid_until: row.valid_until,
    ids: [],
    isMeTime: false,
  }
}

// What the apply sends: one item per day of every approved row.
function approvedItems(rows: readonly ProposalRow[]): CommitmentInput[] {
  return rows
    .filter((row) => row.approved)
    .flatMap((row) =>
      row.weekdays.map((weekday) => ({
        title: row.title,
        kind: row.kind,
        weekday,
        start_time: row.start_time,
        end_time: row.end_time,
        ...(row.valid_until === null ? {} : { valid_until: row.valid_until }),
      })),
    )
}

function apiText(error: ApiError): string {
  if (error.code === 'ai_quota_exceeded') {
    const limit = error.details.limit
    return t.quota(typeof limit === 'number' && Number.isFinite(limit) ? limit : null, resetTime(error.details, new Date()))
  }
  if (error.code !== null && isKnownCode(error.code)) return codeText(error.code, error.details)
  return error.title ?? en.errors.generic
}

// Why a file did not get as far as the job. Everything here is said before any request, except the
// answers of POST /timetables.
function uploadFailureText(error: unknown, file: File): string {
  if (error instanceof UploadError) {
    switch (error.code) {
      case 'file_too_large':
        // A PDF has a size limit; a photo is too large only after it was already made smaller.
        return timetableMime(file) === 'application/pdf'
          ? codeText('file_too_large', { limit_bytes: MAX_TIMETABLE_PDF_BYTES })
          : t.photoTooLarge
      case 'image_unreadable':
        return t.photoUnreadable
      default:
        return codeText(error.code)
    }
  }
  if (error instanceof ApiError) return apiText(error)
  return en.errors.generic
}

export function TimetableUploadTrigger({ variant, onSelect }: { variant: 'onboarding' | 'row'; onSelect: (file: File) => void }) {
  const icon = <Camera aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
  return (
    <FileTrigger
      acceptedFileTypes={[...ACCEPTED_FILE_TYPES]}
      onSelect={(files) => {
        const file = files?.[0]
        if (file !== undefined) onSelect(file)
      }}
    >
      {variant === 'row' ? (
        <AriaButton
          className={cx(
            'flex min-h-touch w-full cursor-pointer items-center gap-3 rounded-control text-start text-body font-medium text-brand-strong',
            FOCUS_RING,
          )}
        >
          {icon}
          {t.uploadRow}
        </AriaButton>
      ) : (
        <Button variant="secondary" className="w-full">
          {icon}
          {t.upload}
        </Button>
      )}
    </FileTrigger>
  )
}

export interface TimetableProposalsProps {
  rows: readonly ProposalRow[]
  onRowsChange: (rows: ProposalRow[]) => void
  validUntil: string
  onValidUntilChange: (date: string) => void
  onApply: () => void
  onCancel: () => void
  note: string | null
  isPending?: boolean
  // After a refusal that a second try would only repeat (already_applied).
  isApplyDisabled?: boolean
}

// Archi's question about what he read, with a row per busy time: approve it, or edit it in the
// dialog (which sends nothing here). The parts are controlled, so the components page can show it.
export function TimetableProposals({
  rows,
  onRowsChange,
  validUntil,
  onValidUntilChange,
  onApply,
  onCancel,
  note,
  isPending = false,
  isApplyDisabled = false,
}: TimetableProposalsProps) {
  const questionId = useId()
  const [editing, setEditing] = useState<number | null>(null)
  const editingRow = editing === null ? undefined : rows[editing]
  const single = rows.length === 1

  function replace(index: number, change: Partial<ProposalRow>) {
    onRowsChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)))
  }

  function draftToRow(draft: CommitmentDraft): Partial<ProposalRow> {
    return {
      title: draft.title,
      kind: draft.kind,
      weekdays: [...draft.weekdays].sort((a, b) => a - b),
      start_time: draft.start_time,
      end_time: draft.end_time,
      valid_until: draft.valid_until ?? null,
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={questionId}
      data-timetable-motion=""
      className={cx('flex flex-col gap-3 rounded-card bg-brand-soft px-4 pt-3 pb-4 text-ink', APPEAR)}
    >
      <p id={questionId} className="font-semibold">
        {t.found(rows.length)}
      </p>
      <ul className="flex flex-col">
        {rows.map((row, index) => {
          const Icon = kindIcon(row.kind)
          const when = groupSubtitle(asGroup(row))
          return (
            <li key={row.key} className="flex min-h-touch items-center gap-3">
              <Icon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="shrink-0 text-busy" />
              <div className="min-w-0 flex-1">
                <UserText truncate className="font-medium">
                  {row.title}
                </UserText>
                <p className="text-small text-ink-muted tabular-nums">{when}</p>
              </div>
              <Button
                variant="quiet"
                aria-label={t.edit(row.title, when)}
                isDisabled={isPending}
                onPress={() => {
                  setEditing(index)
                }}
              >
                {t.editLabel}
              </Button>
              <CheckButton
                isDone={row.approved}
                aria-label={t.approve(row.title, when)}
                isDisabled={isPending}
                onChange={(approved) => {
                  replace(index, { approved })
                }}
              />
            </li>
          )
        })}
      </ul>
      <DatePicker
        label={en.commitments.dialog.validUntil}
        value={validUntil === '' ? null : parseDate(validUntil)}
        onChange={(value) => {
          onValidUntilChange(value === null ? '' : value.toString())
        }}
      />
      {note === null ? null : (
        <Note tone="warning" role="alert">
          {note}
        </Note>
      )}
      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" onPress={onApply} isPending={isPending} isDisabled={isApplyDisabled}>
          {single ? t.addIt : t.addThem}
        </Button>
        <Button variant="secondary" onPress={onCancel} isDisabled={isPending}>
          {t.notNow}
        </Button>
      </div>
      <CommitmentDialog
        isOpen={editingRow !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        group={editingRow === undefined ? null : asGroup(editingRow)}
        mode="draft"
        onDraft={(draft) => {
          if (editing !== null) replace(editing, draftToRow(draft))
        }}
        onSaved={() => undefined}
      />
    </div>
  )
}

// Archi is busy with the photo: preparing it in the browser, or reading it on the server. One
// live region for both, so the change from one to the other is announced.
export function TimetableProgress({ text }: { text: string }) {
  return (
    <p role="status" data-timetable-motion="" className={cx('flex min-h-touch items-center gap-2 text-small text-ink', APPEAR)}>
      <LoaderCircle aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="shrink-0 motion-safe:animate-spin" />
      {text}
    </p>
  )
}

// Why the photo gave nothing to add, and the way on without it.
export function TimetableFailure({ text }: { text: string }) {
  return (
    <div data-timetable-motion="" className={APPEAR}>
      <Note tone="warning" role="alert">
        <p>{text}</p>
        <p>{t.manual}</p>
      </Note>
    </div>
  )
}

// Fixed hours from a photo (or a PDF) of the timetable: the file is checked and made smaller in the
// browser, uploaded, read by a job, and what was read comes back as Archi's question. A file the
// API would refuse is refused here, before any request.
export function TimetableImport({ onApplied, buttonVariant = 'onboarding' }: TimetableImportProps) {
  const upload = useUploadTimetable()
  const apply = useApplyTimetable()
  const [preparing, setPreparing] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [uploadFailure, setUploadFailure] = useState<string | null>(null)
  // The student's changes to the rows; null while they are as the job read them.
  const [edited, setEdited] = useState<ProposalRow[] | null>(null)
  const [validUntil, setValidUntil] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [applyDisabled, setApplyDisabled] = useState(false)
  const job = useJob<TimetableResult>(jobId)

  function reset() {
    setJobId(null)
    setUploadFailure(null)
    setEdited(null)
    setValidUntil('')
    setNote(null)
    setApplyDisabled(false)
  }

  async function select(file: File) {
    reset()
    setPreparing(true)
    try {
      const answer = await upload.mutateAsync(file)
      setJobId(answer.job_id)
    } catch (error) {
      setUploadFailure(uploadFailureText(error, file))
    } finally {
      setPreparing(false)
    }
  }

  const data = job.data?.id === jobId ? job.data : undefined
  let failure: string | null = uploadFailure
  let rows: ProposalRow[] | null = null
  if (jobId !== null) {
    if (job.isError) failure = apiText(job.error)
    else if (data?.status === 'failed') failure = codeText(data.error ?? 'internal_error')
    else if (data?.status === 'done') {
      rows = edited ?? proposalRows(data.result?.commitments ?? [])
      if (rows.length === 0) failure = t.empty
    }
  }

  async function submit(current: ProposalRow[]) {
    if (jobId === null) return
    const items = approvedItems(current)
    if (items.length === 0) {
      setNote(t.noneChosen)
      return
    }
    setNote(null)
    try {
      const answer = await apply.mutateAsync({ jobId, body: { items, ...(validUntil === '' ? {} : { valid_until: validUntil }) } })
      reset()
      onApplied(answer)
    } catch (error) {
      setNote(error instanceof ApiError ? apiText(error) : en.errors.generic)
      if (error instanceof ApiError && error.code === 'already_applied') setApplyDisabled(true)
    }
  }

  const trigger = (
    <TimetableUploadTrigger
      variant={buttonVariant}
      onSelect={(file) => {
        void select(file)
      }}
    />
  )

  if (preparing) return <TimetableProgress text={t.preparing} />
  if (failure !== null) {
    return (
      <div className="flex flex-col gap-3">
        <TimetableFailure text={failure} />
        {trigger}
      </div>
    )
  }
  if (jobId === null) return trigger
  if (rows === null) return <TimetableProgress text={t.reading} />
  return (
    <TimetableProposals
      rows={rows}
      onRowsChange={setEdited}
      validUntil={validUntil}
      onValidUntilChange={setValidUntil}
      onApply={() => {
        void submit(rows)
      }}
      onCancel={reset}
      note={note}
      isPending={apply.isPending}
      isApplyDisabled={applyDisabled}
    />
  )
}
