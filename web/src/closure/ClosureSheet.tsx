import { useEffect, useRef, useState } from 'react'
import { durationText } from '../board/time'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Note } from '../ui/Note'
import { useClosureActions } from './closureActions'
import { MoedBDone, MoedBForm, SheetFigure, StatusLine } from './MoedBSheet'
import { moedBDoneStatus, moedBDoneText, useMounted, type MoedBAnswer } from './sheetParts'
import type { ClosureItem, Outcome } from './types'

// The closure sheet (S45): on the evening of an exam Archi asks how it felt. "Nailed it" closes it
// and puts it in the archive; "Keep open for Moed B" keeps its materials quietly, and "I have the
// date" plans Moed B in the same sheet. Every decision has its Undo here, while the sheet is open.
//
// The sheet is a local state machine:
//   question → after (the decision, its Undo, the next exam) → moedB (the form) → moedBAfter.
// While a request is on its way the sheet cannot be dismissed (plan decision 7). Each new state
// moves the focus to its primary control, since the pressed button has left the tree.

const s = en.closure.sheet
const m = en.closure.moedB

export interface ClosureSheetProps {
  // The exam the sheet opens on.
  examId: string
  // GET /closures pending: the item itself, and the next one after a decision.
  pending: ClosureItem[]
  onClose: () => void
  // Called once for each exam and sitting, when its question first shows (markShown).
  onShown?: ((item: ClosureItem) => void) | undefined
}

type State =
  // held: back from an Undo, before the refetch has put the exam back into pending.
  | { step: 'question'; item: ClosureItem; held: boolean; notice: string | null; focus: boolean }
  | { step: 'after'; item: ClosureItem; outcome: Outcome; versionId: string; undoError: string | null }
  | { step: 'moedB'; item: ClosureItem; notice: string | null; round: number }
  | { step: 'moedBAfter'; item: ClosureItem; answer: MoedBAnswer; round: number }

function question(item: ClosureItem, rest: Partial<Extract<State, { step: 'question' }>> = {}): State {
  return { step: 'question', item, held: false, notice: null, focus: false, ...rest }
}

function statsLine(item: ClosureItem): string | null {
  if (item.tasks_total === 0) return null
  if (item.studied_minutes <= 0) return s.statsNoTime(item.completion_percent)
  return s.stats(durationText(item.studied_minutes), item.completion_percent)
}

export function ClosureSheet({ examId, pending, onClose, onShown }: ClosureSheetProps) {
  const actions = useClosureActions()
  const mounted = useMounted()
  const [state, setState] = useState<State | null>(() => {
    const item = pending.find((i) => i.exam_id === examId)
    return item === undefined ? null : question(item)
  })
  const [chosen, setChosen] = useState<Outcome | null>(null)
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
  useEffect(() => {
    closeRef.current = onClose
    shownRef.current = onShown
  })
  const close = () => {
    if (closed.current) return
    closed.current = true
    closeRef.current()
  }

  // The question shows the item as pending has it now; after a decision the server no longer returns
  // it, so the other states keep their own copy.
  const live = state?.step === 'question' ? pending.find((i) => i.exam_id === state.item.exam_id) : undefined
  useEffect(() => {
    if (state === null) {
      close()
      return
    }
    if (state.step !== 'question') return
    if (live !== undefined) {
      returned.current = true
      return
    }
    // Closed elsewhere, or a refetch let it go. Right after an Undo the exam is not back yet.
    if (!state.held || returned.current) close()
    // close reads refs only.
  }, [state, live])

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
  const closing = actions.closing(item.exam_id)
  const busy =
    closing ||
    formPending ||
    actions.planning(item.exam_id) ||
    (state.step === 'after' && actions.undoing(state.versionId)) ||
    (state.step === 'moedBAfter' && actions.undoing(state.answer.result.version_id))

  function decide(outcome: Outcome) {
    if (closing) return
    setChosen(outcome)
    setError(null)
    actions.close(item, outcome, {
      onSuccess: (result) => {
        if (!mounted.current) return
        setDecided((list) => [...list, item.exam_id])
        setState({ step: 'after', item, outcome, versionId: result.version_id, undoError: null })
      },
      onError: (failure) => {
        if (!mounted.current) return
        if (failure.kind === 'stale') close()
        else setError(failure.message)
      },
    })
  }

  let title: string
  let status: string
  let notice = false
  let figure
  let body
  switch (state.step) {
    case 'question': {
      title = s.title(name)
      status = state.notice ?? ''
      notice = true
      figure = <SheetFigure mood="eureka" />
      const stats = statsLine(item)
      const offersMoedB = item.options.includes('moed_b')
      body = (
        <>
          {stats === null ? null : <p className="text-body text-ink-muted">{stats}</p>}
          {error === null ? null : (
            <Note tone="warning" role="alert">
              {error}
            </Note>
          )}
          <div className="flex flex-col gap-2">
            <Button
              className="w-full"
              autoFocus={state.focus}
              isPending={closing && chosen !== 'moed_b'}
              isDisabled={closing && chosen === 'moed_b'}
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
                isPending={closing && chosen === 'moed_b'}
                isDisabled={closing && chosen !== 'moed_b'}
                onPress={() => {
                  decide('moed_b')
                }}
              >
                {s.keepOpen}
              </Button>
            ) : null}
          </div>
        </>
      )
      break
    }
    case 'after': {
      const { outcome, versionId, undoError } = state
      title = outcome === 'done' ? s.bloomed(name) : s.kept(name)
      status = title
      figure = outcome === 'done' ? <SheetFigure mood="eureka" bloom /> : <SheetFigure mood="rest" />
      const next = pending.find((i) => i.exam_id !== item.exam_id && !decided.includes(i.exam_id))
      const undoing = actions.undoing(versionId)
      body = (
        <>
          {undoError === null ? null : (
            <Note tone="warning" role="alert">
              {undoError}
            </Note>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
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
            {undoError === null ? (
              <Button
                variant="quiet"
                isPending={undoing}
                onPress={() => {
                  actions.undo(versionId, 'close', {
                    onSuccess: () => {
                      if (!mounted.current) return
                      setDecided((list) => list.filter((id) => id !== item.exam_id))
                      setChosen(null)
                      returned.current = false
                      setState(question(item, { held: true, notice: s.undone(item.exam_name), focus: true }))
                    },
                    onError: ({ message }) => {
                      if (!mounted.current) return
                      setState((current) =>
                        current?.step === 'after' && current.versionId === versionId
                          ? { ...current, undoError: message }
                          : current,
                      )
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
      status = state.notice ?? ''
      notice = true
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
