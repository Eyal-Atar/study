import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { errorMessage } from '../api/client'
import { useMe } from '../api/me'
import { codeText, shortfallText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { useExams, useReplanApply, useReplanPreview } from '../onboarding/api'
import type { ReplanPreview } from '../onboarding/types'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Note } from '../ui/Note'
import { ErrorState, LoadingState } from '../ui/states'
import { useToast } from '../ui/useToast'
import { ReplanOfferContext, type ReplanOfferApi } from './replanOfferContext'

export interface ReplanOfferProps {
  isOpen: boolean
  onClose: () => void
  // Why the replan is offered, shown above the preview.
  reasonText?: string | undefined
  // Called after the new board was written (before onClose).
  onApplied?: () => void
}

// The offer to replan the board: POST /plan/replan {preview: true} when it opens, a summary of what
// would change, and "אישור" that sends {preview: false, basis}. A board that changed in between
// (stale_plan) gets a fresh preview.
// The buttons of ui/Dialog are a prop of it and not its children, and they depend on the preview,
// so the preview cannot live in a child of the dialog. ReplanSession holds it, and gets a new key
// on each opening: it mounts when the offer opens (never before the first opening), so each
// opening previews anew, and it stays through the closing so the dialog can fade out.
export function ReplanOffer({ isOpen, onClose, reasonText, onApplied }: ReplanOfferProps) {
  const [opening, setOpening] = useState(0)
  const [wasOpen, setWasOpen] = useState(false)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) setOpening(opening + 1)
  }
  if (opening === 0) return null
  return <ReplanSession key={opening} isOpen={isOpen} reasonText={reasonText} onClose={onClose} onApplied={onApplied} />
}

function ReplanSession({
  isOpen,
  reasonText,
  onClose,
  onApplied,
}: {
  isOpen: boolean
  reasonText: string | undefined
  onClose: () => void
  onApplied: (() => void) | undefined
}) {
  const preview = useReplanPreview()
  const toast = useToast()
  const apply = useReplanApply({
    onApplied: () => {
      toast.show({ text: he.replan.applied, tone: 'success' })
      onApplied?.()
      onClose()
    },
  })
  const [note, setNote] = useState<string | null>(null)
  const { mutate: runPreview } = preview

  // One preview per opening: the ref survives StrictMode's second effect run.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    runPreview()
  }, [runPreview])

  // The session stays mounted while the dialog fades out, so an answer that arrives after it was
  // closed must not start a preview nobody sees.
  const open = useRef(isOpen)
  useEffect(() => {
    open.current = isOpen
  }, [isOpen])

  function confirm(basis: string) {
    setNote(null)
    apply.mutate(basis, {
      onError: (error) => {
        if (!open.current) return
        if (error.code === 'stale_plan') {
          setNote(codeText('stale_plan'))
          apply.reset()
          runPreview()
        }
      },
    })
  }

  const applyFailed = apply.isError && apply.error.code !== 'stale_plan'
  // Nothing to place, move or report: "אישור" would write nothing, so only closing is offered.
  const empty = preview.isSuccess && isEmpty(preview.data)

  return (
    <Dialog
      title={he.replan.title}
      description={reasonText}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      footer={
        empty ? (
          <Button variant="secondary" onPress={onClose}>
            {he.replan.understood}
          </Button>
        ) : (
          <>
            <Button
              className="flex-1"
              // Disabled until there is a preview to confirm; while the apply is on its way the
              // button keeps its place and shows it.
              isDisabled={!preview.isSuccess}
              isPending={apply.isPending}
              onPress={() => {
                if (preview.data !== undefined) confirm(preview.data.basis)
              }}
            >
              {he.replan.confirm}
            </Button>
            <Button variant="secondary" onPress={onClose}>
              {he.replan.notNow}
            </Button>
          </>
        )
      }
    >
      {note === null ? null : (
        <Note tone="warning" role="status">
          {note}
        </Note>
      )}
      {preview.isPending || preview.isIdle ? <LoadingState shape="text" rows={2} label={he.replan.loading} /> : null}
      {preview.isError ? (
        <ErrorState
          message={errorMessage(preview.error)}
          onRetry={() => {
            runPreview()
          }}
        />
      ) : null}
      {preview.isSuccess ? empty ? <EmptyBoard /> : <PreviewSummary preview={preview.data} /> : null}
      {applyFailed ? (
        <p role="alert" className="text-small text-danger">
          {errorMessage(apply.error)}
        </p>
      ) : null}
    </Dialog>
  )
}

function isEmpty(preview: ReplanPreview): boolean {
  return !preview.changed && preview.added.length === 0 && preview.removed.length === 0 && preview.unscheduled.length === 0
}

// An empty preview during the onboarding means there are no tasks on the board yet (the API needs one
// to end the onboarding); after it, the board simply needs no change.
function EmptyBoard() {
  const me = useMe()
  return <p className="text-body text-ink">{me.data?.onboarding_completed_at === null ? he.replan.nothingToSchedule : he.replan.noChange}</p>
}

function PreviewSummary({ preview }: { preview: ReplanPreview }) {
  const exams = useExams()
  const names = useMemo(() => new Map((exams.data ?? []).map((exam) => [exam.id, exam.name])), [exams.data])
  const examName = (id: string) => names.get(id) ?? he.building.unknownExam

  // The unscheduled tasks have no titles here, so they are counted by reason.
  const byReason = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of preview.unscheduled) counts.set(task.reason, (counts.get(task.reason) ?? 0) + 1)
    return [...counts.entries()]
  }, [preview.unscheduled])

  const nothing = preview.added.length === 0 && preview.removed.length === 0
  return (
    <div className="flex flex-col gap-3">
      {/* What "אישור" would do is the one thing to read here, so it alone is body text in semibold. */}
      {nothing ? (
        <p className="text-body text-ink">{he.replan.noChange}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-body font-semibold text-ink">
          {preview.added.length > 0 ? <li>{he.replan.added(preview.added.length)}</li> : null}
          {preview.removed.length > 0 ? <li>{he.replan.removed(preview.removed.length)}</li> : null}
        </ul>
      )}
      {byReason.length > 0 || preview.shortfalls.length > 0 ? (
        <Note tone="warning" title={he.replan.unscheduledTitle}>
          <ul className="mt-1 flex flex-col gap-1">
            {byReason.map(([reason, count]) => (
              <li key={reason}>{he.replan.unscheduledGroup(count, unscheduledText(reason))}</li>
            ))}
            {preview.shortfalls.map((s) => (
              <li key={s.exam_id}>{shortfallText(examName(s.exam_id), s.minutes, s.daily_minutes)}</li>
            ))}
          </ul>
        </Note>
      ) : null}
      {preview.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 text-small text-ink-muted">
          {preview.warnings.map((code) => (
            <li key={code}>{codeText(code)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// One offer for the whole signed-in app (AppShell): useReplanOffer().offer(reason) opens it.
export function ReplanOfferProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; reasonText: string | undefined }>({
    open: false,
    reasonText: undefined,
  })
  const api = useMemo<ReplanOfferApi>(
    () => ({
      offer: (reasonText) => {
        setState({ open: true, reasonText })
      },
    }),
    [],
  )
  return (
    <ReplanOfferContext value={api}>
      {children}
      <ReplanOffer
        isOpen={state.open}
        reasonText={state.reasonText}
        onClose={() => {
          setState({ open: false, reasonText: undefined })
        }}
      />
    </ReplanOfferContext>
  )
}
