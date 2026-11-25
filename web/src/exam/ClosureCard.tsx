import { errorMessage } from '../api/client'
import { useBoardUserId } from '../board/api'
import { durationText } from '../board/time'
import { useClosures } from '../closure/api'
import { useClosureActions } from '../closure/closureActions'
import { ClosureSheet } from '../closure/ClosureSheet'
import { MoedBSheet } from '../closure/MoedBSheet'
import { markShown } from '../closure/seen'
import type { ClosureItem } from '../closure/types'
import { en } from '../i18n/en'
import { useMaterials } from '../onboarding/api'
import type { Exam } from '../onboarding/types'
import { useProgress } from '../progress/api'
import { ArchiSays } from '../calendar/ArchiSays'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ErrorState, LoadingState } from '../ui/states'
import { useToday } from './api'
import { longDate, todayIn } from './dates'

const c = en.closure

// The closure card of the exam screen (S45): what Archi says about an exam that is not live any more,
// by its closure state. The two sheets are not in the card but in ExamPage (ClosureSheets): once the
// server has accepted Moed B the exam is active again and the card is gone, but the sheet must stay for
// its "after" state and its Undo.

export type ClosureSheetState = { kind: 'closure'; examId: string } | { kind: 'moedB'; item: ClosureItem } | null

function statsText(item: Pick<ClosureItem, 'studied_minutes' | 'tasks_total' | 'completion_percent'>): string | null {
  if (item.tasks_total === 0) return null
  if (item.studied_minutes <= 0) return c.sheet.statsNoTime(item.completion_percent)
  return c.sheet.stats(durationText(item.studied_minutes), item.completion_percent)
}

function PendingCard({ exam, item, onOpen }: { exam: Exam; item: ClosureItem; onOpen: () => void }) {
  const say = c.sheet.title(exam.name)
  return (
    <Card role="region" aria-label={say} className="flex flex-col gap-3">
      <ArchiSays mood="eureka">{say}</ArchiSays>
      {statsText(item) === null ? null : <p className="text-body text-ink-muted">{statsText(item)}</p>}
      <div>
        <Button onPress={onOpen}>{c.card.open}</Button>
      </div>
    </Card>
  )
}

function WaitingCard({ exam, item, onPlan }: { exam: Exam; item: ClosureItem; onPlan: () => void }) {
  const actions = useClosureActions()
  const materials = useMaterials(exam.id)
  const say = c.waiting.say(exam.name)
  return (
    <Card role="region" aria-label={say} className="flex flex-col gap-3">
      <ArchiSays mood="rest">{say}</ArchiSays>
      {materials.isSuccess ? <p className="text-body text-ink-muted">{c.waiting.kept(materials.data.length, item.tasks_total)}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button onPress={onPlan}>{c.waiting.plan}</Button>
        <Button
          variant="secondary"
          isPending={actions.closing(exam.id)}
          onPress={() => {
            actions.finish(item)
          }}
        >
          {c.waiting.done}
        </Button>
      </div>
    </Card>
  )
}

// A closed exam: no control at all, since the server refuses every write on it.
function ArchivedCard({ exam }: { exam: Exam }) {
  const progress = useProgress()
  const { timeZone } = useToday()
  const entry = progress.data?.archive.find((e) => e.exam_id === exam.id)
  const say = c.archived.say(exam.name)
  const closed = typeof exam.closed_at === 'string' ? c.archived.closedOn(longDate(todayIn(timeZone, new Date(exam.closed_at)))) : null
  return (
    <Card role="region" aria-label={say} className="flex flex-col gap-3">
      <div data-slot="bloom">
        <ArchiSays mood="eureka">{say}</ArchiSays>
      </div>
      {entry === undefined ? null : statsText(entry) === null ? null : <p className="text-body text-ink-muted">{statsText(entry)}</p>}
      {closed === null ? null : <p className="text-body text-ink-muted">{closed}</p>}
    </Card>
  )
}

export function ClosureCard({ exam, state, onOpen }: { exam: Exam; state: 'pending' | 'waiting_moed_b' | 'done'; onOpen: (sheet: NonNullable<ClosureSheetState>) => void }) {
  const closures = useClosures()
  if (state === 'done') return <ArchivedCard exam={exam} />
  if (closures.isError) {
    return (
      <ErrorState
        message={errorMessage(closures.error)}
        onRetry={() => {
          void closures.refetch()
        }}
      />
    )
  }
  const list = state === 'pending' ? closures.data?.pending : closures.data?.waiting
  const item = list?.find((i) => i.exam_id === exam.id)
  if (item === undefined) return <LoadingState shape="card" />
  if (state === 'pending') {
    return (
      <PendingCard
        exam={exam}
        item={item}
        onOpen={() => {
          onOpen({ kind: 'closure', examId: exam.id })
        }}
      />
    )
  }
  return (
    <WaitingCard
      exam={exam}
      item={item}
      onPlan={() => {
        onOpen({ kind: 'moedB', item })
      }}
    />
  )
}

export function ClosureSheets({ sheet, onClose }: { sheet: ClosureSheetState; onClose: () => void }) {
  const closures = useClosures()
  const userId = useBoardUserId()
  if (sheet === null) return null
  if (sheet.kind === 'moedB') return <MoedBSheet item={sheet.item} onClose={onClose} />
  return (
    <ClosureSheet
      examId={sheet.examId}
      pending={closures.data?.pending ?? []}
      onClose={onClose}
      onShown={(item) => {
        if (userId !== null) markShown(userId, item)
      }}
    />
  )
}
