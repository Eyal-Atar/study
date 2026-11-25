import { useEffect, useRef, useState } from 'react'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Note } from '../ui/Note'
import { useToast } from '../ui/useToast'
import { useClosureActions, type CloseFailure } from './closureActions'
import { MoedBDone, MoedBForm, SheetFigure, StatusLine } from './MoedBSheet'
import { moedBDoneStatus, moedBDoneText, statsText, useMounted, type MoedBAnswer } from './sheetParts'
import type { ClosureItem, Outcome } from './types'

// The closure sheet (S45, S45b): on the evening of an exam Archi asks what to do with it now, with
// three answers. "Keep it as a memory" closes it and puts it in the archive; "Keep it open for a
// retake" keeps its materials quietly (Moed A only), and "I have the date" plans the retake in the same
// sheet; "Delete it" deletes the exam, without a confirmation and without a bloom. Every decision has
// its Undo here, while the sheet is open.
//
// The sheet is a local state machine:
//   question → after (the decision, its Undo, the next exam) → moedB (the form) → moedBAfter.
// While a request is on its way the sheet cannot be dismissed (plan decision 7). Each new state
// moves the focus to its primary control, since the pressed button has left the tree.

const s = en.closure.sheet
const m = en.closure.moedB

// The three answers to the question; a delete is not an outcome of a close.
type Choice = Outcome | 'delete'

export interface ClosureSheetProps {
  // The exam the sheet opens on.
  examId: string
  // GET /closures pending: the item itself, and the next one after a decision.
  pending: ClosureItem[]
  onClose: () => void
  // Called once for each exam and sitting, when its question first shows (markShown).
  onShown?: ((item: ClosureItem) => void) | undefined
  // Called when "Delete it" is pressed: the exam screen leaves once the exam is gone, even when the
  // sheet closed first (a 404 closes it before the refetch of the exams).
  onDelete?: ((item: ClosureItem) => void) | undefined
}

type State =
  // held: back from an Undo, before the refetch has put the exam back into pending.
  | { step: 'question'; item: ClosureItem; held: boolean; notice: string | null; focus: boolean }
  // versionId: null only for a delete the server wrote no version for; then there is no Undo.
  | { step: 'after'; item: ClosureItem; outcome: Choice; versionId: string | null; undoError: string | null }
  | { step: 'moedB'; item: ClosureItem; notice: string | null; round: number }
  | { step: 'moedBAfter'; item: ClosureItem; answer: MoedBAnswer; round: number }

function question(item: ClosureItem, rest: Partial<Extract<State, { step: 'question' }>> = {}): State {
  return { step: 'question', item, held: false, notice: null, focus: false, ...rest }
}

