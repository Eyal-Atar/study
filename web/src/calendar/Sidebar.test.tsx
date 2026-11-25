import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { blockName } from '../board/blockName'
import type { Block, Plan, Today } from '../board/types'
import { en } from '../i18n/en'
import { examColor } from '../ui/examColor'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi } from '../test/fakeApi'
import { archiLine, type ArchiMoment } from './archi'
import { ArchiSays } from './ArchiSays'
import type { SidebarExam } from './ExamsList'
import { Sidebar } from './Sidebar'

const TZ = 'Asia/Jerusalem'
const TODAY = '2026-11-16'
const EXAM_NAME = 'אלגוריתמים'

// 08:00–09:30 done, 12:00–13:00 next, 16:00–17:15 later, and one skipped (Jerusalem is UTC+2).
const DONE = makeBlock({
  id: 'block-done',
  task_title: 'Recap of week 3',
  starts_at: '2026-11-16T06:00:00Z',
  ends_at: '2026-11-16T07:30:00Z',
  status: 'done',
  state: 'done',
})
const NEXT = makeBlock({
  id: 'block-next',
  task_title: 'למידה: גרפים',
  exam_color_index: 2,
  starts_at: '2026-11-16T10:00:00Z',
  ends_at: '2026-11-16T11:00:00Z',
})
const LATER = makeBlock({
  id: 'block-later',
  task_title: 'Practice set 4',
  task_kind: 'practice',
  starts_at: '2026-11-16T14:00:00Z',
  ends_at: '2026-11-16T15:15:00Z',
})
const SKIPPED = makeBlock({
  id: 'block-skipped',
  task_title: 'Skipped reading',
  starts_at: '2026-11-16T17:00:00Z',
  ends_at: '2026-11-16T18:00:00Z',
  status: 'skipped',
  state: 'skipped',
})
const TOMORROW = makeBlock({
  id: 'block-tomorrow',
  task_title: 'Tomorrow reading',
  starts_at: '2026-11-17T07:00:00Z',
  ends_at: '2026-11-17T08:00:00Z',
  study_date: '2026-11-17',
})

const EXAMS = [
  { id: 'exam-1', name: EXAM_NAME, exam_date: '2026-12-08', color_index: 1 },
  { id: 'exam-old', name: 'Linear algebra', exam_date: '2026-11-10', color_index: 3 },
]

const task = (over: object) => ({
  id: 't', exam_id: 'exam-1', title: 'T', kind: 'learn', estimated_minutes: 30, focus: 3, depends_on_task_id: null,
  status: 'todo', source: 'user', created_at: '2026-11-01T00:00:00Z', topic_id: null, material_id: null, position: null, reason: null, ...over,
})

function setup({
  today = makeToday([DONE, NEXT, LATER, SKIPPED], { planned_minutes: 195, done_minutes: 90 }),
  plan = makePlan([DONE, NEXT, LATER, SKIPPED, TOMORROW]),
  moment = 'morning',
  exams = EXAMS,
}: { today?: Today; plan?: Plan; moment?: ArchiMoment; exams?: SidebarExam[] } = {}) {
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', today)
    .on({ method: 'GET', path: /^\/plan/ }, plan)
    .on({ method: 'POST', path: /^\/blocks\/[\w-]+\/complete$/ }, (call: { path: string }) => {
      const id = call.path.split('/')[2]
      const block = today.blocks.find((b) => b.id === id) as Block
      return { block: { ...block, status: 'done', state: 'done' }, task_status: 'done' }
    })
    .on('GET /exams/exam-1/tasks', [
      task({ id: 'a', estimated_minutes: 63, status: 'done' }),
      task({ id: 'b', estimated_minutes: 87, status: 'todo' }),
    ])
    .on('GET /exams/exam-old/tasks', [])
  const handlers = { onFreeTime: vi.fn(), onMarkBusy: vi.fn(), onDefer: vi.fn(), onOpenBlock: vi.fn() }
  renderBoard(<Sidebar todayData={today} ahead={plan} exams={exams} tz={TZ} moment={moment} {...handlers} />, { api: fake.api })
  return { fake, ...handlers }
}

