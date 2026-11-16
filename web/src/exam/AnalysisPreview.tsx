import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { errorMessage } from '../api/client'
import { codeText, shortfallText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { useExams } from '../onboarding/api'
import { Button } from '../ui/Button'
import { useAnalysisPreview, useApplyAnalysis, type AnalysisApply } from './analysis'

const t = he.exam.analysis

export interface AnalysisPreviewProps {
  // The draft to preview; null keeps the dialog closed.
  analysisId: string | null
  examId: string
  // Closes without writing: the draft stays, and the section's banner can open it again.
  onClose: () => void
  // The draft was applied (before onClose). The answer's version_id is what "בטל" takes back.
  onApplied: (answer: AnalysisApply) => void
  // The draft is no longer current (applied, superseded or undone: 409 invalid_state).
  onGone: () => void
}

// The draft of a reanalysis before it replaces anything, mirroring ReplanOffer: POST
// /analyses/{id}/apply {preview: true} when it opens, what is replaced, kept and added, and "אישור"
// that sends {preview: false, basis}. The content mounts only while open (keyed by the draft), so each
// opening previews anew.
export function AnalysisPreview({ analysisId, examId, onClose, onApplied, onGone }: AnalysisPreviewProps) {
  return (
    <ModalOverlay
      isOpen={analysisId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      isDismissable
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
    >
      <Modal className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl outline-none sm:rounded-2xl">
        <Dialog className="outline-none">
          {analysisId === null ? null : (
            <PreviewContent
              key={analysisId}
              analysisId={analysisId}
              examId={examId}
              onClose={onClose}
              onApplied={onApplied}
              onGone={onGone}
            />
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

function PreviewContent({
  analysisId,
  examId,
  onClose,
  onApplied,
  onGone,
}: {
  analysisId: string
  examId: string
  onClose: () => void
  onApplied: (answer: AnalysisApply) => void
  onGone: () => void
}) {
  const preview = useAnalysisPreview(analysisId)
  const apply = useApplyAnalysis(analysisId, examId)
  const [note, setNote] = useState<string | null>(null)
  const { mutate: runPreview } = preview

  // One preview per opening: the ref survives StrictMode's second effect run.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    runPreview(undefined, {
      onError: (error) => {
        if (error.code === 'invalid_state') onGone()
      },
    })
  }, [runPreview, onGone])

  function again() {
    runPreview(undefined, {
      onError: (error) => {
        if (error.code === 'invalid_state') onGone()
      },
    })
  }

  function confirm(basis: string) {
    setNote(null)
    apply.mutate(basis, {
      onSuccess: (answer) => {
        onApplied(answer)
        onClose()
      },
      onError: (error) => {
        if (error.code === 'stale_plan') {
          // The board changed since the preview: show the fresh one, and say why it changed.
          setNote(codeText('stale_plan'))
          apply.reset()
          again()
        } else if (error.code === 'invalid_state') {
          onGone()
        }
      },
    })
  }

  const busy = preview.isPending || apply.isPending
  const applyFailed = apply.isError && apply.error.code !== 'stale_plan' && apply.error.code !== 'invalid_state'

  return (
    <div className="flex flex-col gap-4">
      <Heading slot="title" className="text-xl font-bold">
        {t.previewTitle}
      </Heading>
      {note === null ? null : (
        <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          {note}
        </p>
      )}
      {preview.isPending || preview.isIdle ? (
        <p role="status" className="text-ink-muted">
          {t.previewLoading}
        </p>
      ) : null}
      {preview.isError && preview.error.code !== 'invalid_state' ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-danger">
            {errorMessage(preview.error)}
          </p>
          <Button variant="secondary" onPress={again}>
            {he.common.retry}
          </Button>
        </div>
      ) : null}
      {preview.isSuccess ? <Summary preview={preview.data} /> : null}
      {applyFailed ? (
        <p role="alert" className="text-danger">
          {errorMessage(apply.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          isDisabled={busy || !preview.isSuccess}
          onPress={() => {
            if (preview.data !== undefined) confirm(preview.data.basis)
          }}
        >
          {he.replan.confirm}
        </Button>
        <Button variant="secondary" onPress={onClose}>
          {he.replan.notNow}
        </Button>
      </div>
    </div>
  )
}

function Summary({ preview }: { preview: AnalysisApply }) {
  const exams = useExams()
  const examName = (id: string) => exams.data?.find((exam) => exam.id === id)?.name ?? he.building.unknownExam

  // Like ReplanOffer: the tasks that do not fit are counted by reason.
  const byReason = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of preview.unscheduled) counts.set(task.reason, (counts.get(task.reason) ?? 0) + 1)
    return [...counts.entries()]
  }, [preview.unscheduled])

  const blocksChange = preview.added_blocks.length > 0 || preview.removed_blocks.length > 0
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="font-bold">{t.added(preview.added.length)}</h3>
        {preview.added.length === 0 ? null : (
          <ul aria-label={t.addedListLabel} className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {preview.added.map((task) => (
              <li key={task.task_id} className="flex flex-col gap-0.5 px-3 py-2">
                <p className="font-medium text-ink">
                  <bdi>{task.title}</bdi>
                </p>
                <p className="text-sm text-ink-muted">
                  {t.taskMeta(he.exam.tasks.kinds[task.kind], he.exam.tasks.minutes(task.minutes))}
                </p>
                {task.reason === null || task.reason === '' ? null : (
                  <p className="text-sm text-ink">{task.reason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-bold">{t.replaced(preview.replaced.length)}</h3>
        {preview.replaced.length === 0 ? null : (
          <ul aria-label={t.replacedListLabel} className="flex flex-col gap-1 ps-4 text-sm text-ink-muted [list-style:disc]">
            {preview.replaced.map((task) => (
              <li key={task.id}>
                <bdi>{task.title}</bdi>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-ink-muted">{t.kept(preview.kept)}</p>
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="font-bold">{t.boardTitle}</h3>
        {blocksChange ? (
          <ul className="flex flex-col gap-1 text-sm">
            {preview.added_blocks.length > 0 ? <li>{he.replan.added(preview.added_blocks.length)}</li> : null}
            {preview.removed_blocks.length > 0 ? <li>{he.replan.removed(preview.removed_blocks.length)}</li> : null}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">{t.noBoardChange}</p>
        )}
      </section>

      {byReason.length > 0 || preview.shortfalls.length > 0 ? (
        <Report title={he.replan.unscheduledTitle}>
          {byReason.map(([reason, count]) => (
            <li key={reason}>{he.replan.unscheduledGroup(count, unscheduledText(reason))}</li>
          ))}
          {preview.shortfalls.map((s) => (
            <li key={s.exam_id}>{shortfallText(examName(s.exam_id), s.minutes, s.daily_minutes)}</li>
          ))}
        </Report>
      ) : null}
    </div>
  )
}

function Report({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-warning-soft px-3 py-2">
      <h3 className="text-sm font-bold">{title}</h3>
      <ul className="mt-1 flex flex-col gap-1 text-sm">{children}</ul>
    </section>
  )
}
