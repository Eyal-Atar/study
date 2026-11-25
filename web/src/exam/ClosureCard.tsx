import { useEffect, useRef } from 'react'
import { errorMessage } from '../api/client'
import { useBoardUserId } from '../board/api'
import { useClosures } from '../closure/api'
import { useClosureActions } from '../closure/closureActions'
import { ClosureSheet } from '../closure/ClosureSheet'
import { MoedBSheet } from '../closure/MoedBSheet'
import { markShown } from '../closure/seen'
import { statsText } from '../closure/sheetParts'
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
//
// The cards are not regions named by Archi's sentence: a screen reader would say it twice, as the
// name and as the text. The h1 of the exam already gives the context.

export type ClosureSheetState = { kind: 'closure'; examId: string } | { kind: 'moedB'; item: ClosureItem } | null

function PendingCard({ exam, item, onOpen }: { exam: Exam; item: ClosureItem; onOpen: () => void }) {
  const stats = statsText(item)
  return (
    <Card className="flex flex-col gap-3">
      <ArchiSays mood="eureka">{c.sheet.title(exam.name)}</ArchiSays>
      {stats === null ? null : <p className="text-body text-ink-muted">{stats}</p>}
      <div>
        <Button onPress={onOpen}>{c.card.open}</Button>
      </div>
    </Card>
  )
}

function WaitingCard({ exam, item, onPlan }: { exam: Exam; item: ClosureItem; onPlan: () => void }) {
  const actions = useClosureActions()
  const materials = useMaterials(exam.id)
  return (
    <Card className="flex flex-col gap-3">
      <ArchiSays mood="rest">{c.waiting.say(exam.name)}</ArchiSays>
      {materials.isSuccess ? <p className="text-body text-ink-muted">{c.waiting.kept(materials.data.length, item.tasks_total)}</p> : null}
      <div className="flex flex-wrap gap-2">
        {/* Not while the exam is being closed: the server would refuse Moed B of a closed exam. */}
        <Button onPress={onPlan} isDisabled={actions.closing(exam.id)}>
          {c.waiting.plan}
        </Button>
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
  const stats = entry === undefined ? null : statsText(entry)
  const closed = typeof exam.closed_at === 'string' ? c.archived.closedOn(longDate(todayIn(timeZone, new Date(exam.closed_at)))) : null
  // After "I'm done with it" the pressed button has left the tree with the card it was on: the focus
  // comes here instead of falling to the page. The toast already says the sentence.
  const focusRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const active = document.activeElement
    if (active === null || active === document.body) focusRef.current?.focus()
  }, [])
  return (
    <div ref={focusRef} tabIndex={-1} className="outline-none">
      <Card className="flex flex-col gap-3">
        <div data-slot="bloom">
          <ArchiSays mood="eureka">{c.archived.say(exam.name)}</ArchiSays>
        </div>
        {stats === null ? null : <p className="text-body text-ink-muted">{stats}</p>}
        {closed === null ? null : <p className="text-body text-ink-muted">{closed}</p>}
      </Card>
    </div>
  )
}

export function ClosureCard({ exam, state, onOpen }: { exam: Exam; state: 'pending' | 'waiting_moed_b' | 'done'; onOpen: (sheet: NonNullable<ClosureSheetState>) => void }) {
  const closures = useClosures()
  if (state === 'done') return <ArchivedCard exam={exam} />
  // Only when there is nothing to show: a background refresh that fails (a phone without a network)
  // keeps the card and its buttons.
  if (closures.isError && closures.data === undefined) {
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
  // Loaded and not there: the exam changed elsewhere and GET /exams has not caught up yet. Nothing,
  // until it does, rather than a loading that never ends.
  if (item === undefined) return closures.isSuccess ? null : <LoadingState shape="card" />
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
