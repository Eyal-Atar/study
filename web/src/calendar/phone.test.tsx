import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { durationText } from '../board/time'
import { en } from '../i18n/en'
import { makeProgress } from '../progress/testFixtures'
import { makeBlock, makeMe, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi } from '../test/fakeApi'
import { weekDays } from './days'
import { DayStrip } from './DayStrip'
import { PhoneHeader } from './PhoneHeader'
import { TasksSheet } from './TasksSheet'

const TODAY = '2026-11-24'
// Sunday to Saturday.
const DAYS = ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']

const block = (id: string, date: string, color: number, over: object = {}) =>
  makeBlock({ id, study_date: date, exam_color_index: color, starts_at: `${date}T0${String(color + 1)}:00:00Z`, ends_at: `${date}T0${String(color + 1)}:30:00Z`, ...over })

describe('PhoneHeader', () => {
  const api = () => createFakeApi().on('GET /me', makeMe()).on('GET /progress', makeProgress()).api

  it('says Today and the short date for today, with the chip linking to /progress', async () => {
    renderBoard(<PhoneHeader date={TODAY} today={TODAY} onWeek={vi.fn()} />, { api: api() })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.board.today)
    expect(screen.getByText('Tue, 24 Nov')).toHaveClass('text-ink-muted')
    expect(await screen.findByRole('link', { name: /./ })).toHaveAttribute('href', '/progress')
  })

  it('names another day by its weekday', () => {
    renderBoard(<PhoneHeader date="2026-11-26" today={TODAY} onWeek={vi.fn()} />, { api: api() })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Thursday')
  })

  // S32 final review, I2: a visible way to another week on a phone.
  it('has a previous and a next week button', async () => {
    const onWeek = vi.fn()
    renderBoard(<PhoneHeader date="2026-11-26" today={TODAY} onWeek={onWeek} />, { api: api() })
    await userEvent.click(screen.getByRole('button', { name: en.calendar.page.previousWeek }))
    await userEvent.click(screen.getByRole('button', { name: en.calendar.page.nextWeek }))
    expect(onWeek.mock.calls).toEqual([[-1], [1]])
  })
})

describe('DayStrip', () => {
  function setup(over: Partial<React.ComponentProps<typeof DayStrip>> = {}) {
    const onSelect = vi.fn()
    const blocks = [
      block('a', '2026-11-24', 0),
      block('b', '2026-11-24', 1),
      block('c', '2026-11-24', 2),
      block('d', '2026-11-25', 0),
      block('e', '2026-11-25', 1),
      block('f', '2026-11-25', 2),
      block('g', '2026-11-25', 3),
      block('h', '2026-11-25', 4),
      block('i', '2026-11-23', 0),
    ]
    renderBoard(
      <DayStrip days={DAYS} selected="2026-11-24" today={TODAY} blocks={blocks} streakDays={new Set(['2026-11-23'])} onSelect={onSelect} {...over} />,
      { api: createFakeApi().on('GET /me', makeMe()).api },
    )
    return { onSelect }
  }
  const group = () => within(screen.getByRole('group', { name: en.calendar.side.stripLabel }))

  it('has seven buttons, today current and the selected day pressed', () => {
    setup()
    const buttons = group().getAllByRole('button')
    expect(buttons).toHaveLength(7)
    expect(buttons.filter((b) => b.getAttribute('aria-current') === 'date')).toEqual([buttons[2]])
    expect(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true')).toEqual([buttons[2]])
    expect(buttons[2]).toHaveClass('bg-inverse', 'text-on-inverse')
  })

  it('names a day by weekday, date and block count; only the selected one is in the tab order', () => {
    setup()
    const buttons = group().getAllByRole('button')
    expect(buttons[2]).toHaveAccessibleName(en.calendar.side.stripDay('Tuesday', 24, 3))
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, -1, 0, -1, -1, -1, -1])
  })

  it('shows up to four dots, and a leaf instead on a past day of the streak', () => {
    setup()
    const buttons = group().getAllByRole('button')
    expect(buttons[2]?.querySelectorAll('[data-dot]')).toHaveLength(3)
    expect(buttons[3]?.querySelectorAll('[data-dot]')).toHaveLength(4)
    expect(buttons[1]?.querySelectorAll('[data-dot]')).toHaveLength(0)
    expect(buttons[1]?.querySelector('[data-streak-leaf]')).not.toBeNull()
    expect(buttons[2]?.querySelector('[data-streak-leaf]')).toBeNull()
  })

  it('moves with the arrow keys and stops at the ends', async () => {
    const { onSelect } = setup()
    const buttons = group().getAllByRole('button')
    buttons[2]?.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onSelect).toHaveBeenLastCalledWith('2026-11-25')
    expect(buttons[3]).toHaveFocus()
  })

  it('moves back with the left arrow', async () => {
    const { onSelect } = setup()
    group().getAllByRole('button')[2]?.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onSelect).toHaveBeenLastCalledWith('2026-11-23')
  })

  // S32 final review, I2: the arrow keys cross the ends of the week.
  it('past the last day selects the next Sunday', async () => {
    const { onSelect } = setup({ selected: '2026-11-28' })
    group().getAllByRole('button')[6]?.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onSelect).toHaveBeenLastCalledWith('2026-11-29')
  })

  it('before the first day selects the Saturday before', async () => {
    const { onSelect } = setup({ selected: '2026-11-22' })
    group().getAllByRole('button')[0]?.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onSelect).toHaveBeenLastCalledWith('2026-11-21')
  })

  it('keeps the focus on the selected day when the week changes under it', async () => {
    function Harness() {
      const [selected, setSelected] = useState('2026-11-28')
      return <DayStrip days={weekDays(selected)} selected={selected} today={TODAY} blocks={[]} streakDays={new Set()} onSelect={setSelected} />
    }
    renderBoard(<Harness />, { api: createFakeApi().on('GET /me', makeMe()).api })
    group().getAllByRole('button')[6]?.focus()
    await userEvent.keyboard('{ArrowRight}')
    const first = group().getAllByRole('button')[0]
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(first).toHaveFocus()
  })

  it('selects a day on a press', async () => {
    const { onSelect } = setup()
    await userEvent.click(group().getAllByRole('button')[4] as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith('2026-11-26')
  })
})

