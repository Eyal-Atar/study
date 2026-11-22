import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BusyItem } from '../availability/types'
import { formatRange } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi } from '../test/fakeApi'
import { CalendarClock, ClassIcon, WorkIcon, type IconType } from '../ui/icons'
import type { CalendarView } from './calendarUrl'
import { weekDays } from './days'
import { toPx, type GridSpan } from './geometry'
import type { Ghost } from './ghost'
import { makeBusy } from './testFixtures'
import { TimeGrid } from './TimeGrid'

const TZ = 'Asia/Jerusalem'
const WEEK = weekDays('2026-11-24')
const TODAY = '2026-11-24'
// 11:25 in Jerusalem
const NOW = Date.parse('2026-11-24T09:25:00Z')
const SPAN: GridSpan = { startMin: 480, endMin: 1560 }
const HOUR = 48

interface Options {
  days?: string[]
  today?: string
  view?: CalendarView
  blocks?: Block[]
  busy?: BusyItem[]
  ghosts?: Ghost[]
  restDays?: Set<string>
  streakDays?: Set<string>
  showHeader?: boolean
  now?: number
}

function setup(options: Options = {}) {
  const onOpenBlock = vi.fn()
  const onOpenBusy = vi.fn()
  const blocks = options.blocks ?? []
  const fake = createFakeApi()
    .on('GET /me', makeMe(TZ))
    .on('GET /today', makeToday(blocks))
    .on({ method: 'GET', path: /^\/plan/ }, makePlan(blocks))
  renderBoard(
    <TimeGrid
      days={options.days ?? WEEK}
      today={options.today ?? TODAY}
      view={options.view ?? 'week'}
      span={SPAN}
      hourPx={HOUR}
      blocks={blocks}
      busy={options.busy ?? []}
      ghosts={options.ghosts ?? []}
      tz={TZ}
      now={options.now ?? NOW}
      restDays={options.restDays ?? new Set()}
      streakDays={options.streakDays ?? new Set()}
      showHeader={options.showHeader ?? true}
      rangeText="22–28 November 2026"
      onOpenBlock={onOpenBlock}
      onOpenBusy={onOpenBusy}
      dayBounds={() => ({ dayStart: null, dayEnd: null })}
      onSwipeAction={vi.fn()}
      onCreateBusy={vi.fn()}
    />,
    { api: fake.api },
  )
  return { onOpenBlock, onOpenBusy, grid: screen.getByRole('group', { name: en.calendar.grid.label('22–28 November 2026') }) }
}

