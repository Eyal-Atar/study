import { useQueries, useQueryClient } from '@tanstack/react-query'
import { CircleAlert } from '../ui/icons'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useApi } from '../api/ApiContext'
import { errorMessage, type ApiError } from '../api/client'
import { meKey, useUserId } from '../api/me'
import { codeText, shortfallText } from '../i18n/codes'
import { en } from '../i18n/en'
import { ReplanOffer } from '../plan/ReplanOffer'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Disclosure } from '../ui/Disclosure'
import { List, ListRow } from '../ui/List'
import { Note } from '../ui/Note'
import { ProgressBar } from '../ui/ProgressBar'
import { SectionHeading } from '../ui/SectionHeading'
import { ICON_STROKE } from '../ui/styles'
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
  if (stage !== null && stage !== undefined && Object.hasOwn(en.building.stages, stage)) {
    return en.building.stages[stage as keyof typeof en.building.stages]
  }
  return en.building.starting
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
      {en.common.back}
    </Button>
  )

  const names = useMemo(() => new Map((exams.data ?? []).map((exam) => [exam.id, exam.name])), [exams.data])
  const examName = (id: string) => names.get(id) ?? en.building.unknownExam

  async function toToday() {
    await queryClient.refetchQueries({ queryKey: meKey(userId) })
    await navigate('/today')
  }

  const replan = (
    <ReplanOffer
      isOpen={replanOpen}
      reasonText={en.building.replanReason}
      onClose={() => {
        setReplanOpen(false)
      }}
      onApplied={() => {
        void toToday()
      }}
    />
  )

  let body
  // With the plan ready the step has one action, in the same place as the "המשך" of the other steps.
  let actions: ReactNode
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
    body = <Progress percent={0} text={settled ? en.building.starting : en.building.waitingMaterials} />
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
            {en.common.retry}
          </Button>
        }
      />
    )
  } else if (job.data?.status === 'done' && job.data.result !== null) {
    body = <Summary result={job.data.result} examName={examName} />
    actions = (
      <Button className="flex-1 md:flex-none" onPress={() => void toToday()}>
        {en.building.toToday}
      </Button>
    )
  } else if (job.data?.status === 'failed' || job.data?.status === 'done') {
    const code = job.data.error ?? ''
    body = (
      <Failure
        title={en.building.failedTitle}
        text={codeText(code)}
        action={
          <>
            {ACCOUNT_FAILURES.has(code) ? (
              <Button
                onPress={() => {
                  setReplanOpen(true)
                }}
              >
                {en.building.scheduleAnalyzed}
              </Button>
            ) : (
              <Button isPending={generate.isPending} onPress={start}>
                {en.common.retry}
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
    <OnboardingLayout
      step={4}
      title={done ? en.building.doneTitle : en.building.title}
      {...(done ? {} : { intro: en.building.intro })}
      actions={actions}
    >
      {body}
      {replan}
    </OnboardingLayout>
  )
}

// What is happening now, in words, and how far along it is. The stage is the text to read, so it
// comes first; aria-live reads each new stage, and the bar is not announced on every percent.
function Progress({ percent, text }: { percent: number; text: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p aria-live="polite" className="text-body font-semibold text-ink">
        {text}
      </p>
      <ProgressBar label={en.building.progressLabel} value={percent} />
    </div>
  )
}

// A failure that stops the step: said at once (role="alert"), with its ways out inside the card,
// the one that goes on first.
function Failure({ title, text, action }: { title?: string; text: string; action?: ReactNode }) {
  return (
    <Card tone="danger" role="alert" title={title}>
      <p className="text-body break-words">{text}</p>
      {action === undefined ? null : <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
    </Card>
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
            <Button onPress={onReplan}>{en.building.scheduleAnalyzed}</Button>
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
          <Button onPress={onRetry}>{en.common.retry}</Button>
          {back}
        </>
      }
    />
  )
}

function Summary({ result, examName }: { result: GenerateResult; examName: (id: string) => string }) {
  const anyFailed = result.exams.some((exam) => exam.status === 'failed')
  const { plan } = result
  return (
    <div className="flex flex-col gap-section">
      <p className="text-body text-ink tabular-nums">{en.building.blocks(plan.blocks)}</p>

      {/* A partial failure is not a silent success. */}
      {anyFailed ? (
        <Note tone="warning" role="alert">
          {en.building.someFailed}
        </Note>
      ) : null}

      <section className="flex flex-col gap-1">
        <SectionHeading>{en.building.examsTitle}</SectionHeading>
        <List aria-label={en.building.examsTitle}>
          {result.exams.map((exam) => (
            <ListRow
              key={exam.exam_id}
              title={<bdi>{examName(exam.exam_id)}</bdi>}
              subtitle={
                <>
                  {exam.status === 'analyzed' ? <p className="tabular-nums">{en.building.examTasks(exam.tasks)}</p> : null}
                  {exam.status === 'skipped' ? <p>{en.building.examSkipped}</p> : null}
                  {exam.status === 'failed' ? (
                    // The icon and the words "לא נותח" carry the state; the colour only repeats it.
                    <p className="text-danger">
                      <CircleAlert aria-hidden="true" size={14} strokeWidth={ICON_STROKE} className="me-1 inline-block align-[-0.125em]" />
                      {en.building.examFailed} {codeText(exam.error ?? '')}
                    </p>
                  ) : null}
                  {exam.warnings.map((code) => (
                    <p key={code} className="mt-1">
                      {codeText(code)}
                    </p>
                  ))}
                  {/* Topics without material are worth knowing and not worth reading now. */}
                  {exam.gaps.length > 0 ? (
                    <Disclosure label={en.building.gapsTitle}>
                      <ul role="list" className="flex flex-col gap-1">
                        {exam.gaps.map((gap, index) => (
                          // Gaps have no id, and a topic may repeat with another note.
                          <li key={index}>{en.building.gap(gap.topic, gap.note)}</li>
                        ))}
                      </ul>
                    </Disclosure>
                  ) : null}
                </>
              }
            />
          ))}
        </List>
      </section>

      {plan.unscheduled_count > 0 ? (
        <Card tone="warning" title={en.building.unscheduled(plan.unscheduled_count)}>
          {plan.shortfalls.length > 0 ? (
            <ul role="list" className="flex flex-col gap-1 text-small">
              {plan.shortfalls.map((s) => (
                <li key={s.exam_id}>{shortfallText(examName(s.exam_id), s.minutes, s.daily_minutes)}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {plan.warnings.length > 0 ? (
        <ul role="list" className="flex max-w-prose flex-col gap-1 text-small text-ink-muted">
          {plan.warnings.map((code) => (
            <li key={code}>{codeText(code)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