describe('Sidebar: Archi and the card he stands on', () => {
  // S32 final review, M9: named once, by its own heading inside it.
  it('is a landmark named Today by the h2 inside it', () => {
    setup()
    const aside = screen.getByRole('complementary', { name: en.today.title })
    const heading = screen.getByRole('heading', { level: 2, name: en.today.title })
    expect(aside).toContainElement(heading)
    expect(aside).toHaveAttribute('aria-labelledby', heading.id)
    expect(aside).not.toHaveAttribute('aria-label')
  })

  it('says the line of the moment, with the mood named in the picture', () => {
    setup()
    const line = archiLine('morning', TODAY, { total: 3, done: 1, next: '12:00' })
    expect(line).toContain('12:00')
    expect(screen.getByText(line)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: en.archie.alt.intentions })).toBeInTheDocument()
  })

  // S32 final review, M10: a block in progress has started, so it is not "the next".
  it('with a block in progress, the summary names no time for the next', () => {
    const running = { ...NEXT, state: 'in_progress' as const }
    setup({ today: makeToday([DONE, running], { planned_minutes: 60, done_minutes: 90 }), plan: makePlan([DONE, running]) })
    expect(screen.getByText(archiLine('morning', TODAY, { total: 2, done: 1, next: null }))).toBeInTheDocument()
  })

  it('draws Archi with nothing behind him and no gap to the card', () => {
    setup()
    const archi = screen.getByRole('img', { name: en.archie.alt.intentions })
    const card = screen.getByRole('region', { name: en.today.next })
    const pair = card.parentElement as HTMLElement
    expect(pair.contains(archi)).toBe(true)
    expect(pair.className).not.toMatch(/\bgap-/)
    for (let el: HTMLElement | null = archi; el !== null && el !== pair; el = el.parentElement) {
      expect(el.className).not.toMatch(/\b(bg|border|ring|shadow|rounded|overflow)-/)
    }
  })

  it('shows the next block in a region named Up next, filled with the colour of its exam', () => {
    setup()
    const card = screen.getByRole('region', { name: en.today.next })
    expect(card).toHaveClass('bg-exam-2', 'text-on-brand')
    expect(within(card).getByText(NEXT.task_title)).toHaveAttribute('data-user-text')
    expect(within(card).getByText(/12:00–13:00/)).toBeInTheDocument()
    expect(within(card).getByText(EXAM_NAME)).toHaveAttribute('data-user-text')
  })

  it('Done completes the block', async () => {
    const { fake, onDefer } = setup()
    const name = blockName(NEXT)
    const card = screen.getByRole('region', { name: en.today.next })
    await userEvent.click(within(card).getByRole('button', { name: en.board.completeLabel(name) }))
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${NEXT.id}/complete`)).toHaveLength(1)
    })
    expect(onDefer).not.toHaveBeenCalled()
  })

  it('Defer hands the block to the caller and sends nothing', async () => {
    const { fake, onDefer } = setup()
    const card = screen.getByRole('region', { name: en.today.next })
    await userEvent.click(within(card).getByRole('button', { name: en.board.deferLabel(blockName(NEXT)) }))
    expect(onDefer).toHaveBeenCalledWith(NEXT)
    expect(fake.calls('POST')).toHaveLength(0)
  })

  it('on a day with no blocks, before a morning review, says so above the next block of a later day', () => {
    setup({ today: makeToday([], { planned_minutes: 0, done_minutes: 0 }), plan: makePlan([TOMORROW]), moment: 'review' })
    expect(screen.getByText(en.today.noBlocksToday)).toBeInTheDocument()
    const card = screen.getByRole('region', { name: en.today.next })
    expect(within(card).getByText('Tomorrow, 09:00')).toBeInTheDocument()
    expect(within(card).queryByText(/09:00–10:00/)).not.toBeInTheDocument()
  })

  it('on an open day Archi says it himself: no count of zero, and the words are not said twice', () => {
    setup({ today: makeToday([], { planned_minutes: 0, done_minutes: 0 }), plan: makePlan([TOMORROW]), moment: 'openDay' })
    const line = archiLine('openDay', TODAY, { total: 0, done: 0, next: null })
    expect(en.calendar.archi.openDay).toContain(line)
    expect(screen.getByText(line)).toBeInTheDocument()
    expect(screen.queryByText(/\b0 blocks\b/)).not.toBeInTheDocument()
    expect(screen.queryByText(en.today.noBlocksToday)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: en.today.next })).getByText('Tomorrow, 09:00')).toBeInTheDocument()
  })

  it('never counts zero blocks, even when handed the moment of a day with blocks', () => {
    setup({ today: makeToday([SKIPPED], { planned_minutes: 0, done_minutes: 0 }), plan: makePlan([SKIPPED]), moment: 'day' })
    expect(screen.queryByText(/\b0 blocks\b/)).not.toBeInTheDocument()
    expect(screen.getByText(archiLine('openDay', TODAY, { total: 0, done: 0, next: null }))).toBeInTheDocument()
  })

  it('on a finished day shows tomorrow\u2019s block without saying the day had no blocks', () => {
    const done = [DONE, { ...NEXT, status: 'done', state: 'done' } as Block]
    setup({ today: makeToday(done, { planned_minutes: 0, done_minutes: 150 }), plan: makePlan([...done, TOMORROW]), moment: 'dayDone' })
    const card = screen.getByRole('region', { name: en.today.next })
    expect(within(card).getByText('Tomorrow, 09:00')).toBeInTheDocument()
    expect(screen.queryByText(en.today.noBlocksToday)).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: en.today.moreBlocks })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('when what is left of today was missed, does not say the day had no blocks', () => {
    const missed = { ...NEXT, status: 'missed', state: 'missed' } as Block
    setup({ today: makeToday([DONE, missed], { planned_minutes: 0, done_minutes: 90 }), plan: makePlan([DONE, missed, TOMORROW]), moment: 'dayDone' })
    expect(screen.getByRole('region', { name: en.today.next })).toBeInTheDocument()
    expect(screen.queryByText(en.today.noBlocksToday)).not.toBeInTheDocument()
  })

  it('on a rest day adds nothing to what Archi says, whichever wording the day drew', () => {
    // 17 November draws another wording than the one that opens with "No blocks today."
    const date = '2026-11-17'
    const line = archiLine('restDay', date, { total: 0, done: 0, next: null })
    expect(line).not.toContain(en.today.noBlocksToday)
    const dayAfter = { ...TOMORROW, id: 'block-after', starts_at: '2026-11-18T07:00:00Z', ends_at: '2026-11-18T08:00:00Z', study_date: '2026-11-18' }
    setup({ today: makeToday([], { date, planned_minutes: 0, done_minutes: 0 }), plan: makePlan([dayAfter]), moment: 'restDay' })
    expect(screen.getByText(line)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: en.today.next })).getByText('Tomorrow, 09:00')).toBeInTheDocument()
    expect(screen.queryByText(en.today.noBlocksToday)).not.toBeInTheDocument()
  })

  it('with no block today or later, has no card', () => {
    setup({ today: makeToday([], { planned_minutes: 0, done_minutes: 0 }), plan: makePlan([]), moment: 'restDay' })
    expect(screen.queryByRole('region', { name: en.today.next })).not.toBeInTheDocument()
    expect(screen.queryByText(en.today.noBlocksToday)).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: en.archie.alt.rest })).toBeInTheDocument()
  })
})

describe('Sidebar: the day', () => {
  it('shows the minutes of today in a meter', () => {
    setup()
    const meter = screen.getByRole('meter', { name: en.today.progressLabel })
    expect(meter).toHaveAttribute('aria-valuetext', '90 of 285 minutes')
    expect(screen.getByText('90 of 285 minutes')).toBeInTheDocument()
    // The centre repeats the meter: it is hidden from a screen reader.
    expect(screen.getByText('32%')).toHaveAttribute('aria-hidden', 'true')
  })

  it('has no meter on a day without minutes', () => {
    setup({ today: makeToday([], { planned_minutes: 0, done_minutes: 0 }), plan: makePlan([]) })
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })

  it('offers free time and busy time', async () => {
    const { onFreeTime, onMarkBusy } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'I have free time now' }))
    expect(onFreeTime).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Mark busy time' }))
    expect(onMarkBusy).toHaveBeenCalledTimes(1)
  })

  it('lists the rest of today: not the block of the card, and not a skipped one', () => {
    setup()
    const list = screen.getByRole('list', { name: en.today.moreBlocks })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByText(/^\d\d:\d\d$/).textContent)).toEqual(['08:00', '16:00'])
    expect(within(list).queryByText(NEXT.task_title)).not.toBeInTheDocument()
    expect(within(list).queryByText(SKIPPED.task_title)).not.toBeInTheDocument()
    expect(within(list).getByText(DONE.task_title)).toHaveClass('line-through')
    expect(within(list).getByText(LATER.task_title)).toHaveAttribute('data-user-text')
  })

  it('has no list and no heading when the card holds the only block', () => {
    setup({ today: makeToday([NEXT]), plan: makePlan([NEXT]) })
    expect(screen.queryByText(en.today.moreBlocks)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: en.today.moreBlocks })).not.toBeInTheDocument()
  })

  it('a press on a row opens the block; a press on its check completes it and opens nothing', async () => {
    const { fake, onOpenBlock } = setup()
    const name = blockName(LATER)
    await userEvent.click(screen.getByRole('button', { name: en.board.completeLabel(name) }))
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${LATER.id}/complete`)).toHaveLength(1)
    })
    expect(onOpenBlock).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: en.board.actionsLabel(name) }))
    expect(onOpenBlock).toHaveBeenCalledWith(LATER)
  })

  it('the check of a done block offers to unmark it', () => {
    setup()
    expect(screen.getByRole('button', { name: en.board.uncompleteLabel(blockName(DONE)) })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Sidebar: the exams', () => {
  it('shows each coming exam with its days and how much of its plan is done', async () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Your exams' })).toBeInTheDocument()
    expect(screen.getByText('in 22 days')).toBeInTheDocument()
    // The name is the exam and its days; the value is the sentence, so the percent is heard once.
    const bar = await screen.findByRole('progressbar', { name: en.calendar.side.examLabel(EXAM_NAME, 'in 22 days') })
    await waitFor(() => {
      expect(bar).toHaveAttribute('aria-valuetext', '42% of the plan done')
    })
    expect(bar.getAttribute('aria-label')).not.toContain('%')
    // The bar of the exams screen (ui/ExamMark): filled in the exam's own colour.
    expect(bar.querySelector('[data-fill]')).toHaveClass(examColor(1).solid)
    expect(screen.getAllByText(EXAM_NAME).some((el) => el.hasAttribute('data-user-text'))).toBe(true)
  })

  it('leaves out an exam that passed', () => {
    setup()
    expect(screen.queryByText('Linear algebra')).not.toBeInTheDocument()
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
  })

  it('shows at most four exams, the nearest first', () => {
    const many = ['2026-12-30', '2026-12-01', '2026-12-20', '2026-12-10', '2027-01-15'].map((exam_date, i) => ({
      id: `exam-${String(i)}`,
      name: `Course ${String(i)}`,
      exam_date,
      color_index: i,
    }))
    setup({ exams: many })
    const names = screen.getAllByText(/^Course \d$/).map((el) => el.textContent)
    expect(names).toEqual(['Course 1', 'Course 3', 'Course 2', 'Course 0'])
  })

  // S45: an exam closed on its day (state done) is no longer ahead; one with no state (before S45) is.
  it('leaves out an exam closed today, and keeps one of today with no state', () => {
    setup({
      exams: [
        { id: 'exam-1', name: 'Closed today', exam_date: TODAY, color_index: 1, state: 'done' },
        { id: 'exam-old', name: 'Still today', exam_date: TODAY, color_index: 3 },
      ],
    })
    expect(screen.getByRole('heading', { name: 'Your exams' })).toBeInTheDocument()
    expect(screen.queryByText('Closed today')).not.toBeInTheDocument()
    expect(screen.getByText('Still today')).toBeInTheDocument()
  })

  it('has no exams part without a coming exam', () => {
    setup({ exams: [EXAMS[1] as (typeof EXAMS)[number]] })
    expect(screen.queryByRole('heading', { name: 'Your exams' })).not.toBeInTheDocument()
  })
})

describe('ArchiSays', () => {
  it('sets the picture 92px tall beside a semibold line, and 50px beside a plain one', () => {
    const fake = createFakeApi().on('GET /me', makeMe())
    renderBoard(
      <>
        <ArchiSays mood="joy">{en.today.noBlocksToday}</ArchiSays>
        <ArchiSays mood="rest" size="sm">
          {en.today.moreBlocks}
        </ArchiSays>
      </>,
      { api: fake.api },
    )
    const big = screen.getByRole('img', { name: en.archie.alt.joy })
    const small = screen.getByRole('img', { name: en.archie.alt.rest })
    // The frame is as wide as the art is at that height (joy is 702 by 654, rest 900 by 599).
    expect((big.closest('[data-archi-says]') as HTMLElement).style.width).toBe('99px')
    expect((small.closest('[data-archi-says]') as HTMLElement).style.width).toBe('75px')
    expect(screen.getByText(en.today.noBlocksToday).tagName).toBe('P')
    expect(screen.getByText(en.today.noBlocksToday)).toHaveClass('font-semibold')
    expect(screen.getByText(en.today.moreBlocks)).not.toHaveClass('font-semibold')
  })
})
