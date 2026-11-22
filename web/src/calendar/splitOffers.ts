import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { Me } from '../api/me'
import { useApi } from '../api/ApiContext'
import type { ApiError } from '../api/client'
import { boardKey, useBoardUserId } from '../board/api'
import { addDays, dateIn, formatRange } from '../board/time'
import type { Block, TaskKind } from '../board/types'
import type { Exam } from '../onboarding/types'
import { wakingSpan } from './days'
import { localMinutes } from './geometry'
import { ghostOf, type Ghost } from './ghost'

// GET /split-offers (7.7): the server's offer to split a task the student keeps deferring. The number of
// parts and their length are the server's; nothing here assumes either.
export interface SplitPart {
  starts_at: string
  ends_at: string
  minutes: number
}
export interface SplitOffer {
  task_id: string
  exam_id: string
  task_title: string
  task_kind: TaskKind
  deferrals: number
  block: { id: string; starts_at: string; ends_at: string; minutes: number }
  bite_minutes: number
  split_minutes: number
  parts: SplitPart[]
  basis: string
}
export interface SplitOffers {
  offers: SplitOffer[]
}
// POST /tasks/{task_id}/split
export interface SplitResult {
  task_id: string
  bite_minutes: number
  blocks: Block[]
  version_id: string
}

// Under the board, so every board action refreshes the offers.
export function splitOffersKey(userId: string | null) {
  return [...boardKey(userId), 'splitOffers'] as const
}

// No refetchInterval: each call runs the planner for every task in the offer; it is refreshed by
// calendar actions (they invalidate the board key) and by TanStack's default refetch on window focus.
export function useSplitOffers(): UseQueryResult<SplitOffers, ApiError> {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<SplitOffers, ApiError>({
    queryKey: splitOffersKey(userId),
    queryFn: ({ signal }) => api.get<SplitOffers>('/split-offers', { signal }),
    enabled: userId !== null,
  })
}

// The study day of an instant, as the server counts it (study_date): inside the waking hours of the
// local day before, it is that day; otherwise the local day.
export function studyDateOf(iso: string, me: Me | undefined, tz: string): string {
  const local = dateIn(tz, new Date(iso))
  if (me === undefined) return local
  const prev = addDays(local, -1)
  const { dayStart, dayEnd } = wakingSpan(prev, me, tz)
  const at = Date.parse(iso)
  return dayStart !== null && dayEnd !== null && dayStart <= at && at < dayEnd ? prev : local
}

export function evenParts(offer: SplitOffer): boolean {
  return offer.parts.every((part) => part.minutes === offer.bite_minutes)
}

// What the server releases when it splits: the task's planned blocks that have not started.
export function releasedBlocks(offer: SplitOffer, blocks: Block[], now: number): Block[] {
  return blocks.filter((b) => b.task_id === offer.task_id && b.status === 'planned' && Date.parse(b.starts_at) > now)
}

// The colour of the task's block on screen; else of its exam; else the calendar's default (7).
export function splitColorIndex(offer: SplitOffer, blocks: Block[], exams: Exam[]): number {
  const block = blocks.find((b) => b.task_id === offer.task_id)
  if (block !== undefined) return block.exam_color_index
  return exams.find((e) => e.id === offer.exam_id)?.color_index ?? 7
}

export function splitGhosts({
  offer,
  blocks,
  colorIndex,
  me,
  tz,
  now,
}: {
  offer: SplitOffer
  blocks: Block[]
  colorIndex: number
  me: Me | undefined
  tz: string
  now: number
}): Ghost[] {
  const parts = offer.parts.map((part, index): Ghost => {
    const date = studyDateOf(part.starts_at, me, tz)
    return {
      id: `split-${offer.task_id}-${String(index)}`,
      date,
      startMin: localMinutes(part.starts_at, date, tz),
      endMin: localMinutes(part.ends_at, date, tz),
      colorIndex,
      title: offer.task_title,
      kind: offer.task_kind,
      tone: 'target',
      label: formatRange(part, tz),
      front: true,
    }
  })
  const leaving = releasedBlocks(offer, blocks, now).map((block) => ghostOf(block, block.starts_at, block.ends_at, block.study_date, tz, 'leaving'))
  return [...parts, ...leaving]
}
