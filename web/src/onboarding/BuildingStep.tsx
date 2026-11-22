import { useQueries, useQueryClient } from '@tanstack/react-query'
import { CheckMarkIcon, CircleAlert, SproutIcon, XpSparkIcon } from '../ui/icons'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Archie } from '../archie/Archie'
import { useApi } from '../api/ApiContext'
import { errorMessage, type ApiError } from '../api/client'
import { CALENDAR_PATH } from '../calendar/calendarState'
import { meKey, useMe, useUserId } from '../api/me'
import { daysBetween, todayIn } from '../exam/dates'
import { codeText, shortfallText } from '../i18n/codes'
import { en } from '../i18n/en'
import { ReplanOffer } from '../plan/ReplanOffer'
import { progressKey } from '../progress/api'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Chip } from '../ui/Chip'
import { Disclosure } from '../ui/Disclosure'
import { examColor } from '../ui/examColor'
import { List, ListRow } from '../ui/List'
import { Note } from '../ui/Note'
import { ProgressBar } from '../ui/ProgressBar'
import { prefersReducedMotion } from '../ui/reducedMotion'
import { cx, ICON_STROKE } from '../ui/styles'
import { UserText } from '../ui/UserText'
import { forgetJob, rememberJob } from './activeJob'
import { materialsKey, POLL_INTERVAL_MS, useExams, useGenerate, useJob } from './api'
import { clearMarkedCells } from './markedHours'
import { STEP_PATHS } from './steps'
import type { Exam, GenerateResult, Job, Material } from './types'

// A failed job of the account (no credit, no key) stops before every exam, but an exam analyzed
// before it has tasks: they can still go on the board.
const ACCOUNT_FAILURES = new Set(['ai_no_credit', 'ai_not_configured'])

// The XP the job gave for the first plan, read at run time: the job's result comes from the server
// as JSON, so anything but a positive finite number (absent, null, 0, a string) gives no XP.
function givenXp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

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

// The build and the ready plan are not numbered steps (S34 decision 4): waits for the materials,
// starts generate_plan once, and follows the job until it is done.
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
  const me = useMe()
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
  // When this very job gave the first plan's XP, the progress is stale too: the level chip of the
  // header must show the 50. A job that gave nothing (an old one, a returning user) leaves it alone.
  const status = job.data?.status
  const firstPlanXp = givenXp(job.data?.result?.first_plan_xp)
  useEffect(() => {
    if (status !== 'done') return
    // The plan is built: the hours still marked in step 4 are on it, or were dropped on purpose.
    clearMarkedCells()
    void queryClient.invalidateQueries({ queryKey: meKey(userId) })
    if (firstPlanXp > 0) void queryClient.invalidateQueries({ queryKey: progressKey(userId) })
  }, [status, firstPlanXp, queryClient, userId])

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
        void navigate(STEP_PATHS.fixedHours)
      }}
    >
      {en.common.back}
    </Button>
  )

  async function toToday() {
    await queryClient.refetchQueries({ queryKey: meKey(userId) })
    await navigate(CALENDAR_PATH)
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

  const ready = job.data?.status === 'done' && !job.isError ? job.data.result : null
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
    body = <Progress percent={0} text={settled ? en.building.starting : en.building.waitingMaterials} stage={null} />
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
  } else if (ready !== null) {
    return (
      <>
        <Ready result={ready} exams={exams.data ?? []} timezone={me.data?.timezone} onContinue={() => void toToday()} />
        {replan}
      </>
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
    body = <Progress percent={job.data?.percent ?? 0} text={stageText(job.data)} stage={job.data?.stage} />
  }

  return (
    <Frame title={en.building.title}>
      {body}
      {replan}
    </Frame>
  )
}

