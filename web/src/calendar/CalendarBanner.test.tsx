import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blockName } from '../board/blockName'
import { dayLabel, durationText, formatRange } from '../board/time'
import type { Block } from '../board/types'
import { isolate } from '../i18n/bidi'
import { en } from '../i18n/en'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import type { Closures } from '../closure/types'
import { makeClosureItem } from '../test/closureFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
import { BANNER_ROWS, CalendarBanner, type CalendarBannerProps } from './CalendarBanner'
import type { Ghost } from './ghost'
import { studyDateOf, type SplitOffer, type SplitPart } from './splitOffers'
import { CAL_NOW, CAL_TODAY, CAL_TZ, makeSplitOffer } from './testFixtures'

const OVERDUE = makeBlock({ id: 'b1', task_title: 'Graphs', state: 'overdue' })

const s = en.calendar.side.banner.split
const ME = makeMe(CAL_TZ)
// The block the offer of makeSplitOffer is about: 16:00–17:30 in Jerusalem, today.
const FRICTION = makeBlock({
  id: 'block-1',
  task_id: 'task-1',
  task_title: 'Practice: malloc and free',
  task_kind: 'practice',
  exam_color_index: 2,
  study_date: CAL_TODAY,
  starts_at: '2026-11-24T14:00:00Z',
  ends_at: '2026-11-24T15:30:00Z',
})

type BannerProps = Omit<CalendarBannerProps, 'focusAfter'>

// The banner under the heading the calendar gives it (the place the focus goes when a row leaves).
function Harness(props: BannerProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <>
      <h2 ref={heading} tabIndex={-1}>
        {en.calendar.page.planHeading}
      </h2>
      <CalendarBanner {...props} focusAfter={heading} />
    </>
  )
}

// offers: what GET /split-offers answers (a dismissed offer leaves it); null leaves the route with no handler.
// closures: what GET /closures answers (S45); null (the default) leaves the route with no handler, a 404.
function setup(props: Partial<BannerProps> = {}, review = [OVERDUE], offers: SplitOffer[] | null = [], closures: Closures | Error | null = null) {
  const unplaced = props.unplacedCount ?? 0
  const server = { offers: offers ?? [] }
  const onPreview = vi.fn<(ghosts: Ghost[]) => void>()
  const onOpenClosure = vi.fn<(examId: string) => void>()
  const fake = createFakeApi()
    .on('GET /me', ME)
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
  if (offers !== null) {
    fake
      .on('GET /split-offers', () => ({ offers: server.offers }))
      .on({ method: 'POST', path: /^\/tasks\/[^/]+\/split\/dismiss$/ }, (call: { path: string }) => {
        server.offers = server.offers.filter((o) => !call.path.includes(`/${o.task_id}/`))
        return undefined
      })
  }
  if (closures !== null) fake.on('GET /closures', closures)
  const view = renderBoard(
    <Harness unplacedCount={0} onPreview={onPreview} onOpenClosure={onOpenClosure} blocks={[FRICTION]} exams={[]} me={ME} tz={CAL_TZ} now={Date.parse(CAL_NOW)} today={CAL_TODAY} {...props} />,
    { api: fake.api },
  )
  return { fake, onPreview, onOpenClosure, ...view }
}

function rowNames(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-banner-row]')).map((r) => r.getAttribute('data-banner-row'))
}

function splitRow(container: HTMLElement) {
  const row = container.querySelector<HTMLElement>('[data-banner-row="split"]')
  if (row === null) throw new Error('no split row')
  return row
}

function partText(part: SplitPart) {
  return s.part(dayLabel(studyDateOf(part.starts_at, ME, CAL_TZ), CAL_TODAY), formatRange(part, CAL_TZ), durationText(part.minutes))
}

function partTexts(container: HTMLElement) {
  return within(within(splitRow(container)).getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)
}

// The ghosts of the last preview, as [tone, date] or, for a block that leaves, [tone, id].
function lastPreview(onPreview: ReturnType<typeof vi.fn<(ghosts: Ghost[]) => void>>) {
  return (onPreview.mock.lastCall?.[0] ?? []).map((g) => [g.tone, g.tone === 'leaving' ? g.id : g.date])
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

  // S32 final review, M8: the toggle points at its panel only while the panel is there.
  it('aria-controls names the panel only while it is open', async () => {
    setup()
    const toggle = await screen.findByRole('button', { name: en.calendar.side.banner.review })
    expect(toggle).not.toHaveAttribute('aria-controls')
    await userEvent.click(toggle)
    const open = screen.getByRole('button', { name: en.calendar.side.banner.close })
    const id = open.getAttribute('aria-controls')
    expect(id).not.toBeNull()
    expect(document.getElementById(id ?? '')).not.toBeNull()
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
    expect([...BANNER_ROWS]).toEqual(['closure', 'review', 'report', 'split'])
  })
})

