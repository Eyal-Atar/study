import { useQueryClient } from '@tanstack/react-query'
import { parseDate } from '@internationalized/date'
import { useRef, useState } from 'react'
import { ApiError } from '../api/client'
import {
  commitmentsKey,
  useCreateCommitment,
  useDeleteCommitment,
  useUpdateCommitment,
} from '../availability/api'
import type { CommitmentInput, CommitmentKind, Weekday } from '../availability/types'
import { useBoardUserId } from '../board/api'
import { en } from '../i18n/en'
import { codeText, isKnownCode } from '../i18n/codes'
import { Button } from '../ui/Button'
import { DatePicker } from '../ui/DatePicker'
import { Dialog } from '../ui/Dialog'
import { ICON_STROKE } from '../ui/styles'
import { Note } from '../ui/Note'
import { RadioCards } from '../ui/RadioCards'
import { TextField } from '../ui/TextField'
import { TimeField } from '../ui/TimeField'
import { WeekdayPicker } from '../ui/WeekdayPicker'
import { kindIcon } from './kindIcon'
import { groupWrites, type CommitmentGroup } from './model'

const t = en.commitments.dialog
// The server takes titles of up to 100 characters (CommitmentTitle in api/app/schemas/commitments.py).
const TITLE_MAX = 100
const KINDS: CommitmentKind[] = ['work', 'class', 'other']
const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6]

export type CommitmentDraft = CommitmentInput & { weekdays: Weekday[] }

export interface CommitmentDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  // null adds a new group; a group edits it.
  group: CommitmentGroup | null
  // Called after every write went through; planAffected says whether to offer a new plan.
  onSaved: (planAffected: boolean) => void
  // Called after Delete removed the whole group (the caller offers Undo). Without it Delete reports
  // through onSaved.
  onDeleted?: ((group: CommitmentGroup) => void) | undefined
  // 'draft' sends nothing: the form hands its content to onDraft (the proposal of a photo).
  mode?: 'save' | 'draft'
  onDraft?: ((draft: CommitmentDraft) => void) | undefined
}

interface FieldErrors {
  title?: string
  days?: string
  times?: string
  date?: string
}

function serverFieldErrors(error: ApiError): FieldErrors | null {
  if (error.status !== 422 || error.code !== 'validation_error') return null
  const list = error.details.errors
  if (!Array.isArray(list)) return null
  const found: FieldErrors = {}
  for (const item of list as { type?: unknown }[]) {
    if (item.type === 'too_short') found.times = t.tooShort
    else if (item.type === 'same_as_start_time') found.times = t.sameAsStart
    else if (item.type === 'before_valid_from') found.date = t.beforeStart
  }
  return Object.keys(found).length > 0 ? found : null
}

// The text of a problem that is about the request and not about a field. A code without a text shows
// the title the server sent; the texts of the S35 codes arrive from scope S32 at merge time.
function problemText(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code === null) return null
  if (isKnownCode(error.code)) return codeText(error.code, error.details)
  return error.title
}

// The group as it stands in the database after some of the writes of a save went through: a retry
// goes on from here and does not create or delete a day twice.
function withRow(base: CommitmentGroup | null, draft: CommitmentDraft, weekday: Weekday, id: string): CommitmentGroup {
  base ??= {
    key: '',
    title: draft.title,
    kind: draft.kind,
    weekdays: [],
    start_time: draft.start_time,
    end_time: draft.end_time,
    valid_from: draft.valid_from ?? '',
    valid_until: draft.valid_until ?? null,
    ids: [],
    isMeTime: false,
  }
  const rows = [...base.weekdays.map((w, i) => ({ w, id: base.ids[i] ?? '' })), { w: weekday, id }].sort((a, b) => a.w - b.w)
  return { ...base, weekdays: rows.map((r) => r.w), ids: rows.map((r) => r.id) }
}

function withoutRow(base: CommitmentGroup, id: string): CommitmentGroup {
  const keep = base.ids.map((rowId, i) => ({ rowId, w: base.weekdays[i] ?? 0 })).filter((r) => r.rowId !== id)
  return { ...base, weekdays: keep.map((r) => r.w), ids: keep.map((r) => r.rowId) }
}

// The form is mounted only while the dialog is open, so every opening starts from the group again.
export function CommitmentDialog(props: CommitmentDialogProps) {
  return props.isOpen ? <CommitmentForm {...props} /> : null
}

