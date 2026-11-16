import { useQueryClient } from '@tanstack/react-query'
import { shortfallText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { boardKey, useBoardExams, useBoardUserId, usePlan, useRaiseDailyMinutes, useReport } from './api'
import { useOfferReplan } from './offerReplan'
import { durationText } from './time'

// "What did not fit" (decision 6 of the S14 plan). GET /plan says which tasks are missing minutes;
// only the replan preview (which writes nothing) says why, and how many daily minutes would fit
// them, so the preview runs only when something is missing.
export function PlanReport() {
  const plan = usePlan()
  const unplaced = plan.data?.unplaced ?? []
  const missing = unplaced.length > 0
  const report = useReport(missing)
  const exams = useBoardExams()
  const raise = useRaiseDailyMinutes()
  const offerReplan = useOfferReplan()
  const queryClient = useQueryClient()
  const userId = useBoardUserId()

  if (!missing) return null

  const examName = (id: string) => exams.data?.find((exam) => exam.id === id)?.name ?? ''
  const shortfalls = report.data?.shortfalls ?? []
  const reasons = new Map((report.data?.unscheduled ?? []).map((item) => [item.task_id, item.reason]))
  const daily = shortfalls.map((s) => s.daily_minutes).filter((m): m is number => m !== null)
  const target = daily.length > 0 ? Math.max(...daily) : null

  return (
    <section id="report" aria-labelledby="report-title" className="space-y-3 rounded-xl border border-warning bg-warning-soft p-4">
      <h2 id="report-title" className="text-lg font-semibold">
        {he.board.report.title}
      </h2>
      {report.isPending ? <p role="status">{he.board.report.loading}</p> : null}
      {report.isError ? (
        <div className="space-y-2">
          <p role="alert">{he.board.report.failed}</p>
          <Button
            variant="secondary"
            onPress={() => {
              void report.refetch()
            }}
          >
            {he.common.retry}
          </Button>
        </div>
      ) : null}
      {shortfalls.length > 0 ? (
        <ul className="space-y-1">
          {shortfalls.map((s) => (
            <li key={s.exam_id}>{shortfallText(examName(s.exam_id), s.minutes, s.daily_minutes)}</li>
          ))}
        </ul>
      ) : null}
      <div>
        <h3 className="text-sm font-semibold">{he.board.report.tasks}</h3>
        <ul className="mt-1 space-y-1 text-sm">
          {unplaced.map((task) => {
            const reason = reasons.get(task.task_id)
            return (
              <li key={task.task_id}>
                {he.board.report.task(task.title, durationText(task.minutes))}
                {reason === undefined ? null : <span className="text-ink-muted"> — {unscheduledText(reason)}</span>}
              </li>
            )
          })}
        </ul>
      </div>
      {target === null ? null : (
        <Button
          isDisabled={raise.isPending}
          onPress={() => {
            raise.mutate(target, {
              onSuccess: () => {
                offerReplan(he.board.report.raised(durationText(target)))
                void queryClient.invalidateQueries({ queryKey: boardKey(userId) })
              },
            })
          }}
        >
          {he.board.report.raise(durationText(target))}
        </Button>
      )}
    </section>
  )
}
