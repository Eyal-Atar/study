import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { codeText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { makeBlock, makeMe, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi, problem, type ApiCall } from '../test/fakeApi'
import type { Block } from '../board/types'
import { ReviewCard } from './ReviewCard'

// Two blocks that ended without a mark (today is 2026-11-16 in Jerusalem, UTC+2):
// yesterday 14:00–15:00 and today 08:00–09:00.
const YESTERDAY = makeBlock({
  id: 'b1',
  task_id: 't1',
  task_title: 'פרק 1: מיון',
  starts_at: '2026-11-15T12:00:00Z',
  ends_at: '2026-11-15T13:00:00Z',
  study_date: '2026-11-15',
  state: 'overdue',
})
const THIS_MORNING = makeBlock({
  id: 'b2',
  task_id: 't2',
  task_title: 'פרק 2: ערימות',
  exam_name: 'הסתברות',
  starts_at: '2026-11-16T06:00:00Z',
  ends_at: '2026-11-16T07:00:00Z',
  study_date: '2026-11-16',
  state: 'overdue',
})

// A fake server whose GET /review follows `state.review`.
function setup(review: Block[] = [YESTERDAY, THIS_MORNING]) {
  const state = { review: [...review] }
  const remove = (id: string) => {
    state.review = state.review.filter((b) => b.id !== id)
  }
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', makeToday([]))
    .on('GET /review', () => ({ blocks: state.review }))
  const rendered = renderBoard(<ReviewCard />, { api: fake.api })
  return { fake, state, remove, ...rendered }
}

async function toasts() {
  return within(await screen.findByRole('region', { name: he.common.notifications }))
}

// A paragraph whose whole text is `text` (the time inside it is its own span).
function paragraph(text: string) {
  return (_content: string, element: Element | null) => element?.tagName === 'P' && element.textContent === text
}

function heading() {
  return screen.findByRole('heading', { level: 2, name: he.review.title })
}

describe('ReviewCard', () => {
  it('shows nothing when no block waits for a review', async () => {
    const { fake } = setup([])
    await waitFor(() => {
      expect(fake.calls('GET', '/review').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(fake.calls('GET', '/today').length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('heading', { name: he.review.title })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('lists every block with its day, time, exam and three actions', async () => {
    setup()
    const section = within(await screen.findByRole('region', { name: he.review.title }))
    expect(await section.findByText(he.review.lead(2))).toBeInTheDocument()
    const first = within(screen.getByRole('listitem', { name: YESTERDAY.task_title }))
    expect(first.getByText(paragraph(`${he.review.when(he.board.yesterday)}14:00–15:00`))).toBeInTheDocument()
    expect(first.getByText(YESTERDAY.exam_name, { exact: false })).toBeInTheDocument()
    const second = within(screen.getByRole('listitem', { name: THIS_MORNING.task_title }))
    expect(second.getByText(paragraph(`${he.review.when(he.board.today)}08:00–09:00`))).toBeInTheDocument()
    expect(second.getByText(THIS_MORNING.exam_name, { exact: false })).toBeInTheDocument()
    for (const label of [he.review.completeLabel, he.review.moveTodayLabel, he.review.skipLabel]) {
      expect(screen.getByRole('button', { name: label(YESTERDAY.task_title) })).toBeInTheDocument()
    }
  })

  it('"בוצע" completes the block, takes it off the card at once, and undo uncompletes it', async () => {
    const user = userEvent.setup()
    const { fake, remove, state } = setup()
    fake.on('POST /blocks/b1/complete', () => {
      remove('b1')
      return { block: { ...YESTERDAY, status: 'done', state: 'done' }, task_status: 'done' }
    })
    fake.on('POST /blocks/b1/uncomplete', () => {
      state.review = [YESTERDAY, ...state.review]
      return { block: YESTERDAY, task_status: 'todo' }
    })

    await user.click(await screen.findByRole('button', { name: he.review.completeLabel(YESTERDAY.task_title) }))
    expect(fake.calls('POST', '/blocks/b1/complete')).toHaveLength(1)
    await waitFor(() => {
      expect(screen.queryByRole('listitem', { name: YESTERDAY.task_title })).not.toBeInTheDocument()
    })
    await user.click(await (await toasts()).findByRole('button', { name: he.common.undo }))
    expect(fake.calls('POST', '/blocks/b1/uncomplete')).toHaveLength(1)
    expect(await screen.findByRole('listitem', { name: YESTERDAY.task_title })).toBeInTheDocument()
  })

  it('"העבר להיום" reschedules within today, says where, and undo sends the version back', async () => {
    const user = userEvent.setup()
    const { fake, remove } = setup()
    // 18:00–19:00 in Jerusalem, a new block today.
    const placed = makeBlock({ id: 'b9', task_id: 't1', starts_at: '2026-11-16T16:00:00Z', ends_at: '2026-11-16T17:00:00Z' })
    fake.on('POST /blocks/b1/reschedule', () => {
      remove('b1')
      return { blocks: [placed], version_id: 'v7' }
    })
    fake.on('POST /plan/undo', { version_id: 'v7' })

    await user.click(await screen.findByRole('button', { name: he.review.moveTodayLabel(YESTERDAY.task_title) }))
    expect(fake.calls('POST', '/blocks/b1/reschedule').map((c: ApiCall) => c.body)).toEqual([{ today_only: true }])
    const toast = await toasts()
    expect(await toast.findByText(he.review.moved(he.board.today, '18:00'))).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('listitem', { name: YESTERDAY.task_title })).not.toBeInTheDocument()
    })
    const reviews = fake.calls('GET', '/review').length
    await user.click(toast.getByRole('button', { name: he.common.undo }))
    expect(fake.calls('POST', '/plan/undo').map((c: ApiCall) => c.body)).toEqual([{ version_id: 'v7' }])
    expect(await (await toasts()).findByText(he.review.moveUndone)).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/review').length).toBeGreaterThan(reviews)
    })
  })

  it('the move button says "מעביר…" while the move runs', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    fake.on('POST /blocks/b1/reschedule', () => new Promise(() => undefined))

    const move = await screen.findByRole('button', { name: he.review.moveTodayLabel(YESTERDAY.task_title) })
    await user.click(move)
    await waitFor(() => {
      expect(move).toHaveTextContent(he.review.moving)
    })
    expect(move).toBeDisabled()
    expect(screen.getByRole('button', { name: he.review.skipLabel(YESTERDAY.task_title) })).toBeDisabled()
    // The other row is not blocked.
    expect(screen.getByRole('button', { name: he.review.skipLabel(THIS_MORNING.task_title) })).toBeEnabled()
  })

  it('no room today: a toast with the reason offers the next free place, which reschedules without today_only', async () => {
    const user = userEvent.setup()
    const { fake, remove } = setup()
    const placed = makeBlock({ id: 'b9', task_id: 't1', starts_at: '2026-11-17T08:00:00Z', ends_at: '2026-11-17T09:00:00Z', study_date: '2026-11-17' })
    fake.on('POST /blocks/b1/reschedule', (call: ApiCall) => {
      if ((call.body as { today_only: boolean }).today_only) {
        return problem(409, 'placement_failed', { reason: 'no_time_today', blocked_by: null })
      }
      remove('b1')
      return { blocks: [placed], version_id: 'v8' }
    })

    await user.click(await screen.findByRole('button', { name: he.review.moveTodayLabel(YESTERDAY.task_title) }))
    const toast = await toasts()
    expect(await toast.findByText(codeText('no_time_today'))).toBeInTheDocument()
    await user.click(toast.getByRole('button', { name: he.review.moveNext }))
    expect(fake.calls('POST', '/blocks/b1/reschedule').map((c: ApiCall) => c.body)).toEqual([{ today_only: true }, { today_only: false }])
    expect(await (await toasts()).findByText(he.review.moved(he.board.tomorrow, '10:00'))).toBeInTheDocument()
  })

  it('a move that finds no place for another reason offers a replan with the reason', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    fake.on('POST /blocks/b1/reschedule', problem(409, 'placement_failed', { reason: 'not_enough_time', blocked_by: null }))

    await user.click(await screen.findByRole('button', { name: he.review.moveTodayLabel(YESTERDAY.task_title) }))
    const dialog = within(await screen.findByRole('dialog', { name: he.replan.title }))
    expect(dialog.getByText(`${codeText('placement_failed')} ${unscheduledText('not_enough_time')}`)).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: YESTERDAY.task_title, hidden: true })).toBeInTheDocument()
  })

  it('"דלג" skips the task, says so, and undo sends the version back', async () => {
    const user = userEvent.setup()
    const { fake, remove } = setup()
    fake.on('POST /blocks/b2/skip', () => {
      remove('b2')
      return { task_status: 'skipped', version_id: 'v9' }
    })
    fake.on('POST /plan/undo', { version_id: 'v9' })

    await user.click(await screen.findByRole('button', { name: he.review.skipLabel(THIS_MORNING.task_title) }))
    expect(fake.calls('POST', '/blocks/b2/skip')).toHaveLength(1)
    const toast = await toasts()
    expect(await toast.findByText(he.review.skipped(THIS_MORNING.task_title))).toBeInTheDocument()
    await user.click(toast.getByRole('button', { name: he.common.undo }))
    expect(fake.calls('POST', '/plan/undo').map((c: ApiCall) => c.body)).toEqual([{ version_id: 'v9' }])
    expect(await (await toasts()).findByText(he.review.skipUndone)).toBeInTheDocument()
  })

  it('after an action the focus goes to the next row, and after the last one to the heading', async () => {
    const user = userEvent.setup()
    const { fake, remove } = setup()
    for (const block of [YESTERDAY, THIS_MORNING]) {
      fake.on(`POST /blocks/${block.id}/skip`, () => {
        remove(block.id)
        return { task_status: 'skipped', version_id: null }
      })
    }

    await user.click(await screen.findByRole('button', { name: he.review.skipLabel(YESTERDAY.task_title) }))
    const next = screen.getByRole('button', { name: he.review.completeLabel(THIS_MORNING.task_title) })
    await waitFor(() => {
      expect(next).toHaveFocus()
    })
    await user.click(screen.getByRole('button', { name: he.review.skipLabel(THIS_MORNING.task_title) }))
    const title = await heading()
    await waitFor(() => {
      expect(title).toHaveFocus()
    })
    expect(screen.getByText(he.review.allDone)).toBeInTheDocument()
  })

  it('after an action on the last row the focus goes to the row before it', async () => {
    const user = userEvent.setup()
    const { fake, remove } = setup()
    fake.on('POST /blocks/b2/skip', () => {
      remove('b2')
      return { task_status: 'skipped', version_id: null }
    })

    await user.click(await screen.findByRole('button', { name: he.review.skipLabel(THIS_MORNING.task_title) }))
    const previous = screen.getByRole('button', { name: he.review.completeLabel(YESTERDAY.task_title) })
    await waitFor(() => {
      expect(previous).toHaveFocus()
    })
  })

  it('two parts of one task get buttons with different names', async () => {
    const part1 = makeBlock({ ...YESTERDAY, id: 'p1', part_index: 1, part_count: 2 })
    const part2 = makeBlock({ ...YESTERDAY, id: 'p2', part_index: 2, part_count: 2, starts_at: '2026-11-15T14:00:00Z', ends_at: '2026-11-15T15:00:00Z' })
    setup([part1, part2])
    const name1 = `${YESTERDAY.task_title} (${he.board.part(1, 2)})`
    const name2 = `${YESTERDAY.task_title} (${he.board.part(2, 2)})`
    for (const label of [he.review.completeLabel, he.review.moveTodayLabel, he.review.skipLabel]) {
      expect(await screen.findByRole('button', { name: label(name1) })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: label(name2) })).toBeInTheDocument()
    }
    expect(screen.getByText(he.board.part(2, 2), { exact: false })).toBeInTheDocument()
  })
})