function CommitmentForm({ onOpenChange, group, onSaved, onDeleted, mode = 'save', onDraft }: CommitmentDialogProps) {
  const [title, setTitle] = useState(group?.title ?? '')
  const [kind, setKind] = useState<CommitmentKind>(group?.kind ?? 'other')
  const [days, setDays] = useState<string[]>((group?.weekdays ?? []).map(String))
  const [start, setStart] = useState(group?.start_time ?? '')
  const [end, setEnd] = useState(group?.end_time ?? '')
  const [until, setUntil] = useState(group?.valid_until ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [note, setNote] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // What the database holds of the group; it moves on as the writes of a save go through.
  const base = useRef<CommitmentGroup | null>(group)
  // Whether any write went through, and the OR of their plan_affected. Kept for the whole life of
  // the form: a retry or a cancel after a partial failure still tells the caller the list changed.
  const wrote = useRef(false)
  const affected = useRef(false)

  const queryClient = useQueryClient()
  const userId = useBoardUserId()
  const create = useCreateCommitment()
  const update = useUpdateCommitment()
  const remove = useDeleteCommitment()

  const editing = group !== null

  function check(): FieldErrors {
    const found: FieldErrors = {}
    if (title.trim() === '') found.title = t.nameRequired
    if (days.length === 0) found.days = t.daysRequired
    if (start === '' || end === '') found.times = t.timesRequired
    return found
  }

  // Every way out of the form. Writes that went through are reported once, whatever closes it.
  function finish() {
    if (wrote.current) {
      wrote.current = false
      onSaved(affected.current)
    }
    onOpenChange(false)
  }

  function written(planAffected: boolean) {
    wrote.current = true
    affected.current = planAffected || affected.current
  }

  async function failed(error: unknown, generic: string, partial: boolean) {
    // Some of the writes may have gone through: the list shows what is really there.
    await queryClient.invalidateQueries({ queryKey: commitmentsKey(userId) })
    const fields = error instanceof ApiError ? serverFieldErrors(error) : null
    if (fields !== null) {
      setErrors(fields)
      setNote(partial ? generic : null)
    } else {
      // After some writes went through, the one message that says the list was refreshed is the useful one.
      setNote(partial ? generic : (problemText(error) ?? generic))
    }
    setPending(false)
  }

  async function submit() {
    const found = check()
    setErrors(found)
    setNote(null)
    if (Object.keys(found).length > 0) return
    const weekdays = WEEKDAYS.filter((d) => days.includes(String(d)))
    const draft: CommitmentDraft = {
      title: title.trim(),
      kind,
      weekday: weekdays[0] ?? 0,
      weekdays,
      start_time: start,
      end_time: end,
      ...(group ? { valid_from: group.valid_from } : {}),
      valid_until: until === '' ? null : until,
    }
    if (mode === 'draft') {
      onDraft?.(draft)
      onOpenChange(false)
      return
    }
    setPending(true)
    try {
      const writes = groupWrites(base.current, draft)
      for (const input of writes.create) {
        const done = await create.mutateAsync(input)
        written(done.plan_affected)
        base.current = withRow(base.current, draft, input.weekday, done.commitment.id)
      }
      for (const item of writes.update) {
        written((await update.mutateAsync(item)).plan_affected)
      }
      for (const id of writes.remove) {
        written((await remove.mutateAsync(id)).plan_affected)
        if (base.current) base.current = withoutRow(base.current, id)
      }
    } catch (error) {
      await failed(error, t.saveFailed, wrote.current)
      return
    }
    finish()
  }

  async function deleteGroup() {
    if (!group) return
    setPending(true)
    setNote(null)
    try {
      for (const id of base.current?.ids ?? group.ids) {
        written((await remove.mutateAsync(id)).plan_affected)
        if (base.current) base.current = withoutRow(base.current, id)
      }
    } catch (error) {
      await failed(error, t.deleteFailed, wrote.current)
      return
    }
    if (onDeleted) {
      wrote.current = false
      onDeleted(group)
    }
    finish()
  }

  const KindIcon = (k: CommitmentKind) => {
    const Icon = kindIcon(k)
    return <Icon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="text-busy" />
  }

  return (
    <Dialog
      title={editing ? t.titleEdit : t.titleAdd}
      isOpen
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else finish()
      }}
      isKeyboardDismissDisabled={pending}
      onSubmit={() => {
        void submit()
      }}
      footer={
        <>
          <Button type="submit" className="flex-1" isPending={pending}>
            {en.common.save}
          </Button>
          <Button
            variant="secondary"
            isDisabled={pending}
            onPress={finish}
          >
            {en.common.cancel}
          </Button>
          {editing && mode === 'save' ? (
            <Button variant="danger" isDisabled={pending} onPress={() => void deleteGroup()}>
              {en.common.delete}
            </Button>
          ) : null}
        </>
      }
    >
      <TextField
        label={t.name}
        value={title}
        onChange={setTitle}
        maxLength={TITLE_MAX}
        autoFocus={!editing}
        errorMessage={errors.title}
        inputMode="text"
        dir="auto"
      />
      <RadioCards
        label={t.kind}
        value={kind}
        onChange={(value) => {
          setKind(value as CommitmentKind)
        }}
        options={KINDS.map((k) => ({ value: k, label: en.commitments.kinds[k], icon: KindIcon(k) }))}
      />
      <WeekdayPicker label={t.days} value={days} onChange={setDays} errorMessage={errors.days} />
      <div className="grid grid-cols-2 gap-3">
        <TimeField label={t.from} value={start} onChange={setStart} errorMessage={errors.times === undefined || errors.times === t.timesRequired ? errors.times : undefined} />
        <TimeField label={t.to} value={end} onChange={setEnd} errorMessage={errors.times} />
      </div>
      <DatePicker
        label={t.validUntil}
        value={until === '' ? null : parseDate(until)}
        onChange={(value) => {
          setUntil(value === null ? '' : value.toString())
        }}
        errorMessage={errors.date}
      />
      {note === null ? null : (
        <Note tone="warning" role="alert">
          {note}
        </Note>
      )}
    </Dialog>
  )
}