describe('CalendarBanner: the closure row (S45)', () => {
  const r = en.closure.row

  it('one pending exam: the row comes first, says the question, and its button opens the sheet', async () => {
    const item = makeClosureItem()
    const { container, onOpenClosure } = setup({ unplacedCount: 1 }, [OVERDUE], [makeSplitOffer()], { pending: [item], waiting: [] })
    expect(await screen.findByText(r.say(item.exam_name))).toBeInTheDocument()
    await screen.findByText(s.say(FRICTION.task_title, 90, 30))
    expect(rowNames(container)).toEqual(['closure', 'review', 'report', 'split'])
    const row = container.querySelector<HTMLElement>('[data-banner-row="closure"]')
    if (row === null) throw new Error('no closure row')
    const button = within(row).getByRole('button', { name: r.open })
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button).not.toHaveAttribute('aria-expanded')
    expect(button).not.toHaveAttribute('aria-controls')
    await userEvent.click(button)
    expect(onOpenClosure).toHaveBeenCalledWith('exam-1')
    // It opens no panel in place, and the other rows stay as they were.
    expect(row.children).toHaveLength(2)
    const others = Array.from(container.querySelectorAll('[data-banner-row]:not([data-banner-row="closure"])')).map((el) =>
      within(el as HTMLElement).getAllByRole('button')[0]?.getAttribute('aria-expanded'),
    )
    expect(others).toEqual(['false', 'false', 'false'])
  })

  it('opening the closure row leaves an open row open', async () => {
    const { onOpenClosure } = setup({}, [OVERDUE], [], { pending: [makeClosureItem()], waiting: [] })
    await userEvent.click(await screen.findByRole('button', { name: en.calendar.side.banner.review }))
    await userEvent.click(screen.getByRole('button', { name: r.open }))
    expect(onOpenClosure).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: en.calendar.side.banner.close })).toHaveAttribute('aria-expanded', 'true')
  })

  it('two pending exams: the row counts them and opens the first', async () => {
    const pending = [makeClosureItem(), makeClosureItem({ exam_id: 'exam-2', exam_name: 'Algorithms' })]
    const { onOpenClosure } = setup({}, [], [], { pending, waiting: [] })
    expect(await screen.findByText(r.sayMany(2))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: r.open }))
    expect(onOpenClosure).toHaveBeenCalledWith('exam-1')
  })

  it('only exams waiting for Moed B: no row', async () => {
    const { container, fake } = setup({}, [], [], { pending: [], waiting: [makeClosureItem({ state: 'waiting_moed_b' })] })
    await waitFor(() => {
      expect(fake.calls('GET', '/closures').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(fake.calls('GET', '/review').length).toBeGreaterThan(0)
    })
    expect(container.querySelector('[data-banner-row]')).toBeNull()
  })

  it('a failed GET /closures shows no row and says nothing', async () => {
    const { container, fake } = setup({}, [], [], problem(500, 'internal'))
    await waitFor(() => {
      expect(fake.calls('GET', '/closures').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(fake.calls('GET', '/review').length).toBeGreaterThan(0)
    })
    expect(container.querySelector('[data-banner-row]')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('CalendarBanner: the split offer (S44)', () => {
  it('renders nothing with no offer and no other row', async () => {
    const { container, fake } = setup({}, [], [])
    await waitFor(() => {
      expect(fake.calls('GET', '/split-offers').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(fake.calls('GET', '/review').length).toBeGreaterThan(0)
    })
    expect(container.querySelector('[data-banner-row]')).toBeNull()
  })

  it('a failed GET /split-offers shows no row and says nothing', async () => {
    const { container, fake } = setup({}, [], null)
    await waitFor(() => {
      expect(fake.calls('GET', '/split-offers').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(fake.calls('GET', '/review').length).toBeGreaterThan(0)
    })
    expect(container.querySelector('[data-banner-row]')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the offer closed, last after the review and the report, with nothing previewed', async () => {
    const offer = makeSplitOffer()
    const { container, onPreview } = setup({ unplacedCount: 1 }, [OVERDUE], [offer])
    expect(await screen.findByText(s.say(offer.task_title, 90, 30))).toBeInTheDocument()
    await screen.findByText(en.review.title)
    expect(rowNames(container)).toEqual(['review', 'report', 'split'])
    const toggle = within(splitRow(container)).getByRole('button', { name: s.show })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).not.toHaveAttribute('aria-controls')
    expect(within(splitRow(container)).queryByRole('list')).not.toBeInTheDocument()
    expect(onPreview.mock.calls.every(([ghosts]) => ghosts.length === 0)).toBe(true)
  })

  // Review Focus 7: the title is the student's own text, isolated inside Archi's sentence.
  it('says a Hebrew task title inside the sentence, isolated', async () => {
    const title = 'תרגול: הקצאת זיכרון'
    setup({}, [], [makeSplitOffer({ task_title: title })])
    const say = await screen.findByText(s.say(title, 90, 30))
    expect(say.textContent).toContain(isolate(title))
  })

  it('opens to the parts in words, the two buttons and the ghosts; closing clears the ghosts', async () => {
    const offer = makeSplitOffer()
    const { container, onPreview } = setup({}, [], [offer])
    await userEvent.click(await screen.findByRole('button', { name: s.show }))
    const row = within(splitRow(container))
    const close = row.getByRole('button', { name: en.calendar.side.banner.close })
    expect(close).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(close.getAttribute('aria-controls') ?? '')).not.toBeNull()
    expect(row.getByText(s.where(3))).toBeInTheDocument()
    expect(partTexts(container)).toEqual(offer.parts.map(partText))
    expect(partTexts(container)[0]).toBe('Today, 16:00–16:30, 30 min')
    expect(partTexts(container)[2]).toBe('Thu, 26 Nov, 09:00–09:30, 30 min')
    expect(row.getByRole('button', { name: 'Split into 3×30m' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: s.notNow })).toBeInTheDocument()
    expect(row.queryByText(s.whole(durationText(offer.split_minutes)))).not.toBeInTheDocument()
    expect(lastPreview(onPreview)).toEqual([
      ['target', '2026-11-24'],
      ['target', '2026-11-25'],
      ['target', '2026-11-26'],
      ['leaving', 'block-1'],
    ])
    expect((onPreview.mock.lastCall?.[0] ?? []).filter((g) => g.tone === 'target').every((g) => g.colorIndex === 2 && g.front === true)).toBe(true)
    await userEvent.click(close)
    expect(onPreview).toHaveBeenLastCalledWith([])
    expect(within(splitRow(container)).getByRole('button', { name: s.show })).toHaveAttribute('aria-expanded', 'false')
  })

  it('a refresh that changes nothing does not preview again', async () => {
    const { onPreview, queryClient } = setup({}, [], [makeSplitOffer()])
    await userEvent.click(await screen.findByRole('button', { name: s.show }))
    const calls = onPreview.mock.calls.length
    await queryClient.invalidateQueries()
    await screen.findByRole('button', { name: 'Split into 3×30m' })
    expect(onPreview.mock.calls).toHaveLength(calls)
  })

  // Review Focus 5: no number of parts and no length is fixed.
  it('an offer of two parts has two lines and "Split into 2×30m"', async () => {
    const base = makeSplitOffer()
    const offer = makeSplitOffer({ block: { ...base.block, ends_at: '2026-11-24T15:00:00Z', minutes: 60 }, split_minutes: 60, parts: base.parts.slice(0, 2) })
    const { container, onPreview } = setup({ blocks: [{ ...FRICTION, ends_at: '2026-11-24T15:00:00Z' }] }, [], [offer])
    expect(await screen.findByText(s.say(offer.task_title, 60, 30))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: s.show }))
    expect(screen.getByText(s.where(2))).toBeInTheDocument()
    expect(partTexts(container)).toEqual(offer.parts.map(partText))
    expect(screen.getByRole('button', { name: 'Split into 2×30m' })).toBeInTheDocument()
    expect(lastPreview(onPreview).filter(([tone]) => tone === 'target')).toHaveLength(2)
  })

  it('an offer of uneven parts (30 + 45) names only the bite', async () => {
    const base = makeSplitOffer()
    const parts: SplitPart[] = [
      { starts_at: '2026-11-24T14:00:00Z', ends_at: '2026-11-24T14:30:00Z', minutes: 30 },
      { starts_at: '2026-11-25T07:00:00Z', ends_at: '2026-11-25T07:45:00Z', minutes: 45 },
    ]
    const offer = makeSplitOffer({ block: { ...base.block, ends_at: '2026-11-24T15:15:00Z', minutes: 75 }, split_minutes: 75, parts })
    const { container, onPreview } = setup({}, [], [offer])
    await userEvent.click(await screen.findByRole('button', { name: s.show }))
    expect(screen.getByRole('button', { name: 'Split into 30m bites' })).toBeInTheDocument()
    expect(partTexts(container)).toEqual(['Today, 16:00–16:30, 30 min', 'Tomorrow, 09:00–09:45, 45 min'])
    // The ghosts draw the same two lengths.
    const targets = (onPreview.mock.lastCall?.[0] ?? []).filter((g) => g.tone === 'target')
    expect(targets.map((g) => g.endMin - g.startMin)).toEqual([30, 45])
  })

  it('says so when the split takes more than the deferred block', async () => {
    const base = makeSplitOffer()
    const more: SplitPart[] = [27, 28, 29].map((day) => ({ starts_at: `2026-11-${String(day)}T07:00:00Z`, ends_at: `2026-11-${String(day)}T07:30:00Z`, minutes: 30 }))
    const offer = makeSplitOffer({ split_minutes: 180, parts: [...base.parts, ...more] })
    const other: Block = { ...FRICTION, id: 'block-2', study_date: '2026-11-27', starts_at: '2026-11-27T07:00:00Z', ends_at: '2026-11-27T08:30:00Z' }
    const { onPreview } = setup({ blocks: [FRICTION, other] }, [], [offer])
    await userEvent.click(await screen.findByRole('button', { name: s.show }))
    expect(screen.getByText(s.whole(durationText(180)))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Split into 6×30m' })).toBeInTheDocument()
    expect(lastPreview(onPreview).filter(([tone]) => tone === 'leaving')).toEqual([
      ['leaving', 'block-1'],
      ['leaving', 'block-2'],
    ])
  })

  it('shows one offer at a time; after "Not now" the next one comes, closed, and the focus goes to the heading', async () => {
    const first = makeSplitOffer()
    const second = makeSplitOffer({ task_id: 'task-2', task_title: 'Read: pointers', basis: 'basis-2' })
    const { container, fake, onPreview } = setup({}, [], [first, second])
    expect(await screen.findByText(s.say(first.task_title, 90, 30))).toBeInTheDocument()
    expect(screen.queryByText(s.say(second.task_title, 90, 30))).not.toBeInTheDocument()
    expect(container.querySelectorAll('[data-banner-row="split"]')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: s.show }))
    await userEvent.click(screen.getByRole('button', { name: s.notNow }))
    expect(await screen.findByText(s.say(second.task_title, 90, 30))).toBeInTheDocument()
    expect(fake.calls('POST', `/tasks/${first.task_id}/split/dismiss`)).toHaveLength(1)
    expect(screen.queryByText(s.say(first.task_title, 90, 30))).not.toBeInTheDocument()
    expect(within(splitRow(container)).getByRole('button', { name: s.show })).toHaveAttribute('aria-expanded', 'false')
    expect(onPreview).toHaveBeenLastCalledWith([])
    expect(screen.getByRole('heading', { name: en.calendar.page.planHeading })).toHaveFocus()
  })

  it('"Not now" on the only offer takes the row away, clears the ghosts and moves the focus to the heading', async () => {
    const { container, onPreview } = setup({}, [], [makeSplitOffer()])
    await userEvent.click(await screen.findByRole('button', { name: s.show }))
    await userEvent.click(screen.getByRole('button', { name: s.notNow }))
    await waitFor(() => {
      expect(container.querySelector('[data-banner-row]')).toBeNull()
    })
    expect(onPreview).toHaveBeenLastCalledWith([])
    expect(screen.getByRole('heading', { name: en.calendar.page.planHeading })).toHaveFocus()
  })

  // S44 final review, M3 (Review Focus 3): a refresh that takes the offer away under the open row.
  it('a refresh that takes the offer away removes the open row and clears the ghosts', async () => {
    const { container, fake, onPreview, queryClient } = setup({}, [], [makeSplitOffer()])
    await userEvent.click(await screen.findByRole('button', { name: s.show }))
    expect(lastPreview(onPreview)).toHaveLength(4)
    fake.on('GET /split-offers', { offers: [] })
    await queryClient.invalidateQueries()
    await waitFor(() => {
      expect(container.querySelector('[data-banner-row="split"]')).toBeNull()
    })
    expect(onPreview).toHaveBeenLastCalledWith([])
  })

  // S44 final review, M3 (decision 12): the focus moves to the heading only when it fell to the body.
  it('when the offer leaves, a focus on another control stays there', async () => {
    const { container, fake, queryClient } = setup({}, [OVERDUE], [makeSplitOffer()])
    await userEvent.click(await screen.findByRole('button', { name: s.show }))
    const review = await screen.findByRole('button', { name: en.calendar.side.banner.review })
    act(() => {
      review.focus()
    })
    fake.on('GET /split-offers', { offers: [] })
    await queryClient.invalidateQueries()
    await waitFor(() => {
      expect(container.querySelector('[data-banner-row="split"]')).toBeNull()
    })
    expect(review).toHaveFocus()
  })

  it('only one row is open: opening the review closes the split and clears its ghosts', async () => {
    const { container, onPreview } = setup({}, [OVERDUE], [makeSplitOffer()])
    await userEvent.click(await screen.findByRole('button', { name: s.show }))
    expect(lastPreview(onPreview)).toHaveLength(4)
    await userEvent.click(await screen.findByRole('button', { name: en.calendar.side.banner.review }))
    expect(onPreview).toHaveBeenLastCalledWith([])
    expect(within(splitRow(container)).getByRole('button', { name: s.show })).toHaveAttribute('aria-expanded', 'false')
    expect(within(splitRow(container)).queryByRole('list')).not.toBeInTheDocument()
  })
})

// S44 final review, I1: the server places the first bite at the running minute when today has free
// time, so the offer on screen is stale a minute later. While the row is open, the offers are asked
// for again once the first part's start has passed; never while it is closed.
describe('CalendarBanner: the open offer follows the clock (S44 I1)', () => {
  const NOW = Date.parse(CAL_NOW)
  const at = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')
  // The first part 40 seconds from now, the other two as in makeSplitOffer.
  function soon(shift: number, basis: string): SplitOffer {
    const base = makeSplitOffer()
    const first: SplitPart = { starts_at: at(NOW + shift), ends_at: at(NOW + shift + 30 * 60_000), minutes: 30 }
    return makeSplitOffer({ parts: [first, ...base.parts.slice(1)], basis })
  }
  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function offersAsked(fake: ReturnType<typeof setup>['fake'], before: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    return fake.calls('GET', '/split-offers').length - before
  }

  it('an open row asks again when its first part starts, and shows the new times', async () => {
    const first = soon(40_000, 'basis-a')
    const next = soon(100_000, 'basis-b')
    const { container, fake, onPreview } = setup({}, [], [first])
    await user().click(await screen.findByRole('button', { name: s.show }))
    expect(partTexts(container)[0]).toBe(partText(first.parts[0] as SplitPart))
    fake.on('GET /split-offers', { offers: [next] })
    const before = fake.calls('GET', '/split-offers').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(fake.calls('GET', '/split-offers')).toHaveLength(before)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000)
    })
    await waitFor(() => {
      expect(partTexts(container)[0]).toBe(partText(next.parts[0] as SplitPart))
    })
    expect(fake.calls('GET', '/split-offers')).toHaveLength(before + 1)
    expect(within(splitRow(container)).getByRole('button', { name: en.calendar.side.banner.close })).toHaveAttribute('aria-expanded', 'true')
    expect((onPreview.mock.lastCall?.[0] ?? []).find((g) => g.tone === 'target')?.label).toBe(formatRange(next.parts[0] as SplitPart, CAL_TZ))
  })

  it('an offer that comes back the same does not ask again', async () => {
    const first = soon(40_000, 'basis-a')
    const { fake } = setup({}, [], [first])
    await user().click(await screen.findByRole('button', { name: s.show }))
    const before = fake.calls('GET', '/split-offers').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    // One refetch at the expiry; the same answer arms no second timer.
    expect(await offersAsked(fake, before)).toBe(1)
  })

  it('a closed row does not ask, also after it was open and closed', async () => {
    const { fake } = setup({}, [], [soon(40_000, 'basis-a')])
    const toggle = await screen.findByRole('button', { name: s.show })
    const u = user()
    await u.click(toggle)
    await u.click(screen.getByRole('button', { name: en.calendar.side.banner.close }))
    const before = fake.calls('GET', '/split-offers').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(await offersAsked(fake, before)).toBe(0)
  })

  it('an open row whose offer is hours ahead does not ask within five minutes', async () => {
    const { fake } = setup({}, [], [makeSplitOffer()])
    await user().click(await screen.findByRole('button', { name: s.show }))
    const before = fake.calls('GET', '/split-offers').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(await offersAsked(fake, before)).toBe(0)
  })

  it('unmounting the banner clears the timer', async () => {
    const { fake, unmount } = setup({}, [], [soon(40_000, 'basis-a')])
    await user().click(await screen.findByRole('button', { name: s.show }))
    const before = fake.calls('GET', '/split-offers').length
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(fake.calls('GET', '/split-offers')).toHaveLength(before)
  })
})
