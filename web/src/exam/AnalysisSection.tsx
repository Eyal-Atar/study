import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { errorMessage, type ApiError } from '../api/client'
import { useUserId } from '../api/me'
import { codeText } from '../i18n/codes'
import { he } from '../i18n/he'
import { useGenerate, useJob, useUndo, type GenerateResult, type Job } from '../onboarding/api'
import { useReplanOffer } from '../plan/replanOfferContext'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { CollapsibleSection } from '../ui/CollapsibleSection'
import { Note } from '../ui/Note'
import { ProgressBar } from '../ui/ProgressBar'
import { LoadingState } from '../ui/states'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'
import {
  forgetExamJob,
  hasAiTasks,
  invalidateExamPlan,
  rememberedExamJob,
  rememberExamJob,
  topicsKey,
  useExamTasks,
  useExamTopics,
  useReanalyze,
  type AnalysisApply,
  type ExamJob,
  type ReanalyzeResult,
} from './analysis'
import { AnalysisPreview } from './AnalysisPreview'

const t = he.exam.analysis

export interface AnalysisSectionProps {
  examId: string
}

// Why the job could not give a result: its own error code, or this exam's entry in a generate_plan
// result (the job is done when another exam made it, but this one failed).
interface Failure {
  code: string
  kind: ExamJob['kind']
}

function stageText(stage: string | null | undefined): string {
  if (stage !== null && stage !== undefined && Object.hasOwn(he.building.stages, stage)) {
    return he.building.stages[stage as keyof typeof he.building.stages]
  }
  return t.starting
}

