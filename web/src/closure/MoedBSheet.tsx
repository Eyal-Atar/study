import { parseDate } from '@internationalized/date'
import { useEffect, useRef, useState } from 'react'
import { Form } from 'react-aria-components'
import { Archie } from '../archie/Archie'
import { useToday } from '../exam/api'
import { addDays } from '../exam/dates'
import { dateError, isoOf } from '../exam/examForm'
import { isolate } from '../i18n/bidi'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { CheckboxCards } from '../ui/CheckboxCards'
import { DatePicker } from '../ui/DatePicker'
import { Dialog } from '../ui/Dialog'
import { Note } from '../ui/Note'
import { cx } from '../ui/styles'
import { TextField } from '../ui/TextField'
import { useClosureActions } from './closureActions'
import { validateMoedB, type MoedBDraft, type MoedBErrors } from './moedBForm'
import { moedBDoneStatus, moedBDoneText, moedBShort, useMounted, type MoedBAnswer } from './sheetParts'
import type { ClosureItem, MoedBResult } from './types'

// The Moed B form, the state after it, and the sheet of the exam screen that holds both (S45).
//
// The form lives here and not in MoedBForm.tsx: on a case-insensitive disk (macOS) './MoedBForm'
// resolves to moedBForm.ts, the form's pure checks, and the component would import as undefined.

const m = en.closure.moedB
const MAX_DAYS_AHEAD = 730
const NOTES_MAX = 1000
const EMPTY: MoedBDraft = { date: null, grade: '', topicIds: [], notes: '' }

function without(errors: MoedBErrors, key: keyof MoedBErrors): MoedBErrors {
  return Object.fromEntries(Object.entries(errors).filter(([k]) => k !== key))
}

export interface MoedBFormProps {
  item: ClosureItem
  onDone: (result: MoedBResult, simulations: number) => void
  onPendingChange: (pending: boolean) => void
  // The exam changed in the meantime (409 invalid_state, 404): the action has already said so in a
  // toast, and the sheet closes.
  onStale?: (() => void) | undefined
  // The date field takes the focus when the form appears in place of what was pressed.
  autoFocus?: boolean
}

// No ArchiLead: inside a dialog the title is already Archi's question ("When is Moed B?").
export function MoedBForm({ item, onDone, onPendingChange, onStale, autoFocus = false }: MoedBFormProps) {
  const actions = useClosureActions()
  const { today } = useToday()
  const mounted = useMounted()
  const [draft, setDraft] = useState<MoedBDraft>(EMPTY)
  const [errors, setErrors] = useState<MoedBErrors>({})
  const [general, setGeneral] = useState<string | null>(null)
  const planning = actions.planning(item.exam_id)

  // Only the changes: the sheet starts as not pending.
  const pendingRef = useRef({ last: false, report: onPendingChange })
  useEffect(() => {
    pendingRef.current.report = onPendingChange
  })
  useEffect(() => {
    if (pendingRef.current.last === planning) return
    pendingRef.current.last = planning
    pendingRef.current.report(planning)
  }, [planning])

  const hasTopics = item.topics.length > 0

  function submit() {
    if (planning) return
    const { errors: next, body } = validateMoedB(draft, today)
    setErrors(next)
    setGeneral(null)
    if (body === null) return
    actions.openMoedB(item.exam_id, body, {
      onSuccess: (result, simulations) => {
        if (mounted.current) onDone(result, simulations)
      },
      onError: (failure) => {
        if (!mounted.current) return
        if (failure.kind === 'stale') onStale?.()
        else if (failure.kind === 'fields') setErrors(failure.errors)
        else setGeneral(failure.message)
      },
    })
  }

  return (
    <Form
      aria-label={m.title}
      validationBehavior="aria"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="flex flex-col gap-4"
    >
      <DatePicker
        label={m.date}
        value={draft.date}
        onChange={(date) => {
          setDraft({ ...draft, date })
          const iso = isoOf(date)
          const error = iso === null ? undefined : dateError(iso, today)
          setErrors(error === undefined ? without(errors, 'date') : { ...errors, date: error })
        }}
        minValue={parseDate(addDays(today, 1))}
        maxValue={parseDate(addDays(today, MAX_DAYS_AHEAD))}
        isRequired
        autoFocus={autoFocus}
        isDisabled={planning}
        errorMessage={errors.date}
      />
      <TextField
        label={m.grade}
        description={m.gradeHint}
        inputMode="numeric"
        maxLength={3}
        autoComplete="off"
        value={draft.grade}
        onChange={(grade) => {
          setDraft({ ...draft, grade })
          if (errors.grade !== undefined) setErrors(without(errors, 'grade'))
        }}
        isDisabled={planning}
        errorMessage={errors.grade}
      />
      {hasTopics ? (
        <CheckboxCards
          label={m.hard}
          description={m.hardHint}
          // A topic's name is the student's content: isolated, since a label here is a string.
          options={item.topics.map((t) => ({ value: t.id, label: isolate(t.name) }))}
          columns="grid-cols-1 sm:grid-cols-2"
          value={draft.topicIds}
          onChange={(topicIds) => {
            setDraft({ ...draft, topicIds })
          }}
          isDisabled={planning}
        />
      ) : null}
      <TextField
        label={m.notes}
        description={hasTopics ? m.notesHint : undefined}
        maxLength={NOTES_MAX}
        autoComplete="off"
        value={draft.notes}
        onChange={(notes) => {
          setDraft({ ...draft, notes })
          if (errors.notes !== undefined) setErrors(without(errors, 'notes'))
        }}
        isDisabled={planning}
        errorMessage={errors.notes}
      />
      {general === null ? null : (
        <Note tone="warning" role="alert">
          {general}
        </Note>
      )}
      <Button type="submit" className="w-full" isPending={planning}>
        {planning ? m.submitting : m.submit}
      </Button>
    </Form>
  )
}

