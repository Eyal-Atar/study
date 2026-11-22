import { screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { formatRange } from '../board/time'
import { boardKey } from '../board/api'
import { EXAM_ID, makeBlock, renderBoard, USER_ID } from '../test/boardFixtures'
import { createFakeApi } from '../test/fakeApi'
import { makeExam, makeMe, makeSplitOffer } from './testFixtures'
import { evenParts, releasedBlocks, splitColorIndex, splitGhosts, splitOffersKey, studyDateOf, useSplitOffers } from './splitOffers'

const TZ = 'Asia/Jerusalem'
const NOW = Date.parse('2026-11-24T09:25:00Z')
const NIGHT_OWL = makeMe({ wake_time: '08:00', sleep_time: '02:00' })

describe('studyDateOf', () => {
  it('puts 00:30 after a late evening on the day before', () => {
    expect(studyDateOf('2026-11-24T22:30:00Z', NIGHT_OWL, TZ)).toBe('2026-11-24')
  })
  it('keeps 09:00 on its own day', () => {
    expect(studyDateOf('2026-11-25T07:00:00Z', NIGHT_OWL, TZ)).toBe('2026-11-25')
  })
  it('without /me is the local date', () => {
    expect(studyDateOf('2026-11-24T22:30:00Z', undefined, TZ)).toBe('2026-11-25')
  })
})

describe('evenParts', () => {
  it('is true when every part is the bite', () => {
    expect(evenParts(makeSplitOffer())).toBe(true)
  })
  it('is false when a part differs', () => {
    const parts = [
      { starts_at: '2026-11-24T14:00:00Z', ends_at: '2026-11-24T14:30:00Z', minutes: 30 },
      { starts_at: '2026-11-25T07:00:00Z', ends_at: '2026-11-25T07:45:00Z', minutes: 45 },
    ]
    expect(evenParts(makeSplitOffer({ parts }))).toBe(false)
  })
})

describe('releasedBlocks', () => {
  const offer = makeSplitOffer()
  const future = makeBlock({ id: 'b-future', starts_at: '2026-11-24T14:00:00Z', ends_at: '2026-11-24T15:30:00Z' })
  it('takes the planned blocks of the task that have not started', () => {
    const done = makeBlock({ id: 'b-done', status: 'done', starts_at: '2026-11-25T07:00:00Z' })
    const started = makeBlock({ id: 'b-started', starts_at: '2026-11-24T09:00:00Z' })
    const other = makeBlock({ id: 'b-other', task_id: 'task-2', starts_at: '2026-11-25T07:00:00Z' })
    expect(releasedBlocks(offer, [future, done, started, other], NOW).map((b) => b.id)).toEqual(['b-future'])
  })
})

describe('splitColorIndex', () => {
  it('comes from the task block', () => {
    const blocks = [makeBlock({ task_id: 'other', exam_color_index: 1 }), makeBlock({ exam_color_index: 4 })]
    expect(splitColorIndex(makeSplitOffer(), blocks, [makeExam({ id: EXAM_ID, color_index: 2 })])).toBe(4)
  })
  it('without a block comes from the exam', () => {
    expect(splitColorIndex(makeSplitOffer(), [], [makeExam({ id: EXAM_ID, color_index: 2 })])).toBe(2)
  })
  it('without either is 7', () => {
    expect(splitColorIndex(makeSplitOffer(), [], [makeExam({ id: 'x', color_index: 2 })])).toBe(7)
  })
})

describe('splitGhosts', () => {
  const me = makeMe()
  it('draws each part in front, and the released block as leaving', () => {
    const offer = makeSplitOffer()
    const block = makeBlock({ id: 'block-1', starts_at: '2026-11-24T14:00:00Z', ends_at: '2026-11-24T15:30:00Z', study_date: '2026-11-24' })
    const ghosts = splitGhosts({ offer, blocks: [block], colorIndex: 3, me, tz: TZ, now: NOW })
    const targets = ghosts.filter((g) => g.tone === 'target')
    expect(targets).toHaveLength(3)
    expect(targets.every((g) => g.front === true && g.colorIndex === 3 && g.kind === 'practice' && g.title === offer.task_title)).toBe(true)
    expect(targets.map((g) => g.date)).toEqual(['2026-11-24', '2026-11-25', '2026-11-26'])
    expect(targets.map((g) => [g.startMin, g.endMin])).toEqual([
      [960, 990],
      [540, 570],
      [540, 570],
    ])
    expect(targets.map((g) => g.label)).toEqual(offer.parts.map((p) => formatRange(p, TZ)))
    expect(new Set(targets.map((g) => g.id)).size).toBe(3)
    const leaving = ghosts.filter((g) => g.tone === 'leaving')
    expect(leaving.map((g) => g.id)).toEqual(['block-1'])
  })
  it('has no fixed number of parts', () => {
    const offer = makeSplitOffer({ parts: makeSplitOffer().parts.slice(0, 2) })
    expect(splitGhosts({ offer, blocks: [], colorIndex: 0, me, tz: TZ, now: NOW }).filter((g) => g.tone === 'target')).toHaveLength(2)
  })
  it('draws a part after midnight in the column of the study day before', () => {
    const offer = makeSplitOffer({ parts: [{ starts_at: '2026-11-24T22:30:00Z', ends_at: '2026-11-24T23:00:00Z', minutes: 30 }] })
    const [part] = splitGhosts({ offer, blocks: [], colorIndex: 0, me: NIGHT_OWL, tz: TZ, now: NOW })
    expect(part?.date).toBe('2026-11-24')
    expect(part?.startMin).toBe(1470)
  })
})

describe('useSplitOffers', () => {
  it('keys under the board, by user, and asks GET /split-offers', async () => {
    expect(splitOffersKey(USER_ID).slice(0, 2)).toEqual(boardKey(USER_ID))
    const offers = { offers: [makeSplitOffer()] }
    const fake = createFakeApi().on('GET /split-offers', offers)
    function Probe() {
      const q = useSplitOffers()
      return createElement('p', null, q.data === undefined ? 'loading' : q.data.offers[0]?.basis)
    }
    const { queryClient } = renderBoard(createElement(Probe), { api: fake.api })
    await waitFor(() => {
      expect(screen.getByText('basis-1')).toBeInTheDocument()
    })
    const query = queryClient.getQueryCache().find({ queryKey: [...boardKey(USER_ID), 'splitOffers'], exact: true })
    expect(query?.state.data).toEqual(offers)
    // Decision 9: no polling.
    expect(query?.options.refetchInterval).toBeUndefined()
  })
})