function column(date: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-date="${date}"]`)
  if (el === null) throw new Error(`no column for ${date}`)
  return el
}

function soloIcon(Icon: IconType): string {
  const { container } = render(<Icon size={14} />)
  return container.querySelector('svg')?.innerHTML ?? ''
}

function ghost(overrides: Partial<Ghost> = {}): Ghost {
  return { id: 'g1', date: '2026-11-25', startMin: 600, endMin: 690, colorIndex: 2, title: 'Dijkstra', kind: 'practice', tone: 'target', ...overrides }
}

describe('TimeGrid', () => {
  it('has a column for each day, in order', () => {
    setup()
    expect([...document.querySelectorAll('[data-date]')].map((el) => el.getAttribute('data-date'))).toEqual(WEEK)
  })

  it('draws a block in the column of its study date and at its time', () => {
    const block = makeBlock({ starts_at: '2026-11-24T10:00:00Z', ends_at: '2026-11-24T11:30:00Z', study_date: '2026-11-24' })
    setup({ blocks: [block] })
    const el = column('2026-11-24').querySelector<HTMLElement>('[data-block-id="block-1"]')
    // 12:00–13:30 in Jerusalem
    expect(el?.style.top).toBe(`${String(toPx(720, SPAN, HOUR) + 1)}px`)
    expect(el?.style.height).toBe(`${String(1.5 * HOUR - 3)}px`)
  })

  it('a block just after midnight stays in the column of its study date', () => {
    const block = makeBlock({ starts_at: '2026-11-24T22:30:00Z', ends_at: '2026-11-24T23:30:00Z', study_date: '2026-11-24' })
    setup({ blocks: [block] })
    const el = column('2026-11-24').querySelector<HTMLElement>('[data-block-id="block-1"]')
    expect(el?.style.top).toBe(`${String(toPx(1470, SPAN, HOUR) + 1)}px`)
    expect(column('2026-11-25').querySelector('[data-block-id]')).toBeNull()
  })

  it('does not draw missed and skipped blocks', () => {
    setup({
      blocks: [
        makeBlock({ id: 'm', status: 'missed', state: 'missed', study_date: TODAY }),
        makeBlock({ id: 's', status: 'skipped', state: 'skipped', study_date: TODAY }),
      ],
    })
    expect(document.querySelector('[data-block-id]')).toBeNull()
  })

  it('a block whose wall clock gives no height still has one', () => {
    // The night the clocks go back in Israel (25 October 2026): 01:30 summer time to 01:30 winter time.
    const days = weekDays('2026-10-24')
    const block = makeBlock({ starts_at: '2026-10-24T22:30:00Z', ends_at: '2026-10-24T23:30:00Z', study_date: '2026-10-24' })
    setup({ days, today: '2026-10-20', blocks: [block], now: Date.parse('2026-10-20T09:00:00Z') })
    const el = document.querySelector<HTMLElement>('[data-block-id="block-1"]')
    expect(parseFloat(el?.style.height ?? '0')).toBeGreaterThanOrEqual(18)
  })

  // S32 final review, M12: on that night a block can end before it starts on the wall clock; with
  // another item right under its top, it still keeps a height above zero.
  it('a block that ends before it starts on the wall clock, with an item right under it, has a height', () => {
    const days = weekDays('2026-10-24')
    // 01:30 summer time to 01:25 winter time, and 01:32–02:00 winter time.
    const back = makeBlock({ id: 'back', starts_at: '2026-10-24T22:30:00Z', ends_at: '2026-10-24T23:25:00Z', study_date: '2026-10-24' })
    const under = makeBlock({ id: 'under', starts_at: '2026-10-24T23:32:00Z', ends_at: '2026-10-25T00:00:00Z', study_date: '2026-10-24' })
    setup({ days, today: '2026-10-20', blocks: [back, under], now: Date.parse('2026-10-20T09:00:00Z') })
    const el = document.querySelector<HTMLElement>('[data-block-id="back"]')
    expect(parseFloat(el?.style.height ?? '0')).toBeGreaterThan(0)
  })

  it('a short block raised to the minimum height stops at the next block', () => {
    // 12:00–12:15 and 12:15–13:15 in Jerusalem: 15 minutes are 9px, under the minimum of 18.
    const short = makeBlock({ id: 'short', starts_at: '2026-11-24T10:00:00Z', ends_at: '2026-11-24T10:15:00Z', study_date: '2026-11-24' })
    const next = makeBlock({ id: 'next', starts_at: '2026-11-24T10:15:00Z', ends_at: '2026-11-24T11:15:00Z', study_date: '2026-11-24' })
    setup({ blocks: [next, short] })
    const a = document.querySelector<HTMLElement>('[data-block-id="short"]')
    const b = document.querySelector<HTMLElement>('[data-block-id="next"]')
    const bottom = parseFloat(a?.style.top ?? '') + parseFloat(a?.style.height ?? '')
    expect(bottom).toBeLessThan(parseFloat(b?.style.top ?? ''))
    // Never below its true height.
    expect(a?.style.height).toBe(`${String(0.25 * HOUR - 3)}px`)
  })

  it('a short block stops at busy time that follows it, and short busy time at a block', () => {
    const short = makeBlock({ id: 'short', starts_at: '2026-11-24T10:00:00Z', ends_at: '2026-11-24T10:15:00Z', study_date: '2026-11-24' })
    const after = makeBusy({ id: 'after', starts_at: '2026-11-24T10:20:00Z', ends_at: '2026-11-24T11:00:00Z' })
    const quick = makeBusy({ id: 'quick', starts_at: '2026-11-25T10:00:00Z', ends_at: '2026-11-25T10:15:00Z' })
    const then = makeBlock({ id: 'then', starts_at: '2026-11-25T10:15:00Z', ends_at: '2026-11-25T11:15:00Z', study_date: '2026-11-25' })
    setup({ blocks: [short, then], busy: [after, quick] })
    const box = (selector: string) => {
      const el = document.querySelector<HTMLElement>(selector)
      return { top: parseFloat(el?.style.top ?? ''), height: parseFloat(el?.style.height ?? '') }
    }
    const a = box('[data-block-id="short"]')
    expect(a.top + a.height).toBeLessThan(box('[data-busy-id="after"]').top)
    // 20 minutes to the next item: more than its 9px, less than the minimum.
    expect(a.height).toBe(20 * (HOUR / 60) - 3)
    const q = box('[data-busy-id="quick"]')
    expect(q.top + q.height).toBeLessThan(box('[data-block-id="then"]').top)
  })

  it('a short block with nothing after it has the minimum height', () => {
    const short = makeBlock({ id: 'short', starts_at: '2026-11-24T10:00:00Z', ends_at: '2026-11-24T10:15:00Z', study_date: '2026-11-24' })
    setup({ blocks: [short] })
    expect(document.querySelector<HTMLElement>('[data-block-id="short"]')?.style.height).toBe('18px')
  })

  it('opens a block', async () => {
    const user = userEvent.setup()
    const block = makeBlock({ starts_at: '2026-11-24T10:00:00Z', ends_at: '2026-11-24T11:30:00Z', study_date: '2026-11-24' })
    const { onOpenBlock } = setup({ blocks: [block] })
    const el = document.querySelector<HTMLElement>('[data-block-id="block-1"]')
    el?.focus()
    await user.keyboard('{Enter}')
    expect(onOpenBlock).toHaveBeenCalledWith(block)
  })

  it('every block points at the one set of instructions', () => {
    setup({
      blocks: [
        makeBlock({ id: 'a', starts_at: '2026-11-24T10:00:00Z', ends_at: '2026-11-24T11:00:00Z', study_date: '2026-11-24' }),
        makeBlock({ id: 'b', starts_at: '2026-11-25T10:00:00Z', ends_at: '2026-11-25T11:00:00Z', study_date: '2026-11-25' }),
      ],
    })
    const ids = [...document.querySelectorAll('[data-block-id]')].map((el) => el.getAttribute('aria-describedby'))
    expect(new Set(ids).size).toBe(1)
    const instructions = document.getElementById(ids[0] ?? '')
    expect(instructions?.textContent).toBe(en.calendar.grid.instructions)
    expect(screen.getAllByText(en.calendar.grid.instructions)).toHaveLength(1)
  })

  it('busy time without a title is called Busy, and opens', async () => {
    const user = userEvent.setup()
    const item = makeBusy({ source: 'event', kind: null, title: null, starts_at: '2026-11-24T12:00:00Z', ends_at: '2026-11-24T14:00:00Z' })
    const { onOpenBusy } = setup({ busy: [item] })
    const button = within(column('2026-11-24')).getByRole('button', {
      name: en.calendar.grid.busyLabel(en.calendar.grid.busyUntitled, formatRange(item, TZ)),
    })
    expect(within(button).getByText('Busy')).toBeInTheDocument()
    expect(button.querySelector('svg')?.innerHTML).toBe(soloIcon(CalendarClock))
    await user.click(button)
    expect(onOpenBusy).toHaveBeenCalledWith(item)
  })

  it('busy time of work and of a class has its icon, and a Hebrew title is user content', () => {
    setup({
      busy: [
        makeBusy({ id: 'w', kind: 'work', title: 'משמרת עבודה', starts_at: '2026-11-24T12:00:00Z', ends_at: '2026-11-24T14:00:00Z' }),
        makeBusy({ id: 'c', kind: 'class', title: 'Lecture', starts_at: '2026-11-25T08:00:00Z', ends_at: '2026-11-25T10:00:00Z' }),
      ],
    })
    const work = within(column('2026-11-24')).getByRole('button')
    expect(work.querySelector('svg')?.innerHTML).toBe(soloIcon(WorkIcon))
    const title = work.querySelector('[data-user-text]')
    expect(title).toHaveAttribute('dir', 'auto')
    expect(title?.textContent).toBe('משמרת עבודה')
    expect(within(column('2026-11-25')).getByRole('button').querySelector('svg')?.innerHTML).toBe(soloIcon(ClassIcon))
  })

  it('draws the now line in the column of today only, and says where it is', () => {
    const { grid } = setup()
    expect(document.querySelectorAll('[data-now-line]')).toHaveLength(1)
    expect(column(TODAY).querySelector('[data-now-line]')).not.toBeNull()
    expect(grid).toHaveAttribute('data-now-y', String(toPx(685, SPAN, HOUR)))
    expect(within(grid).getByText('11:25')).toBeInTheDocument()
    // 11:00 and 12:00 are further than 28 minutes away; 11:00 is 25 minutes away and gives way.
    expect(within(grid).queryByText('11:00')).not.toBeInTheDocument()
    expect(within(grid).getByText('12:00')).toBeInTheDocument()
    expect(within(grid).getByText('10:00')).toBeInTheDocument()
  })

  it('a week without today has no now line', () => {
    const { grid } = setup({ today: '2026-12-02', now: Date.parse('2026-12-02T09:25:00Z') })
    expect(grid).not.toHaveAttribute('data-now-y')
    expect(document.querySelector('[data-now-line]')).toBeNull()
    expect(within(grid).getByText('11:00')).toBeInTheDocument()
  })

  it('says where the first block starts', () => {
    const first = makeBlock({ id: 'a', starts_at: '2026-11-26T07:00:00Z', ends_at: '2026-11-26T08:00:00Z', study_date: '2026-11-26' })
    const later = makeBlock({ id: 'b', starts_at: '2026-11-24T10:00:00Z', ends_at: '2026-11-24T11:00:00Z', study_date: '2026-11-24' })
    const { grid } = setup({ blocks: [later, first] })
    expect(grid).toHaveAttribute('data-first-y', String(toPx(540, SPAN, HOUR)))
  })

  it('data-first-y is 0 without blocks', () => {
    const { grid } = setup()
    expect(grid).toHaveAttribute('data-first-y', '0')
  })

  it('marks a free day', () => {
    setup({ restDays: new Set(['2026-11-28']) })
    expect(within(column('2026-11-28')).getByText('Free day')).toBeInTheDocument()
    expect(within(column('2026-11-27')).queryByText('Free day')).not.toBeInTheDocument()
  })

  it('the header names the days, today and the days of the streak', () => {
    setup({ streakDays: new Set(['2026-11-22', '2026-11-23']) })
    const header = document.querySelector<HTMLElement>('[data-part="days"]')
    if (header === null) throw new Error('no header')
    expect(within(header).getByText('Tue')).toBeInTheDocument()
    expect(within(header).getByText('24')).toBeInTheDocument()
    expect(within(header).getAllByText('Today')).toHaveLength(1)
    expect(within(header).getAllByText('Streak kept')).toHaveLength(2)
  })

  it('has no header when it is turned off', () => {
    setup({ showHeader: false })
    expect(document.querySelector('[data-part="days"]')).toBeNull()
    expect(screen.queryByText('Tue')).not.toBeInTheDocument()
  })

  it('draws a target ghost in its column, at its time, hidden from assistive technology', () => {
    setup({ ghosts: [ghost({ label: '10:00–11:30' })] })
    const el = column('2026-11-25').querySelector<HTMLElement>('[data-ghost]')
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el?.style.top).toBe(`${String(toPx(600, SPAN, HOUR) + 1)}px`)
    expect(el?.style.height).toBe(`${String(1.5 * HOUR - 3)}px`)
    expect(el).toHaveClass('border-dashed', 'border-exam-2', 'bg-surface')
    expect(el?.textContent).toContain('Dijkstra')
    expect(el?.textContent).toContain('10:00–11:30')
    expect(document.querySelectorAll('[data-ghost]')).toHaveLength(1)
  })

  it('a ghost of busy time and a ghost of a problem have their own borders', () => {
    setup({
      ghosts: [
        ghost({ id: 'busy', colorIndex: null, title: 'New busy time', date: '2026-11-26' }),
        ghost({ id: 'bad', tone: 'problem', label: 'taken', date: '2026-11-27' }),
      ],
    })
    expect(column('2026-11-26').querySelector('[data-ghost]')).toHaveClass('border-busy')
    const bad = column('2026-11-27').querySelector('[data-ghost]')
    expect(bad).toHaveClass('border-danger')
    expect(bad).not.toHaveClass('border-exam-2')
  })

  it('a leaving ghost is drawn on its block, not as a ghost', () => {
    const block = makeBlock({ starts_at: '2026-11-24T10:00:00Z', ends_at: '2026-11-24T11:30:00Z', study_date: '2026-11-24' })
    setup({ blocks: [block], ghosts: [ghost({ id: block.id, date: '2026-11-24', tone: 'leaving' })] })
    expect(document.querySelector('[data-ghost]')).toBeNull()
    const el = document.querySelector<HTMLElement>('[data-block-id="block-1"]')
    if (el === null) throw new Error('no block')
    expect(within(el).getByText('Will move')).toBeInTheDocument()
  })

  it('the day view has one column and bigger blocks', () => {
    const block = makeBlock({ starts_at: '2026-11-24T10:00:00Z', ends_at: '2026-11-24T11:00:00Z', study_date: '2026-11-24' })
    const { grid } = setup({ days: [TODAY], view: 'day', blocks: [block] })
    expect(document.querySelectorAll('[data-date]')).toHaveLength(1)
    expect(grid).toHaveAttribute('data-view', 'day')
    expect(within(column(TODAY)).getByText(en.calendar.grid.meta(en.board.kinds.learn, '12:00–13:00'))).toBeInTheDocument()
  })

  it('has no transparency and no forced direction', () => {
    const block = makeBlock({ starts_at: '2026-11-24T10:00:00Z', ends_at: '2026-11-24T11:30:00Z', study_date: '2026-11-24' })
    const { grid } = setup({ blocks: [block], busy: [makeBusy({ starts_at: '2026-11-25T08:00:00Z', ends_at: '2026-11-25T10:00:00Z' })], ghosts: [ghost()] })
    expect(grid.outerHTML).not.toMatch(/opacity-|dir="ltr"/)
  })
})