// The exam's analysis (plan decision 12). An exam without live AI tasks gets "בניית תוכנית למבחן"
// (POST /plans/generate, which analyzes exactly such exams and then plans the board). An exam with them
// gets "ניתוח חוזר": the job writes a draft, and nothing changes until the user approves its preview
// (AnalysisPreview). A draft that finished while the user was away waits behind a banner.
// The section is collapsible (S28 decision 2): closed for an exam that already has its plan, and
// open by itself whenever something in it needs the user.
export function AnalysisSection({ examId }: AnalysisSectionProps) {
  const userId = useUserId()
  const queryClient = useQueryClient()
  const toast = useToast()
  const replan = useReplanOffer()
  const tasks = useExamTasks(examId)
  const topics = useExamTopics(examId)
  const generate = useGenerate()
  const reanalyze = useReanalyze(examId)
  const undo = useUndo()

  const [active, setActive] = useState<ExamJob | null>(() => rememberedExamJob(userId, examId))
  // The session can load after the first render: read the remembered job once the user is known
  // (state adjusted while rendering, React's pattern for state that follows a prop).
  const [jobOwner, setJobOwner] = useState(userId)
  if (jobOwner !== userId) {
    setJobOwner(userId)
    setActive(rememberedExamJob(userId, examId))
  }
  // A draft the user opened from the banner, and the job whose draft was already closed.
  const [chosenDraft, setChosenDraft] = useState<string | null>(null)
  const [closedJob, setClosedJob] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const job = useJob<GenerateResult | ReanalyzeResult>(active?.jobId ?? null)

  // Everything about the job is derived from its answer; the effects below only touch the outside
  // (storage, the cache, the toast).
  const jobGone = job.isError && job.error.code === 'not_found'
  const data = active !== null && job.data?.id === active.jobId ? job.data : undefined
  const finished = data !== undefined && (data.status === 'done' || data.status === 'failed') ? data : undefined
  const following = active !== null && !jobGone && finished === undefined
  const starting = generate.isPending || reanalyze.isPending

  let failure: Failure | null = null
  let jobDraft: string | null = null
  if (active !== null && finished !== undefined && !starting) {
    if (finished.status === 'failed') {
      failure = { code: finished.error ?? '', kind: active.kind }
    } else if (active.kind === 'reanalyze') {
      jobDraft = (finished as Job<ReanalyzeResult>).result?.analysis_id ?? null
    } else {
      const mine = (finished as Job<GenerateResult>).result?.exams.find((exam) => exam.exam_id === examId)
      if (mine?.status === 'failed') failure = { code: mine.error ?? '', kind: 'generate' }
    }
  }
  const previewId = chosenDraft ?? (jobDraft !== null && closedJob !== active?.jobId ? jobDraft : null)

  function start(kind: ExamJob['kind']) {
    setGone(false)
    setChosenDraft(null)
    generate.reset()
    reanalyze.reset()
    const mutation = kind === 'generate' ? generate : reanalyze
    mutation.mutate(undefined, {
      onSuccess: (answer) => {
        const next = { jobId: answer.job_id, kind }
        rememberExamJob(userId, examId, next)
        setActive(next)
      },
    })
  }

  // A finished job is handled once (StrictMode runs effects twice, and a reload can find it done).
  const handled = useRef(new Set<string>())
  useEffect(() => {
    if (active === null || finished === undefined || handled.current.has(finished.id)) return
    handled.current.add(finished.id)
    forgetExamJob(userId, examId)
    if (finished.status === 'failed') return
    if (active.kind === 'reanalyze') {
      // The draft is in the topics answer now too (draft_analysis_id), for the banner.
      void queryClient.invalidateQueries({ queryKey: topicsKey(userId, examId) })
      return
    }
    void invalidateExamPlan(queryClient, userId, examId)
    const mine = (finished as Job<GenerateResult>).result?.exams.find((exam) => exam.exam_id === examId)
    if (mine?.status !== 'failed') toast.show({ text: t.built, tone: 'success' })
  }, [active, finished, userId, examId, queryClient, toast])

  // A remembered job the API no longer knows (404): forget it, and the buttons come back.
  useEffect(() => {
    if (jobGone) forgetExamJob(userId, examId)
  }, [jobGone, userId, examId])

  function closePreview() {
    setChosenDraft(null)
    if (active !== null) setClosedJob(active.jobId)
  }

  function applied(answer: AnalysisApply) {
    const versionId = answer.version_id
    toast.show({
      text: t.applied,
      tone: 'success',
      timeoutMs: UNDO_TIMEOUT_MS,
      ...(versionId === null
        ? {}
        : {
            action: {
              label: he.common.undo,
              onAction: () => {
                // mutateAsync, not mutate's callbacks: they would not run once the screen is gone.
                undo.mutateAsync(versionId).then(
                  () => {
                    void invalidateExamPlan(queryClient, userId, examId)
                    toast.show({ text: t.undone })
                  },
                  (error: unknown) => {
                    toast.show({ text: errorMessage(error), tone: 'error' })
                  },
                )
              },
            },
          }),
    })
  }

  function draftGone() {
    closePreview()
    setGone(true)
    void queryClient.invalidateQueries({ queryKey: topicsKey(userId, examId) })
  }

  const preview = (
    <AnalysisPreview
      analysisId={previewId}
      examId={examId}
      onClose={closePreview}
      onApplied={applied}
      onGone={draftGone}
    />
  )

  let body: ReactNode
  if (tasks.isPending || (!following && topics.isPending)) {
    body = <LoadingState shape="text" rows={2} />
  } else if (tasks.isError) {
    body = (
      <Problem
        text={errorMessage(tasks.error)}
        action={
          <Button variant="secondary" onPress={() => void tasks.refetch()}>
            {he.common.retry}
          </Button>
        }
      />
    )
  } else if (following && job.isError) {
    body = (
      <Problem
        text={errorMessage(job.error)}
        action={
          <Button variant="secondary" onPress={() => void job.refetch()}>
            {he.common.retry}
          </Button>
        }
      />
    )
  } else if (following) {
    body = <Progress percent={job.data?.percent ?? 0} text={stageText(job.data?.stage)} />
  } else {
    const analyzed = hasAiTasks(tasks.data)
    const kind: ExamJob['kind'] = analyzed ? 'reanalyze' : 'generate'
    const mutation = analyzed ? reanalyze : generate
    const draft = topics.data?.draft_analysis_id ?? null
    body = (
      <div className="flex flex-col items-start gap-4">
        {gone ? (
          <Note tone="warning" role="alert">
            {t.draftGone}
          </Note>
        ) : null}
        {draft === null ? null : (
          <Card title={t.draftWaiting} titleLevel={3} className="flex flex-col items-start self-stretch">
            <p className="mb-3 text-small text-ink-muted">{t.draftHint}</p>
            <Button
              onPress={() => {
                setGone(false)
                setChosenDraft(draft)
              }}
            >
              {t.showDraft}
            </Button>
          </Card>
        )}
        <p className="max-w-prose text-small text-ink-muted">{analyzed ? t.reanalyzeIntro : t.buildIntro}</p>
        {failure === null ? null : (
          <Problem
            title={t.failedTitle}
            text={codeText(failure.code)}
            action={
              <Button
                variant="secondary"
                onPress={() => {
                  start(failure.kind)
                }}
              >
                {he.common.retry}
              </Button>
            }
          />
        )}
        {mutation.isError ? (
          <StartError
            error={mutation.error}
            onReplan={() => {
              replan.offer(t.replanReason)
            }}
          />
        ) : null}
        {/* With a draft waiting, "הצגת השינוי" is the one primary button of the section. */}
        <Button
          variant={draft === null ? 'primary' : 'secondary'}
          isPending={mutation.isPending}
          onPress={() => {
            start(kind)
          }}
        >
          {analyzed ? t.reanalyze : t.build}
        </Button>
      </div>
    )
  }

  const analyzed = tasks.isSuccess && hasAiTasks(tasks.data)
  const draftWaiting = (topics.data?.draft_analysis_id ?? null) !== null
  const running = following || starting
  // Why the section may not stay closed: each reason is something the user has to see or act on.
  // An exam without a plan is one of them, because building it is the main action of the screen.
  const reasons = [
    tasks.isSuccess && !analyzed ? 'no-plan' : null,
    tasks.isError ? 'tasks-error' : null,
    running ? 'running' : null,
    failure !== null ? 'failed' : null,
    tasks.isSuccess && (analyzed ? reanalyze : generate).isError ? 'start-error' : null,
    gone ? 'gone' : null,
    draftWaiting ? 'draft' : null,
  ]
    .filter((reason) => reason !== null)
    .join(' ')
  const needsAttention = reasons !== ''
  // The user's own choice wins over the default, until a reason that was not there when they chose
  // appears: a section they closed while the job ran opens again when the job fails or its draft
  // arrives (state adjusted while rendering, as above).
  const [userChoice, setUserChoice] = useState<boolean | null>(null)
  const [seenReasons, setSeenReasons] = useState(reasons)
  if (seenReasons !== reasons) {
    setSeenReasons(reasons)
    const seen = seenReasons.split(' ')
    if (userChoice === false && reasons.split(' ').some((reason) => reason !== '' && !seen.includes(reason))) setUserChoice(null)
  }

  return (
    <>
      <CollapsibleSection
        title={analyzed ? t.title : t.buildTitle}
        summary={running ? t.summaryRunning : failure !== null ? t.summaryFailed : draftWaiting ? t.summaryDraft : undefined}
        isExpanded={userChoice ?? needsAttention}
        onExpandedChange={setUserChoice}
      >
        {body}
      </CollapsibleSection>
      {/* Outside the panel: the dialog does not depend on the section being open. */}
      {preview}
    </>
  )
}

// A start the API refused: the quota (with its reset time), nothing to analyze (a replan instead),
// an exam in the past, or anything else.
function StartError({ error, onReplan }: { error: ApiError; onReplan: () => void }) {
  return (
    <Problem
      text={errorMessage(error)}
      action={
        error.code === 'nothing_to_analyze' ? (
          <Button variant="secondary" onPress={onReplan}>
            {t.replan}
          </Button>
        ) : undefined
      }
    />
  )
}

// The stage is the label of the bar. The live region announces a new stage (and the new
// percentage) politely, as the paragraph under the old bar did.
function Progress({ percent, text }: { percent: number; text: string }) {
  return (
    <div aria-live="polite">
      <ProgressBar label={text} value={percent} />
    </div>
  )
}

function Problem({ title, text, action }: { title?: string; text: string; action?: ReactNode }) {
  return (
    <Card tone="danger" role="alert" title={title} titleLevel={3} className="self-stretch">
      <p className="text-small break-words">{text}</p>
      {action === undefined ? null : <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
    </Card>
  )
}
