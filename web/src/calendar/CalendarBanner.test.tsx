import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { blockName } from '../board/blockName'
import { en } from '../i18n/en'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi } from '../test/fakeApi'
import { BANNER_ROWS, CalendarBanner } from './CalendarBanner'

const OVERDUE = makeBlock({ id: 'b1', task_title: 'Graphs', state: 'overdue' })

function setup(props: Partial<React.ComponentProps<typeof CalendarBanner>> = {}, review = [OVERDUE]) {
  const unplaced = props.unplacedCount ?? 0
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', makeToday([]))
    .on('GET /review', { blocks: review })
    .on(
      { method: 'GET', path: /^\/plan/ },
      makePlan([], {
        unplaced: Array.from({ length: unplaced }, (_, i) => ({ task_id: `t${String(i)}`, exam_id: 'exam-1', exam_color_index: 0, title: `Unfit ${String(i)}`, minutes: 60 })),
      }),
    )
    .on('GET /exams', [])
    .on('POST /plan/replan', { unscheduled: [], shortfalls: [], blocks: [], moves: [] })
  const view = renderBoard(<CalendarBanner unplacedCount={0} onPreview={vi.fn()} {...props} />, { api: fake.api })
  return { fake, ...view }
}

describe('CalendarBanner', () => {
  it('renders nothing without a review and without unplaced tasks', async () => {
    const { container, fake } = setup({}, [])
    await vi.waitFor(() => {
      expect(fake.calls('GET', '/review').length).toBeGreaterThan(0)
    })
    expect(container.querySelector('[data-banner-row]')).toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the review row closed, then opens it', async () => {
    setup()
    expect(await screen.findByText(en.review.title)).toBeInTheDocument()
    expect(screen.getByText(en.review.lead(1), { exact: false })).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: en.calendar.side.banner.review })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: en.calendar.side.banner.close })).toHaveAttribute('aria-expanded', 'true')
    const name = blockName(OVERDUE)
    expect(await screen.findByRole('button', { name: en.review.completeLabel(name) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.review.moveTodayLabel(name) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.review.skipLabel(name) })).toBeInTheDocument()
  })

  it('shows the report row for unplaced tasks', async () => {
    setup({ unplacedCount: 1 }, [])
    expect(await screen.findByText(en.calendar.side.banner.report(1))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.calendar.side.banner.details })).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows both rows, the review first, and only one open at a time', async () => {
    const { container } = setup({ unplacedCount: 1 })
    await screen.findByText(en.review.title)
    const rows = container.querySelectorAll('[data-banner-row]')
    expect(Array.from(rows).map((r) => r.getAttribute('data-banner-row'))).toEqual(['review', 'report'])
    await userEvent.click(within(rows[0] as HTMLElement).getByRole('button'))
    await userEvent.click(within(container.querySelectorAll('[data-banner-row]')[1] as HTMLElement).getByRole('button'))
    const open = Array.from(container.querySelectorAll('[data-banner-row]')).map((r) => within(r as HTMLElement).getByRole('button').getAttribute('aria-expanded'))
    expect(open).toEqual(['false', 'true'])
  })

  it('opens the report on mount with expandTo and scrolls to it without animation', async () => {
    // jsdom has no scrollIntoView; the spy stands in for it during this test only.
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      setup({ unplacedCount: 1, expandTo: 'report' }, [])
      expect(await screen.findByRole('button', { name: en.calendar.side.banner.close })).toHaveAttribute('aria-expanded', 'true')
      expect(await screen.findByText(/Unfit 0/)).toBeInTheDocument()
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('lists the rows in order', () => {
    expect([...BANNER_ROWS]).toEqual(['review', 'report'])
  })
})
