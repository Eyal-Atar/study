import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { blockName } from '../board/blockName'
import { formatRange } from '../board/time'
import type { Block, TaskKind } from '../board/types'
import { en } from '../i18n/en'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi } from '../test/fakeApi'
import { KIND_ICON } from '../ui/icons'
import { CalendarBlock } from './CalendarBlock'
import type { CalendarView } from './calendarUrl'

const TZ = 'Asia/Jerusalem'
const TITLE = 'למידה: גרפים ו-BFS'

interface Options {
  view?: CalendarView
  height?: number
  lifted?: boolean
  leaving?: boolean
}

function setup(block: Block, { view = 'week', height = 69, lifted = false, leaving = false }: Options = {}) {
  const onOpen = vi.fn()
  const fake = createFakeApi()
    .on('GET /me', makeMe(TZ))
    .on('GET /today', makeToday([block]))
    .on({ method: 'GET', path: /^\/plan/ }, makePlan([block]))
    .on({ method: 'POST', path: /^\/blocks\/[^/]+\/complete$/ }, { block: { ...block, status: 'done', state: 'done' }, task_status: 'done' })
  renderBoard(
    <div className="relative">
      <CalendarBlock block={block} tz={TZ} view={view} top={40} height={height} onOpen={onOpen} lifted={lifted} leaving={leaving} />
    </div>,
    { api: fake.api },
  )
  const el = document.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`)
  if (el === null) throw new Error('the block is not drawn')
  return { el, onOpen, fake }
}

function titleOf(el: HTMLElement): HTMLElement {
  const title = el.querySelector<HTMLElement>('[data-user-text]')
  if (title === null) throw new Error('the block has no title')
  return title
}

function labelOf(block: Block, state: string | null): string {
  return en.calendar.grid.blockLabel(
    blockName(block),
    formatRange(block, TZ),
    block.exam_name,
    en.board.kinds[block.task_kind],
    state,
    block.pinned,
  )
}

function soloIcon(kind: TaskKind): string {
  const Icon = KIND_ICON[kind]
  const { container } = render(<Icon size={14} />)
  return container.querySelector('svg')?.innerHTML ?? ''
}

describe('CalendarBlock', () => {
  it('puts the kind icon first in the title row and the check last', () => {
    const { el } = setup(makeBlock({ task_title: TITLE }))
    const row = titleOf(el).parentElement
    expect(row?.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    expect(row?.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(row?.lastElementChild).toHaveAttribute('data-check', 'block-1')
    expect(row?.children[1]).toBe(titleOf(el))
  })

  it.each<TaskKind>(['learn', 'practice', 'review', 'simulation', 'simulation_review', 'custom'])(
    'draws the icon of KIND_ICON for %s',
    (kind) => {
      const { el } = setup(makeBlock({ task_kind: kind }))
      const drawn = titleOf(el).parentElement?.firstElementChild?.innerHTML
      expect(drawn).toBe(soloIcon(kind))
      expect(drawn).not.toBe('')
    },
  )

  it('shows a Hebrew title as it is, as user content', () => {
    const { el } = setup(makeBlock({ task_title: TITLE }))
    const title = titleOf(el)
    expect(title).toHaveAttribute('dir', 'auto')
    expect(title.textContent).toBe(TITLE)
  })

  it('is a control named by the function of the texts', () => {
    const block = makeBlock({ task_title: TITLE })
    const { el } = setup(block)
    expect(el).toHaveAttribute('role', 'button')
    expect(el).toHaveAttribute('tabindex', '0')
    expect(el).toHaveAttribute('aria-label', labelOf(block, null))
    expect(el).toHaveAttribute('aria-describedby')
    // A div and not a button: the check inside it is a button.
    expect(el.tagName.toLowerCase()).toBe('div')
  })

  it('done: the check is pressed and the name is struck through', () => {
    const block = makeBlock({ status: 'done', state: 'done' })
    const { el } = setup(block)
    expect(within(el).getByRole('button', { name: en.board.uncompleteLabel(blockName(block)) })).toHaveAttribute('aria-pressed', 'true')
    expect(titleOf(el)).toHaveClass('line-through')
    expect(el).toHaveAttribute('aria-label', labelOf(block, en.board.states.done))
  })

  it('overdue: a dashed border and the word', () => {
    const block = makeBlock({ state: 'overdue' })
    const { el } = setup(block)
    expect(el).toHaveClass('border-dashed')
    expect(within(el).getByText(/Overdue/)).toBeInTheDocument()
    expect(el).toHaveAttribute('aria-label', labelOf(block, en.board.states.overdue))
  })

  it('in progress: the word in the meta line and in the name', () => {
    const block = makeBlock({ state: 'in_progress' })
    const { el } = setup(block)
    expect(within(el).getByText(/Now/)).toBeInTheDocument()
    expect(el).not.toHaveClass('border-dashed')
    expect(el).toHaveAttribute('aria-label', labelOf(block, en.board.states.in_progress))
  })

  it('locked: the word in the accessible name; in the day also in the meta line', () => {
    const { el } = setup(makeBlock({ pinned: true }), { view: 'day' })
    expect(el.getAttribute('aria-label')).toMatch(/, locked$/)
    expect(within(el).getByText(/, locked$/)).toBeInTheDocument()
  })

  it('locked in the week: the lock is an icon beside the hours, and the word is in the name', () => {
    const plain = setup(makeBlock())
    const icons = plain.el.querySelectorAll('svg').length
    cleanup()
    const { el } = setup(makeBlock({ pinned: true }))
    expect(el.getAttribute('aria-label')).toMatch(/, locked$/)
    expect(el.querySelectorAll('svg')).toHaveLength(icons + 1)
    expect(within(el).getByText('14:00–15:00')).toBeInTheDocument()
  })

  it('in the week the state takes the place of the hours; in the day both show', () => {
    const week = setup(makeBlock({ state: 'overdue' }))
    expect(within(week.el).getByText('Overdue')).toBeInTheDocument()
    expect(within(week.el).queryByText(/14:00/)).not.toBeInTheDocument()
    cleanup()
    const day = setup(makeBlock({ state: 'overdue' }), { view: 'day' })
    expect(within(day.el).getByText(`${en.calendar.grid.meta(en.board.kinds.learn, '14:00–15:00')}${en.calendar.grid.metaState('Overdue')}`)).toBeInTheDocument()
  })

  it('week, 45px: two title lines and no meta line', () => {
    const { el } = setup(makeBlock(), { height: 45 })
    expect(titleOf(el)).toHaveClass('calendar-title-2')
    expect(titleOf(el)).not.toHaveClass('user-text-truncate')
    expect(within(el).queryByText(/14:00/)).not.toBeInTheDocument()
  })

  it('week, 69px: two title lines and the hours alone', () => {
    const { el } = setup(makeBlock(), { height: 69 })
    expect(titleOf(el)).toHaveClass('calendar-title-2')
    expect(within(el).getByText('14:00–15:00')).toBeInTheDocument()
  })

  it('week, 30px: one title line', () => {
    const { el } = setup(makeBlock(), { height: 30 })
    expect(titleOf(el)).toHaveClass('user-text-truncate')
    expect(within(el).queryByText(/14:00/)).not.toBeInTheDocument()
  })

  it('day, 45px: one title line, and the kind with the hours', () => {
    const { el } = setup(makeBlock(), { view: 'day', height: 45 })
    expect(titleOf(el)).toHaveClass('user-text-truncate')
    expect(within(el).getByText(en.calendar.grid.meta(en.board.kinds.learn, '14:00–15:00'))).toBeInTheDocument()
  })

  it('a click on the check completes the block and does not open it', async () => {
    const user = userEvent.setup()
    const block = makeBlock()
    const { el, onOpen, fake } = setup(block)
    await user.click(within(el).getByRole('button', { name: en.board.completeLabel(blockName(block)) }))
    await waitFor(() => {
      expect(fake.calls('POST', '/blocks/block-1/complete')).toHaveLength(1)
    })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('Enter and Space on the check do not open the block', async () => {
    const user = userEvent.setup()
    const block = makeBlock()
    const { el, onOpen } = setup(block)
    within(el)
      .getByRole('button', { name: en.board.completeLabel(blockName(block)) })
      .focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a click, Enter and Space on the block open it', async () => {
    const user = userEvent.setup()
    const block = makeBlock()
    const { el, onOpen } = setup(block)
    await user.click(titleOf(el))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenLastCalledWith(block)
    el.focus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(2)
    await user.keyboard(' ')
    expect(onOpen).toHaveBeenCalledTimes(3)
  })

  it('leaving: a dashed border and the words', () => {
    const { el } = setup(makeBlock(), { leaving: true })
    expect(el).toHaveClass('border-dashed')
    expect(within(el).getByText('Will move')).toBeInTheDocument()
  })

  it('leaving in a block with room for two lines only: the words take the second line', () => {
    const { el } = setup(makeBlock(), { leaving: true, height: 45 })
    expect(within(el).getByText('Will move')).toBeInTheDocument()
    expect(titleOf(el)).toHaveClass('user-text-truncate')
  })

  it('lifted is marked on the block', () => {
    const { el } = setup(makeBlock(), { lifted: true })
    expect(el).toHaveAttribute('data-lifted')
    expect(el).toHaveClass('shadow-lift')
  })

  it('is placed by top and height, and has no transparency', () => {
    const { el } = setup(makeBlock(), { height: 45 })
    expect(el.style.top).toBe('40px')
    expect(el.style.height).toBe('45px')
    expect(el.outerHTML).not.toMatch(/opacity-|dir="ltr"/)
  })

  it('names a part of a split task', () => {
    const block = makeBlock({ part_index: 2, part_count: 3 })
    const { el } = setup(block)
    expect(el).toHaveAttribute('aria-label', labelOf(block, null))
    expect(el.getAttribute('aria-label')).toContain(en.board.part(2, 3))
  })

  it('the check is disabled while an action on the block runs', async () => {
    const user = userEvent.setup()
    const block = makeBlock()
    const { el, fake } = setup(block)
    fake.on({ method: 'POST', path: /^\/blocks\/[^/]+\/complete$/ }, () => new Promise(() => undefined))
    const check = screen.getByRole('button', { name: en.board.completeLabel(blockName(block)) })
    await user.click(check)
    await waitFor(() => {
      expect(el.querySelector('[data-check]')).toBeDisabled()
    })
  })
})