describe('TasksSheet', () => {
  // 08:00 done, then three planned: 45 + 60 + 90 minutes = 3 hours 15 min.
  const B = (id: string, h: number, min: number, over: object = {}) =>
    makeBlock({
      id,
      task_title: `Task ${id}`,
      starts_at: `2026-11-24T${String(h).padStart(2, '0')}:00:00Z`,
      ends_at: `2026-11-24T${String(h + Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00Z`,
      study_date: TODAY,
      ...over,
    })
  const blocks = [
    B('done', 5, 60, { status: 'done', state: 'done' }),
    B('p1', 7, 45),
    B('p2', 9, 60),
    B('p3', 11, 90),
    B('gone', 14, 60, { status: 'skipped', state: 'skipped' }),
  ]

  function setup(list = blocks) {
    const handlers = { onFreeTime: vi.fn(), onMarkBusy: vi.fn(), onOpenBlock: vi.fn() }
    const today = makeToday(list, { date: TODAY })
    renderBoard(<TasksSheet todayData={today} tz="UTC" {...handlers} />, { api: createFakeApi().on('GET /me', makeMe()).api })
    return handlers
  }

  it('shows the title and what is left on the bar', () => {
    setup()
    const bar = screen.getByRole('button', { name: new RegExp(en.today.blocks) })
    expect(bar).toHaveTextContent(en.today.blocks)
    expect(bar).toHaveTextContent(en.calendar.side.peekLeft(3, durationText(195)))
  })

  it('opens a dialog with the blocks, without skipped ones, and the two buttons', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: new RegExp(en.today.blocks) }))
    const dialog = within(await screen.findByRole('dialog', { name: en.today.blocks }))
    expect(dialog.getByText('Task p1')).toBeInTheDocument()
    expect(dialog.getByText('Task done')).toBeInTheDocument()
    expect(dialog.queryByText('Task gone')).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: en.calendar.side.markBusy })).toBeInTheDocument()
  })

  it('free time closes the sheet and calls back', async () => {
    const { onFreeTime } = setup()
    await userEvent.click(screen.getByRole('button', { name: new RegExp(en.today.blocks) }))
    await userEvent.click(await screen.findByRole('button', { name: en.calendar.side.freeTime }))
    expect(onFreeTime).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('opening a block closes the sheet and calls back', async () => {
    const { onOpenBlock } = setup()
    await userEvent.click(screen.getByRole('button', { name: new RegExp(en.today.blocks) }))
    const dialog = within(await screen.findByRole('dialog'))
    await userEvent.click(dialog.getAllByRole('button', { name: /Task p1/ })[0] as HTMLElement)
    expect(onOpenBlock).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('says all done with nothing planned', () => {
    setup([B('done', 5, 60, { status: 'done', state: 'done' })])
    expect(screen.getByRole('button', { name: new RegExp(en.today.blocks) })).toHaveTextContent(en.calendar.side.peekLeft(0, ''))
  })

  it('with no blocks still shows the bar and, in the sheet, only the two buttons', async () => {
    setup([])
    await userEvent.click(screen.getByRole('button', { name: new RegExp(en.today.blocks) }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.queryByRole('list')).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: en.calendar.side.freeTime })).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: en.calendar.side.markBusy })).toBeInTheDocument()
  })
})