// The page title follows the h1, as it does on the steps (WCAG 2.4.2), and the plain name comes back.
function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} – ${en.appName}`
    return () => {
      document.title = en.appName
    }
  }, [title])
}

// The building screen of the prototype: Archi at his scroll, a line he stands on, then what he says.
// No steps bar and no "Back": it is not a step.
function Frame({ title, children }: { title: string; children: ReactNode }) {
  useDocumentTitle(title)
  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex flex-col">
        <div className="flex justify-center border-b border-line">
          <div className="w-[330px] max-w-full">
            <Archie mood="wisdom" size="scene" eager />
          </div>
        </div>
        <h1 className="mt-5 font-display text-[2.5rem] leading-none font-bold tracking-[0.01em] text-balance break-words text-ink">{title}</h1>
        <p className="mt-2 mb-4 text-body text-ink-muted">{en.building.intro}</p>
      </div>
      {children}
    </div>
  )
}

// Eureka comes in with a small hop: it rises into place with a slight overshoot, in 300ms, from the
// first frame it is on the page (starting:). A browser without @starting-style shows it at once.
const HOP =
  'motion-safe:transition-[translate] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-safe:starting:translate-y-3'


// Archi sits on the card that holds his news. The gold chip is the XP the server really gave in this
// job; the green one is always there.
// The days to the nearest exam count from today in the profile's zone, like the rest of the product;
// until me has loaded (the gate has it already), the device's zone stands in.
function Ready({
  result,
  exams,
  timezone,
  onContinue,
}: {
  result: GenerateResult
  exams: Exam[]
  timezone: string | undefined
  onContinue: () => void
}) {
  useDocumentTitle(en.building.doneTitle)
  const [enters] = useState(() => !prefersReducedMotion())
  const xp = givenXp(result.first_plan_xp)
  const today = todayIn(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  const ahead = exams.map((exam) => daysBetween(today, exam.exam_date)).filter((days) => days >= 0)
  const nearest = ahead.length === 0 ? null : Math.min(...ahead)
  return (
    <div className="flex flex-col gap-3 pt-2">
      <div data-part="hop" data-entering={enters ? '' : undefined} className={cx('flex justify-center', enters && HOP)}>
        <div className="w-[270px] max-w-full">
          <Archie mood="eureka" size="scene" eager />
        </div>
      </div>
      <Card>
        <h1 className="font-display text-[3.125rem] leading-[0.95] font-bold text-balance break-words text-ink">{en.building.doneTitle}</h1>
        <p className="mt-1.5 mb-3 text-body text-ink tabular-nums">{en.onboardingFlow.ready.summary(result.plan.blocks, nearest)}</p>
        <Summary result={result} exams={exams} />
      </Card>
      <div className="flex flex-wrap gap-2">
        {xp > 0 ? (
          <Chip tone="gold" icon={XpSparkIcon} label={en.onboardingFlow.ready.xpChipLabel(xp)}>
            {en.onboardingFlow.ready.xpChip(xp)}
          </Chip>
        ) : null}
        <Chip tone="leaf" icon={SproutIcon}>
          {en.onboardingFlow.ready.seedChip}
        </Chip>
      </div>
      <Button className="w-full md:w-auto md:self-start" onPress={onContinue}>
        {en.building.toToday}
      </Button>
    </div>
  )
}

// What is happening now, in words, and how far along it is. The stage is the text to read, so it
// comes first; aria-live reads each new stage, and the bar is not announced on every percent.
function Progress({ percent, text, stage }: { percent: number; text: string; stage: string | null | undefined }) {
  const keys = Object.keys(en.building.stages) as (keyof typeof en.building.stages)[]
  const current = stage === null || stage === undefined ? -1 : keys.indexOf(stage as keyof typeof en.building.stages)
  return (
    <div className="flex flex-col gap-3">
      {/* The one live region. With a stage in the list below, it is for a screen reader only. */}
      <p aria-live="polite" className={current === -1 ? 'text-body font-semibold text-ink' : 'sr-only'}>
        {current === -1 ? text : en.onboardingFlow.build.now(text)}
      </p>
      {/* The bar is 8px here (the prototype's .pbar); ProgressBar draws 6. */}
      <div className="[&_div:has(>[data-fill])]:h-2">
        <ProgressBar aria-label={en.building.progressLabel} value={percent} />
      </div>
      <ol aria-label={en.onboardingFlow.build.stagesLabel} className="flex flex-col gap-3">
        {keys.map((key, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'next'
          return (
            <li
              key={key}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cx('flex items-center gap-2.5 text-body', state === 'next' && 'text-ink-muted', state === 'current' && 'font-semibold')}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'grid size-[22px] shrink-0 place-items-center rounded-full',
                  state === 'done' && 'bg-brand text-on-brand',
                  state === 'current' && 'border-2 border-brand',
                  state === 'next' && 'border-2 border-line-strong',
                )}
              >
                {state === 'done' ? <CheckMarkIcon size={13} strokeWidth={2.75} /> : null}
                {state === 'current' ? <span className="size-2 rounded-full bg-brand" /> : null}
              </span>
              {en.building.stages[key]}
            </li>
          )
        })}
      </ol>
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

// `back` returns to the fixed-hours step, the one before the build: the way out of a state that cannot go on by itself.
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

function Summary({ result, exams }: { result: GenerateResult; exams: Exam[] }) {
  const byId = new Map(exams.map((exam) => [exam.id, exam]))
  const examName = (id: string) => byId.get(id)?.name ?? en.building.unknownExam
  const anyFailed = result.exams.some((exam) => exam.status === 'failed')
  const { plan } = result
  return (
    <div className="flex flex-col gap-section">
      {/* A partial failure is not a silent success. */}
      {anyFailed ? (
        <Note tone="warning" role="alert">
          {en.building.someFailed}
        </Note>
      ) : null}

      <section className="border-t border-line pt-1">
        <List aria-label={en.building.examsTitle}>
          {result.exams.map((exam) => (
            <ListRow
              key={exam.exam_id}
              leading={<span aria-hidden="true" className={cx('block size-2.5 rounded-[3px]', examColor(byId.get(exam.exam_id)?.color_index).solid)} />}
              title={<UserText>{examName(exam.exam_id)}</UserText>}
              subtitle={
                <>
                  {exam.status === 'analyzed' ? <p className="tabular-nums">{en.building.examTasks(exam.tasks)}</p> : null}
                  {exam.status === 'skipped' ? <p>{en.building.examSkipped}</p> : null}
                  {exam.status === 'failed' ? (
                    // The icon and the words "Not analysed" carry the state; the colour only repeats it.
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
                          <li key={index}>
                            <UserText className="font-medium">{gap.topic}</UserText>
                            {gap.note === '' ? null : <UserText prose>{gap.note}</UserText>}
                          </li>
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
