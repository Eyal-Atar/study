import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ProgressBar } from 'react-aria-components'
import { useNavigate, useSearchParams } from 'react-router'
import { useApi } from '../api/ApiContext'
import { errorMessage, type ApiError } from '../api/client'
import { meKey, useUserId } from '../api/me'
import { codeText, shortfallText } from '../i18n/codes'
import { he } from '../i18n/he'
import { ReplanOffer } from '../plan/ReplanOffer'
import { Button } from '../ui/Button'
import { forgetJob, rememberJob } from './activeJob'
import { materialsKey, POLL_INTERVAL_MS, useExams, useGenerate, useJob } from './api'
import { OnboardingLayout } from './OnboardingLayout'
import { STEP_PATHS } from './steps'
import type { Exam, GenerateResult, Job, Material } from './types'

// A failed job of the account (no credit, no key) stops before every exam, but an exam analyzed
// before it has tasks: they can still go on the board.
const ACCOUNT_FAILURES = new Set(['ai_no_credit', 'ai_not_configured'])

function ingesting(materials: Material[] | undefined): boolean {
  return materials?.some((m) => m.ingest_status === 'queued' || m.ingest_status === 'processing') ?? false
}

// True once every material of every exam is ready or failed. The worker can wait by itself
// (materials_processing), but its retry waits 30 and 60 seconds, and the web sees the materials every
// 2 seconds. A list that fails to load does not block: the worker still waits for it.
function useMaterialsSettled(exams: Exam[] | undefined, examsDone: boolean): boolean {
  const api = useApi()
  const userId = useUserId()
  const settled = useQueries({
    queries: (exams ?? []).map((exam) => ({
      queryKey: materialsKey(userId, exam.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Material[]>(`/exams/${exam.id}/materials`, { signal }),
      enabled: userId !== null,
      refetchInterval: (query: { state: { data: Material[] | undefined } }) =>
        ingesting(query.state.data) ? POLL_INTERVAL_MS : false,
    })),
    combine: (results) => results.every((r) => r.isError || (r.isSuccess && !ingesting(r.data))),
  })
  return examsDone && settled
}

function stageText(job: Job<GenerateResult> | undefined): string {
  const stage = job?.stage
  if (stage !== null && stage !== undefined && Object.hasOwn(he.building.stages, stage)) {
    return he.building.stages[stage as keyof typeof he.building.stages]
  }
  return he.building.starting
}

// Step 4: waits for the materials, starts generate_plan once, and follows the job until it is done.
// The job id goes into the URL (?job=), so a refresh follows the same job instead of starting one.
export function BuildingStep() {
  const [params, setParams] = useSearchParams()
  const jobId = params.get('job')
  const exams = useExams()
  // With ?job= the job is already running: nothing to wait for.
  const settled = useMaterialsSettled(jobId === null ? exams.data : undefined, !exams.isPending)
  const generate = useGenerate()
  const job = useJob(jobId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const userId = useUserId()
  const [replanOpen, setReplanOpen] = useState(false)

  const { mutate: runGenerate } = generate
  const examList = exams.data
  const start = useCallback(() => {
    runGenerate(undefined, {
      onSuccess: (answer) => {
        setParams({ job: answer.job_id }, { replace: true })
      },
      onError: (error) => {
        if (error.code !== 'nothing_to_analyze') return
        // No live exam: there is nothing to schedule either, so back to adding one.
        if (examList?.length === 0) void navigate(STEP_PATHS.exams, { replace: true })
        else setReplanOpen(true)
      },
    })
  }, [runGenerate, setParams, examList, navigate])

  // One POST per visit: the ref survives StrictMode's second effect run (and the API returns the
  // active job anyway, created: false).
  const started = useRef(false)
  useEffect(() => {
    if (jobId !== null || !settled || started.current) return
    started.current = true
    start()
  }, [jobId, settled, start])

  // The worker wrote onboarding_completed_at with the plan: me is stale now.
  const status = job.data?.status
  useEffect(() => {
    if (status === 'done') void queryClient.invalidateQueries({ queryKey: meKey(userId) })
  }, [status, queryClient, userId])

  // A running job is remembered for this user, so the gate brings a student who comes back to it;
  // a finished one is forgotten (done ends the onboarding, failed starts over from the steps).
  const jobGone = job.isError && job.error.code === 'not_found'
  useEffect(() => {
    if (jobId === null) return
    if (status === 'done' || status === 'failed' || jobGone) forgetJob(userId)
    else rememberJob(userId, jobId)
  }, [jobId, status, jobGone, userId])

  // A ?job= the API does not know (another user's link, or an old one): drop it, and the normal flow
  // waits for the materials and starts a job.
  useEffect(() => {
    if (!jobGone) return
    started.current = false
    setParams({}, { replace: true })
  }, [jobGone, setParams])

  const back = (
    <Button
      variant="secondary"
      onPress={() => {
        void navigate(STEP_PATHS.schedule)
      }}
    >
      {he.common.back}
    </Button>
  )

  const names = useMemo(() => new Map((exams.data ?? []).map((exam) => [exam.id, exam.name])), [exams.data])
  const examName = (id: string) => names.get(id) ?? he.building.unknownExam

  async function toToday() {
    await queryClient.refetchQueries({ queryKey: meKey(userId) })
    await navigate('/today')
  }

  const replan = (
    <ReplanOffer
      isOpen={replanOpen}
      reasonText={he.building.replanReason}
      onClose={() => {
        setReplanOpen(false)
      }}
      onApplied={() => {
        void toToday()
      }}
    />
  )

  let body
  if (generate.isError) {
    body = (
      <GenerateFailure
        error={generate.error}
        onRetry={start}
        onReplan={() => {
          setReplanOpen(true)
        }}
        back={back}
      />
    )
  } else if (jobId === null) {
    body = <Progress percent={0} text={settled ? he.building.starting : he.building.waitingMaterials} />
  } else if (job.isError) {
    body = (
      <Failure
        text={errorMessage(job.error)}
        action={
          <Button
            onPress={() => {
              void job.refetch()
            }}
          >
            {he.common.retry}
          </Button>
        }
      />
    )
  } else if (job.data?.status === 'done' && job.data.result !== null) {
    body = <Summary result={job.data.result} examName={examName} onToday={() => void toToday()} />
  } else if (job.data?.status === 'failed' || job.data?.status === 'done') {
    const code = job.data.error ?? ''
    body = (
      <Failure
        title={he.building.failedTitle}
        text={codeText(code)}
        action={
          <>
            {ACCOUNT_FAILURES.has(code) ? (
              <Button
                onPress={() => {
                  setReplanOpen(true)
                }}
              >
                {he.building.scheduleAnalyzed}
              </Button>
            ) : (
              <Button isDisabled={generate.isPending} onPress={start}>
                {he.common.retry}
              </Button>
            )}
            {back}
          </>
        }
      />
    )
  } else {
    body = <Progress percent={job.data?.percent ?? 0} text={stageText(job.data)} />
  }

  const done = job.data?.status === 'done'
  return (
    <OnboardingLayout step={4} title={done ? he.building.doneTitle : he.building.title} {...(done ? {} : { intro: he.building.intro })}>
      {body}
      {replan}
    </OnboardingLayout>
  )
}

function Progress({ percent, text }: { percent: number; text: string }) {
  return (
    <div className="flex flex-col gap-3">
      <ProgressBar value={percent} aria-label={he.building.progressLabel}>
        {({ percentage }) => (
          <div className="h-3 w-full overflow-hidden rounded-full bg-brand-soft">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${String(percentage ?? 0)}%` }}
            />
          </div>
        )}
      </ProgressBar>
      <p aria-live="polite" className="text-ink-muted">
        {text}
      </p>
    </div>
  )
}

function Failure({ title, text, action }: { title?: string; text: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg bg-danger-soft p-4">
      {title === undefined ? null : <h2 className="font-bold text-danger">{title}</h2>}
      <p className="text-danger">{text}</p>
      {action === undefined ? null : <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}

// `back` returns to the schedule step: the way out of a state that cannot go on by itself.
function GenerateFailure({
  error,
  onRetry,
  onReplan,
  back,
}: {
  error: ApiError
  onRetry: () => void
  onReplan: () => void
  back: ReactNode
}) {
  if (error.code === 'ai_quota_exceeded') return <Failure text={errorMessage(error)} action={back} />
  if (error.code === 'nothing_to_analyze') {
    return (
      <Failure
        text={errorMessage(error)}
        action={
          <>
            <Button onPress={onReplan}>{he.building.scheduleAnalyzed}</Button>
            {back}
          </>
        }
      />
    )
  }
  return (
    <Failure
      text={errorMessage(error)}
      action={
        <>
          <Button onPress={onRetry}>{he.common.retry}</Button>
          {back}
        </>
      }
    />
  )
}

function Summary({
  result,
  examName,
  onToday,
}: {
  result: GenerateResult
  examName: (id: string) => string
  onToday: () => void
}) {
  const anyFailed = result.exams.some((exam) => exam.status === 'failed')
  const { plan } = result
  return (
    <div className="flex flex-col gap-5">
      {anyFailed ? (
        <p role="alert" className="rounded-lg bg-warning-soft px-4 py-3 text-warning">
          {he.building.someFailed}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{he.building.examsTitle}</h2>
        <ul className="flex flex-col gap-3">
          {result.exams.map((exam) => (
            <li key={exam.exam_id} className="rounded-lg border border-line bg-surface p-4">
              <p className="font-medium">{examName(exam.exam_id)}</p>
              {exam.status === 'analyzed' ? <p className="text-ink-muted">{he.building.examTasks(exam.tasks)}</p> : null}
              {exam.status === 'skipped' ? <p className="text-ink-muted">{he.building.examSkipped}</p> : null}
              {exam.status === 'failed' ? (
                <p className="text-danger">
                  {he.building.examFailed} {codeText(exam.error ?? '')}
                </p>
              ) : null}
              {exam.warnings.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-muted">
                  {exam.warnings.map((code) => (
                    <li key={code}>{codeText(code)}</li>
                  ))}
                </ul>
              ) : null}
              {exam.gaps.length > 0 ? (
                <div className="mt-2">
                  <p className="text-sm font-medium">{he.building.gapsTitle}</p>
                  <ul className="flex flex-col gap-1 text-sm text-ink-muted">
                    {exam.gaps.map((gap, index) => (
                      // Gaps have no id, and a topic may repeat with another note.
                      <li key={index}>{he.building.gap(gap.topic, gap.note)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <p>{he.building.blocks(plan.blocks)}</p>
        {plan.unscheduled_count > 0 ? (
          <div className="rounded-lg bg-warning-soft px-4 py-3">
            <p className="font-medium">{he.building.unscheduled(plan.unscheduled_count)}</p>
            {plan.shortfalls.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {plan.shortfalls.map((s) => (
                  <li key={s.exam_id}>{shortfallText(examName(s.exam_id), s.minutes, s.daily_minutes)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {plan.warnings.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-ink-muted">
            {plan.warnings.map((code) => (
              <li key={code}>{codeText(code)}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <div>
        <Button onPress={onToday}>{he.building.toToday}</Button>
      </div>
    </div>
  )
}