// After Moed B was planned: the line when not everything fits, Close, and Undo while it can be undone.
// The sentence itself is the title of the sheet, and its live region says it.
export function MoedBDone({
  answer,
  onClose,
  onUndone,
}: {
  answer: MoedBAnswer
  onClose: () => void
  // The exam is back to waiting for Moed B: the sheet shows an empty form again.
  onUndone: () => void
}) {
  const actions = useClosureActions()
  const mounted = useMounted()
  const [undoError, setUndoError] = useState<string | null>(null)
  const versionId = answer.result.version_id
  const undoing = actions.undoing(versionId)
  return (
    <>
      {moedBShort(answer) ? <p className="text-body text-ink">{m.short}</p> : null}
      {undoError === null ? null : (
        <Note tone="warning" role="alert">
          {undoError}
        </Note>
      )}
      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" autoFocus isDisabled={undoing} onPress={onClose}>
          {en.common.close}
        </Button>
        {undoError === null ? (
          <Button
            variant="quiet"
            isPending={undoing}
            onPress={() => {
              actions.undo(versionId, 'moed_b', {
                onSuccess: () => {
                  if (mounted.current) onUndone()
                },
                onError: ({ message }) => {
                  if (mounted.current) setUndoError(message)
                },
              })
            }}
          >
            {en.common.undo}
          </Button>
        ) : null}
      </div>
    </>
  )
}

// The sheet's one live region: what changed, in words. A notice of its own ("I put … back") is shown
// too; a sentence that is already the title is only said.
export function StatusLine({ text, shown }: { text: string; shown: boolean }) {
  return (
    <p role="status" className={cx(shown && text !== '' ? 'text-small text-ink-muted' : 'sr-only')}>
      {text}
    </p>
  )
}

// Archi standing on the top edge of the sheet, about 110px of him as in FreeTimeSheet.
export function SheetFigure({ mood, bloom = false }: { mood: 'eureka' | 'rest' | 'wisdom' | 'intentions'; bloom?: boolean }) {
  return (
    // data-slot="bloom": the place where S33 puts the illustration of the full bloom in place of
    // Archi's eureka, once an exam closed done. Nothing else hangs on it in S45.
    <div className="w-[118px]" data-slot={bloom ? 'bloom' : undefined}>
      <Archie mood={mood} decorative />
    </div>
  )
}

type MoedBSheetState = { step: 'form'; notice: string | null; round: number } | { step: 'done'; answer: MoedBAnswer; round: number }

// The Moed B form of the exam screen (Task 6): an exam that waits for Moed B.
export function MoedBSheet({ item, onClose }: { item: ClosureItem; onClose: () => void }) {
  const actions = useClosureActions()
  const [state, setState] = useState<MoedBSheetState>({ step: 'form', notice: null, round: 0 })
  const [formPending, setFormPending] = useState(false)
  const busy =
    formPending || actions.planning(item.exam_id) || (state.step === 'done' && actions.undoing(state.answer.result.version_id))
  const title = state.step === 'form' ? m.title : moedBDoneText(state.answer)
  const status =
    state.step === 'form'
      ? (state.notice ?? '')
      : moedBDoneStatus(state.answer)
  return (
    <Dialog
      title={title}
      isOpen
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
      figure={<SheetFigure mood={state.step === 'form' ? 'wisdom' : 'intentions'} />}
    >
      <StatusLine text={status} shown={state.step === 'form'} />
      {state.step === 'form' ? (
        <MoedBForm
          key={state.round}
          item={item}
          autoFocus={state.round > 0}
          onDone={(result, simulations) => {
            setState({ step: 'done', answer: { result, simulations }, round: state.round })
          }}
          onPendingChange={setFormPending}
          onStale={onClose}
        />
      ) : (
        <MoedBDone
          answer={state.answer}
          onClose={onClose}
          onUndone={() => {
            setState({ step: 'form', notice: m.undone(item.exam_name), round: state.round + 1 })
          }}
        />
      )}
    </Dialog>
  )
}
