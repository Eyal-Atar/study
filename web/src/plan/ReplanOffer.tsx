import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { errorMessage } from '../api/client'
import { useMe } from '../api/me'
import { codeText, shortfallText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { useExams, useReplanApply, useReplanPreview } from '../onboarding/api'
import type { ReplanPreview } from '../onboarding/types'
import { Button } from '../ui/Button'
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
// (stale_plan) gets a fresh preview. The content mounts only while open, so each opening previews anew.
export function ReplanOffer({ isOpen, onClose, reasonText, onApplied }: ReplanOfferProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      isDismissable
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
    >
      <Modal className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl outline-none sm:rounded-2xl">
        <Dialog className="outline-none">
          <ReplanContent reasonText={reasonText} onClose={onClose} onApplied={onApplied} />
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

function ReplanContent({
  reasonText,
  onClose,
  onApplied,
}: {
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

  function confirm(basis: string) {
    setNote(null)
    apply.mutate(basis, {
      onError: (error) => {
        if (error.code === 'stale_plan') {
          setNote(codeText('stale_plan'))
          apply.reset()
          runPreview()
        }
      },
    })
  }

  const busy = preview.isPending || apply.isPending
  const applyFailed = apply.isError && apply.error.code !== 'stale_plan'
  // Nothing to place, move or report: "אישור" would write nothing, so only closing is offered.
  const empty = preview.isSuccess && isEmpty(preview.data)

  return (
    <div className="flex flex-col gap-4">
      <Heading slot="title" className="text-xl font-bold">
        {he.replan.title}
      </Heading>
      {reasonText === undefined ? null : <p className="text-ink-muted">{reasonText}</p>}
      {note === null ? null : (
        <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          {note}
        </p>
      )}
      {preview.isPending || preview.isIdle ? (
        <p role="status" className="text-ink-muted">
          {he.replan.loading}
        </p>
      ) : null}
      {preview.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-danger">
            {errorMessage(preview.error)}
          </p>
          <Button
            variant="secondary"
            onPress={() => {
              runPreview()
            }}
          >
            {he.common.retry}
          </Button>
        </div>
      ) : null}
      {preview.isSuccess ? empty ? <EmptyBoard /> : <PreviewSummary preview={preview.data} /> : null}
      {applyFailed ? (
        <p role="alert" className="text-danger">
          {errorMessage(apply.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-2">
        {empty ? null : (
          <Button
            isDisabled={busy || !preview.isSuccess}
            onPress={() => {
              if (preview.data !== undefined) confirm(preview.data.basis)
            }}
          >
            {he.replan.confirm}
          </Button>
        )}
        <Button variant="secondary" onPress={onClose}>
          {empty ? he.common.close : he.replan.notNow}
        </Button>
      </div>
    </div>
  )
}

function isEmpty(preview: ReplanPreview): boolean {
  return !preview.changed && preview.added.length === 0 && preview.removed.length === 0 && preview.unscheduled.length === 0
}

// An empty preview during the onboarding means there are no tasks on the board yet (the API needs one
// to end the onboarding); after it, the board simply needs no change.
function EmptyBoard() {
  const me = useMe()
  return <p>{me.data?.onboarding_completed_at === null ? he.replan.nothingToSchedule : he.replan.noChange}</p>
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
      {nothing ? (
        <p>{he.replan.noChange}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {preview.added.length > 0 ? <li>{he.replan.added(preview.added.length)}</li> : null}
          {preview.removed.length > 0 ? <li>{he.replan.removed(preview.removed.length)}</li> : null}
        </ul>
      )}
      {byReason.length > 0 || preview.shortfalls.length > 0 ? (
        <Section title={he.replan.unscheduledTitle}>
          {byReason.map(([reason, count]) => (
            <li key={reason}>{he.replan.unscheduledGroup(count, unscheduledText(reason))}</li>
          ))}
          {preview.shortfalls.map((s) => (
            <li key={s.exam_id}>{shortfallText(examName(s.exam_id), s.minutes, s.daily_minutes)}</li>
          ))}
        </Section>
      ) : null}
      {preview.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-ink-muted">
          {preview.warnings.map((code) => (
            <li key={code}>{codeText(code)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-warning-soft px-3 py-2">
      <h3 className="text-sm font-bold">{title}</h3>
      <ul className="mt-1 flex flex-col gap-1 text-sm">{children}</ul>
    </section>
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
