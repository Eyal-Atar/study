import { shortfallText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Note } from '../ui/Note'
import { useBoardExams, usePlan, useRaiseDailyMinutes, useReport } from './api'
import { useOfferReplan } from './offerReplan'
import { durationText } from './time'

// "What did not fit" (decision 6 of the S14 plan). GET /plan says which tasks are missing minutes;
// only the replan preview (which writes nothing) says why, and how many daily minutes would fit
// them, so the preview runs only when something is missing.
// It is a warning card: something needs attention and nothing failed. Every text in it is ink,
// because ink-muted is not a checked pair on the soft fill of a state (design language 2), so the
// hierarchy inside comes from weight alone. The id is what TodayPage scrolls to.
export function PlanReport() {
  const plan = usePlan()
  const unplaced = plan.data?.unplaced ?? []
  const missing = unplaced.length > 0
  const report = useReport(missing)
  const exams = useBoardExams()
  const raise = useRaiseDailyMinutes()
  const offerReplan = useOfferReplan()

  if (!missing) return null

  const examName = (id: string) => exams.data?.find((exam) => exam.id === id)?.name ?? ''
  const shortfalls = report.data?.shortfalls ?? []
  const reasons = new Map((report.data?.unscheduled ?? []).map((item) => [item.task_id, item.reason]))
  const daily = shortfalls.map((s) => s.daily_minutes).filter((m): m is number => m !== null)
  const target = daily.length > 0 ? Math.max(...daily) : null

  return (
    <Card id="report" role="region" tone="warning" title={he.board.report.title}>
      <div className="flex flex-col gap-3 text-small">
        {report.isPending ? <p role="status">{he.board.report.loading}</p> : null}
        {report.isError ? (
          // The neutral fill: a warning note would not show on the warning card.
          <Note
            role="alert"
            action={
              <Button
                variant="quiet"
                onPress={() => {
                  void report.refetch()
                }}
              >
                {he.common.retry}
              </Button>
            }
          >
            {he.board.report.failed}
          </Note>
        ) : null}
        {shortfalls.length > 0 ? (
          <ul className="flex max-w-prose flex-col gap-1">
            {shortfalls.map((s) => (
              <li key={s.exam_id} className="break-words">
                {shortfallText(examName(s.exam_id), s.minutes, s.daily_minutes)}
              </li>
            ))}
          </ul>
        ) : null}
        <div>
          {/* Alone under the title of the card the list needs no heading of its own: it would say the title again. */}
          {shortfalls.length > 0 ? <h3 className="mb-1 font-semibold">{he.board.report.tasks}</h3> : null}
          <ul className="flex flex-col gap-1">
            {unplaced.map((task) => {
              const reason = reasons.get(task.task_id)
              return (
                <li key={task.task_id} className="break-words">
                  <span className="font-semibold">{he.board.report.task(task.title, durationText(task.minutes))}</span>
                  {reason === undefined ? null : he.board.report.reason(unscheduledText(reason))}
                </li>
              )
            })}
          </ul>
        </div>
        {target === null ? null : (
          <Button
            className="self-start"
            isPending={raise.isPending}
            onPress={() => {
              raise.mutate(target, {
                onSuccess: () => {
                  offerReplan(he.board.report.raised(durationText(target)))
                },
              })
            }}
          >
            {he.board.report.raise(durationText(target))}
          </Button>
        )}
      </div>
    </Card>
  )
}