export function ClosureSheet({ examId, pending, onClose, onShown, onDelete }: ClosureSheetProps) {
  const actions = useClosureActions()
  const toast = useToast()
  const mounted = useMounted()
  const [state, setState] = useState<State | null>(() => {
    const item = pending.find((i) => i.exam_id === examId)
    return item === undefined ? null : question(item)
  })
  const [chosen, setChosen] = useState<Choice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formPending, setFormPending] = useState(false)
  // The exams decided in this sheet: not offered as "next" while pending still holds them.
  const [decided, setDecided] = useState<string[]>([])
  // After an Undo: whether the refetch has put the exam back into pending yet.
  const returned = useRef(false)

  // onClose at most once, whoever asks first (a stale answer, the refetch, the button).
  const closed = useRef(false)
  const closeRef = useRef(onClose)
  const shownRef = useRef(onShown)
  const toastRef = useRef(toast)
  useEffect(() => {
    closeRef.current = onClose
    shownRef.current = onShown
    toastRef.current = toast
  })
  const close = () => {
    if (closed.current) return
    closed.current = true
    closeRef.current()
  }

  // The question shows the item as pending has it now; after a decision the server no longer returns
  // it, so the other states keep their own copy.
  const live = state?.step === 'question' ? pending.find((i) => i.exam_id === state.item.exam_id) : undefined
  // A refetch (the interval, the window's focus) can answer without the exam once the server has
  // committed and before the close itself answers: the sheet waits for its own answer (decision 7).
  // The same for a delete.
  const inFlight =
    state !== null &&
    (actions.closing(state.item.exam_id) ||
      actions.deleting(state.item.exam_id) ||
      actions.planning(state.item.exam_id) ||
      formPending)
  useEffect(() => {
    if (state === null) {
      close()
      return
    }
    if (state.step !== 'question' || inFlight) return
    if (live !== undefined) {
      returned.current = true
      return
    }
    // Decided elsewhere (another tab), and the refetch let it go: said as a 409 says it (decision 17),
    // not a sheet that vanishes. Right after an Undo the exam is not back yet.
    if (state.held && !returned.current) return
    if (!closed.current) toastRef.current.show({ text: s.stale, tone: 'info' })
    close()
    // close and the toast read refs only.
  }, [state, live, inFlight])

  // onShown once per exam and sitting.
  const shownKeys = useRef(new Set<string>())
  const questionItem = state?.step === 'question' ? state.item : null
  useEffect(() => {
    if (questionItem === null) return
    const key = `${questionItem.exam_id}:${String(questionItem.sitting)}`
    if (shownKeys.current.has(key)) return
    shownKeys.current.add(key)
    shownRef.current?.(questionItem)
  }, [questionItem])

  if (state === null) return null
  const item = live ?? state.item
  const name = item.exam_name
  // A close or a delete of this exam on its way: the question waits for its answer.
  const deciding = actions.closing(item.exam_id) || actions.deleting(item.exam_id)
  const busy =
    deciding ||
    formPending ||
    actions.planning(item.exam_id) ||
    (state.step === 'after' && state.versionId !== null && actions.undoing(state.versionId)) ||
    (state.step === 'moedBAfter' && actions.undoing(state.answer.result.version_id))

  function decide(choice: Choice) {
    if (deciding) return
    setChosen(choice)
    setError(null)
    // Each handler says whether the sheet showed the answer; once it is gone, the action says it in a toast.
    const toAfter = (versionId: string | null) => {
      if (!mounted.current) return false
      setDecided((list) => [...list, item.exam_id])
      setState({ step: 'after', item, outcome: choice, versionId, undoError: null })
      return true
    }
    const failed = (failure: CloseFailure) => {
      if (!mounted.current) return false
      if (failure.kind === 'stale') close()
      else setError(failure.message)
      return true
    }
    if (choice === 'delete') {
      onDelete?.(item)
      actions.remove(item, { onSuccess: toAfter, onError: failed })
    }
    else actions.close(item, choice, { onSuccess: (result) => toAfter(result.version_id), onError: failed })
  }

  let title: string
  let status: string
  let notice = false
  let figure
  let body
  switch (state.step) {
    case 'question': {
      title = s.title(name)
      // A question that came in place of a pressed button (the next exam) says its sentence; the
      // first one is the dialog's name as it opens.
      status = state.notice ?? (state.focus ? title : '')
      notice = state.notice !== null
      figure = <SheetFigure mood="eureka" />
      const stats = statsText(item)
      const offersMoedB = item.options.includes('moed_b')
      body = (
        <>
          {stats === null ? null : <p className="text-body text-ink-muted">{stats}</p>}
          {error === null ? null : (
            <Note tone="warning" role="alert">
              {error}
            </Note>
          )}
          {/* The pressed answer waits; the other two are disabled. */}
          <div className="flex flex-col gap-2">
            <Button
              className="w-full"
              autoFocus={state.focus}
              isPending={deciding && chosen === 'done'}
              isDisabled={deciding && chosen !== 'done'}
              onPress={() => {
                decide('done')
              }}
            >
              {s.nailed}
            </Button>
            {offersMoedB ? (
              <Button
                variant="secondary"
                className="w-full"
                isPending={deciding && chosen === 'moed_b'}
                isDisabled={deciding && chosen !== 'moed_b'}
                onPress={() => {
                  decide('moed_b')
                }}
              >
                {s.keepOpen}
              </Button>
            ) : null}
            <Button
              variant="danger"
              className="w-full"
              isPending={deciding && chosen === 'delete'}
              isDisabled={deciding && chosen !== 'delete'}
              onPress={() => {
                decide('delete')
              }}
            >
              {s.delete}
            </Button>
          </div>
        </>
      )
      break
    }
    case 'after': {
      const { outcome, versionId, undoError } = state
      title = outcome === 'done' ? s.bloomed(name) : outcome === 'moed_b' ? s.kept(name) : s.deleted(name)
      status = title
      // Only "Keep it as a memory" blooms.
      figure = outcome === 'done' ? <SheetFigure mood="eureka" bloom /> : <SheetFigure mood="rest" />
      const next = pending.find((i) => i.exam_id !== item.exam_id && !decided.includes(i.exam_id))
      const undoing = versionId !== null && actions.undoing(versionId)
      body = (
        <>
          {undoError === null ? null : (
            <Note tone="warning" role="alert">
              {undoError}
            </Note>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              // A new key when the Undo fails: the button mounts again with autoFocus, so the focus
              // leaves the Undo that is taken off the tree for the primary, not for the page.
              key={undoError === null ? 'primary' : 'primary-after-undo'}
              className="min-w-0 flex-1"
              autoFocus
              isDisabled={undoing}
              onPress={() => {
                if (next === undefined) close()
                else setState(question(next, { focus: true }))
              }}
            >
              {next === undefined ? en.common.close : <span className="min-w-0 truncate">{s.next(next.exam_name)}</span>}
            </Button>
            {outcome === 'moed_b' ? (
              <Button
                variant="secondary"
                isDisabled={undoing}
                onPress={() => {
                  setState({ step: 'moedB', item, notice: null, round: 0 })
                }}
              >
                {s.haveDate}
              </Button>
            ) : null}
            {undoError === null && versionId !== null ? (
              <Button
                variant="quiet"
                isPending={undoing}
                onPress={() => {
                  // A delete undone puts the exam back as it was, as a close undone does.
                  actions.undo(versionId, outcome === 'delete' ? 'delete' : 'close', item.exam_name, {
                    onSuccess: () => {
                      if (!mounted.current) return false
                      setDecided((list) => list.filter((id) => id !== item.exam_id))
                      setChosen(null)
                      returned.current = false
                      setState(question(item, { held: true, notice: s.undone(item.exam_name), focus: true }))
                      return true
                    },
                    onError: ({ message }) => {
                      if (!mounted.current) return false
                      setState((current) =>
                        current?.step === 'after' && current.versionId === versionId
                          ? { ...current, undoError: message }
                          : current,
                      )
                      return true
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
      break
    }
    case 'moedB': {
      const { round } = state
      title = m.title
      status = state.notice ?? title
      notice = state.notice !== null
      figure = <SheetFigure mood="wisdom" />
      body = (
        <MoedBForm
          key={round}
          item={item}
          autoFocus
          onDone={(result, simulations) => {
            setState({ step: 'moedBAfter', item, answer: { result, simulations }, round })
          }}
          onPendingChange={setFormPending}
          onStale={close}
        />
      )
      break
    }
    case 'moedBAfter': {
      const { answer, round } = state
      title = moedBDoneText(answer)
      status = moedBDoneStatus(answer)
      figure = <SheetFigure mood="intentions" />
      body = (
        <MoedBDone
          answer={answer}
          onClose={close}
          onUndone={() => {
            // The exam is back to waiting for Moed B; the closure itself was not undone.
            setState({ step: 'moedB', item, notice: m.undone(item.exam_name), round: round + 1 })
          }}
        />
      )
      break
    }
  }

  return (
    <Dialog
      title={title}
      isOpen
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open && !busy) close()
      }}
      figure={figure}
    >
      <StatusLine text={status} shown={notice} />
      {body}
    </Dialog>
  )
}
