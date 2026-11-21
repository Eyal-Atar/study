import { useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage } from '../api/client'
import { codeText, shortfallText, unscheduledText } from '../i18n/codes'
import { en } from '../i18n/en'
import { useExams } from '../onboarding/api'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { List, ListRow } from '../ui/List'
import { Note } from '../ui/Note'
import { SectionHeading } from '../ui/SectionHeading'
import { ErrorState, LoadingState } from '../ui/states'
import { useAnalysisPreview, useApplyAnalysis, type AnalysisApply } from './analysis'

const t = en.exam.analysis

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
// that sends {preview: false, basis}.
// The footer of ui/Dialog needs the state of the preview, so the component that owns that state
// (PreviewDialog) renders the Dialog itself. It is keyed by the opening, so each opening previews
// anew, and it stays mounted after the dialog closed (until the next opening replaces it), so the
// dialog can fade out with its content and return the focus to what opened it.
export function AnalysisPreview({ analysisId, examId, onClose, onApplied, onGone }: AnalysisPreviewProps) {
  // The last draft that was opened, and how many openings there were (state adjusted while
  // rendering: it follows the prop).
  const [opening, setOpening] = useState({ prop: analysisId, id: analysisId, count: 0 })
  if (opening.prop !== analysisId) {
    setOpening({ prop: analysisId, id: analysisId ?? opening.id, count: analysisId === null ? opening.count : opening.count + 1 })
  }
  if (opening.id === null) return null
  return (
    <PreviewDialog
      key={opening.count}
      analysisId={opening.id}
      isOpen={analysisId !== null}
      examId={examId}
      onClose={onClose}
      onApplied={onApplied}
      onGone={onGone}
    />
  )
}

function PreviewDialog({
  analysisId,
  isOpen,
  examId,
  onClose,
  onApplied,
  onGone,
}: {
  analysisId: string
  isOpen: boolean
  examId: string
  onClose: () => void
  onApplied: (answer: AnalysisApply) => void
  onGone: () => void
}) {
  const preview = useAnalysisPreview(analysisId)
  const apply = useApplyAnalysis(analysisId, examId)
  const [note, setNote] = useState<string | null>(null)
  const { mutate: runPreview } = preview

  // An answer that arrives after the dialog closed is dropped, as it was when closing unmounted
  // the content: no toast and no "the draft is gone" for a dialog the user already left. (The
  // refresh after an apply is in the hook, and runs either way.)
  const open = useRef(isOpen)
  useEffect(() => {
    open.current = isOpen
  }, [isOpen])

  // One preview per opening: the ref survives StrictMode's second effect run.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    runPreview(undefined, {
      onError: (error) => {
        if (open.current && error.code === 'invalid_state') onGone()
      },
    })
  }, [runPreview, onGone])

  function again() {
    runPreview(undefined, {
      onError: (error) => {
        if (open.current && error.code === 'invalid_state') onGone()
      },
    })
  }

  function confirm(basis: string) {
    setNote(null)
    apply.mutate(basis, {
      onSuccess: (answer) => {
        if (!open.current) return
        onApplied(answer)
        onClose()
      },
      onError: (error) => {
        if (!open.current) return
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

  const applyFailed = apply.isError && apply.error.code !== 'stale_plan' && apply.error.code !== 'invalid_state'

  return (
    <Dialog
      title={t.previewTitle}
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      footer={
        <>
          <Button
            className="flex-1"
            isPending={apply.isPending}
            isDisabled={!preview.isSuccess}
            onPress={() => {
              if (preview.data !== undefined) confirm(preview.data.basis)
            }}
          >
            {en.replan.confirm}
          </Button>
          <Button variant="secondary" onPress={onClose}>
            {en.replan.notNow}
          </Button>
        </>
      }
    >
      {note === null ? null : (
        <Note tone="warning" role="status">
          {note}
        </Note>
      )}
      {preview.isPending || preview.isIdle ? <LoadingState shape="text" label={t.previewLoading} /> : null}
      {preview.isError && preview.error.code !== 'invalid_state' ? (
        <ErrorState message={errorMessage(preview.error)} onRetry={again} />
      ) : null}
      {preview.isSuccess ? <Summary preview={preview.data} /> : null}
      {applyFailed ? (
        <p role="alert" className="text-small text-danger">
          {errorMessage(apply.error)}
        </p>
      ) : null}
    </Dialog>
  )
}

function Summary({ preview }: { preview: AnalysisApply }) {
  const exams = useExams()
  const examName = (id: string) => exams.data?.find((exam) => exam.id === id)?.name ?? en.building.unknownExam

  // Like ReplanOffer: the tasks that do not fit are counted by reason.
  const byReason = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of preview.unscheduled) counts.set(task.reason, (counts.get(task.reason) ?? 0) + 1)
    return [...counts.entries()]
  }, [preview.unscheduled])

  const blocksChange = preview.added_blocks.length > 0 || preview.removed_blocks.length > 0
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col">
        <SectionHeading level={3}>{t.added(preview.added.length)}</SectionHeading>
        {preview.added.length === 0 ? null : (
          <List aria-label={t.addedListLabel}>
            {preview.added.map((task) => (
              <ListRow
                key={task.task_id}
                title={<bdi>{task.title}</bdi>}
                subtitle={
                  <>
                    <p>{t.taskMeta(en.exam.tasks.kinds[task.kind], en.exam.tasks.minutes(task.minutes))}</p>
                    {/* Why the analysis added it: ink, so it reads as a sentence and not as a detail. */}
                    {task.reason === null || task.reason === '' ? null : <p className="text-ink">{task.reason}</p>}
                  </>
                }
              />
            ))}
          </List>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeading level={3}>{t.replaced(preview.replaced.length)}</SectionHeading>
        {preview.replaced.length === 0 ? null : (
          <ul aria-label={t.replacedListLabel} className="flex list-disc flex-col gap-1 ps-5 text-small break-words text-ink">
            {preview.replaced.map((task) => (
              <li key={task.id}>
                <bdi>{task.title}</bdi>
              </li>
            ))}
          </ul>
        )}
        <p className="text-small text-ink-muted">{t.kept(preview.kept)}</p>
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeading level={3}>{t.boardTitle}</SectionHeading>
        {blocksChange ? (
          <ul className="flex flex-col gap-1 text-small text-ink">
            {preview.added_blocks.length > 0 ? <li>{en.replan.added(preview.added_blocks.length)}</li> : null}
            {preview.removed_blocks.length > 0 ? <li>{en.replan.removed(preview.removed_blocks.length)}</li> : null}
          </ul>
        ) : (
          <p className="text-small text-ink-muted">{t.noBoardChange}</p>
        )}
      </section>

      {byReason.length > 0 || preview.shortfalls.length > 0 ? (
        <Note tone="warning">
          <h3 className="font-semibold">{en.replan.unscheduledTitle}</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {byReason.map(([reason, count]) => (
              <li key={reason}>{en.replan.unscheduledGroup(count, unscheduledText(reason))}</li>
            ))}
            {preview.shortfalls.map((s) => (
              <li key={s.exam_id}>{shortfallText(examName(s.exam_id), s.minutes, s.daily_minutes)}</li>
            ))}
          </ul>
        </Note>
      ) : null}
    </div>
  )
}
