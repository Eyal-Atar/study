import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closuresKey } from '../closure/api'
import { markShown, wasShown } from '../closure/seen'
import type { ClosureItem } from '../closure/types'
import { en } from '../i18n/en'
import { USER_ID } from '../test/boardFixtures'
import { makeClosureItem } from '../test/closureFixtures'
import { openCalendar, stubMedia } from './testFixtures'

// The closure in the calendar (S45 Task 5): the sheet opens by itself once per exam and sitting on
// this device, the banner's row keeps the decision waiting, and a decision takes the row away.
//
// The server decides when a closure opens (19:00 local on the evening of the exam, opens_at); the
// fake server answers an item of pending only once the frozen clock has passed it.

const c = en.closure
// Monday 23 November 2026 is the exam; Jerusalem is UTC+2, so 19:00 there is 17:00Z.
const EXAM_DAY = '2026-11-23'
const BEFORE = '2026-11-23T16:59:00Z'
const AT = '2026-11-23T17:00:00Z'
const NEXT_MORNING = '2026-11-24T06:30:00Z'
const WEEK_LATER = '2026-11-30T09:00:00Z'

const ITEM = makeClosureItem()
const NAME = ITEM.exam_name
const SECOND = makeClosureItem({ exam_id: 'exam-2', exam_name: 'Data structures', color_index: 4 })

function at(instant: string) {
  vi.setSystemTime(new Date(instant))
}

const sheet = (name = NAME) => screen.findByRole('dialog', { name: c.sheet.title(name) })
const noSheet = () => screen.queryByRole('dialog')

// The X of the dialog (named Close), not the primary Close of a state "after" (its text is Close).
function closeX() {
  const x = screen.getAllByRole('button', { name: en.common.close }).find((b) => b.textContent !== en.common.close)
  if (x === undefined) throw new Error('no X')
  return x
}

function primaryClose() {
  const primary = screen.getAllByRole('button', { name: en.common.close }).find((b) => b.textContent === en.common.close)
  if (primary === undefined) throw new Error('no primary Close')
  return primary
}

function row() {
  return document.querySelector<HTMLElement>('[data-banner-row="closure"]')
}

// The calendar's answers have arrived (the banner shows with the grid).
async function settled(fake: ReturnType<typeof openCalendar>['fake']) {
  await waitFor(() => {
    expect(fake.calls('GET', '/closures').length).toBeGreaterThan(0)
  })
  await screen.findByRole('heading', { name: en.calendar.page.planHeading })
}

// The five-minute refetch of GET /closures, at once.
async function refetchClosures(queryClient: ReturnType<typeof openCalendar>['queryClient']) {
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: closuresKey(USER_ID) })
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(NEXT_MORNING)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe.each([
  ['a computer', true],
  ['a phone', false],
])('the closure on %s', (_label, desktop) => {
  beforeEach(() => {
    stubMedia({ desktop })
  })

  it('before 19:00 on the exam day nothing shows; at 19:00 the sheet opens by itself', async () => {
    at(BEFORE)
    const { fake, queryClient } = openCalendar('/calendar', { date: EXAM_DAY, closures: { pending: [ITEM], waiting: [] } })
    await settled(fake)
    expect(noSheet()).not.toBeInTheDocument()
    expect(row()).toBeNull()
    at(AT)
    await refetchClosures(queryClient)
    expect(await sheet()).toBeInTheDocument()
    expect(wasShown(USER_ID, ITEM)).toBe(true)
  })

  it('opens on entry the next morning; after the X it stays closed across weeks and a reload, and the row opens it again', async () => {
    const first = openCalendar('/calendar', { closures: { pending: [ITEM], waiting: [] } })
    await sheet()
    await userEvent.click(closeX())
    await waitFor(() => {
      expect(noSheet()).not.toBeInTheDocument()
    })
    // The decision stays open: the row says so.
    expect(row()).not.toBeNull()
    expect(screen.getByText(c.row.say(NAME))).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: en.calendar.page.nextWeek })[0] as HTMLElement)
    await userEvent.click(screen.getAllByRole('button', { name: en.calendar.page.previousWeek })[0] as HTMLElement)
    await settled(first.fake)
    expect(noSheet()).not.toBeInTheDocument()

    // A reload of the calendar on this device: the same localStorage.
    first.unmount()
    const second = openCalendar('/calendar', { closures: { pending: [ITEM], waiting: [] } })
    await settled(second.fake)
    await screen.findByText(c.row.say(NAME))
    expect(noSheet()).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: c.row.open }))
    expect(await sheet()).toBeInTheDocument()
    // With no decision the row stays, and the focus goes back to its button.
    await userEvent.click(closeX())
    await waitFor(() => {
      expect(screen.getByRole('button', { name: c.row.open })).toHaveFocus()
    })
  })

  it('Nailed it, then Close: the row leaves and the focus goes to the plan heading', async () => {
    const { fake } = openCalendar('/calendar', { closures: { pending: [ITEM], waiting: [] } })
    await sheet()
    await userEvent.click(closeX())
    // Opened from the row, whose button leaves with the decision.
    await userEvent.click(await screen.findByRole('button', { name: c.row.open }))
    await sheet()
    const asked = fake.calls('GET', '/closures').length
    await userEvent.click(screen.getByRole('button', { name: c.sheet.nailed }))
    await screen.findByRole('dialog', { name: c.sheet.bloomed(NAME) })
    expect(fake.calls('POST', '/exams/exam-1/close').map((x) => x.body)).toEqual([{ outcome: 'done' }])
    await waitFor(() => {
      expect(fake.calls('GET', '/closures').length).toBeGreaterThan(asked)
    })
    await waitFor(() => {
      expect(row()).toBeNull()
    })
    await userEvent.click(primaryClose())
    await waitFor(() => {
      expect(noSheet()).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: en.calendar.page.planHeading })).toHaveFocus()
    })
    // Nothing comes back by itself.
    expect(noSheet()).not.toBeInTheDocument()
  })

  it('a move to another week while the sheet is open leaves it open', async () => {
    const { router } = openCalendar('/calendar', { closures: { pending: [ITEM], waiting: [] } })
    const open = await sheet()
    // The navigation sits under the scrim; the move comes as the URL would (back, a link).
    await act(async () => {
      await router.navigate('/calendar?date=2026-12-01')
    })
    expect(router.state.location.search).toBe('?date=2026-12-01')
    expect(open).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: c.sheet.title(NAME) })).toBe(open)
  })
})

describe('the closure, once per exam and sitting', () => {
  beforeEach(() => {
    stubMedia({ desktop: true })
  })

  it('opens a week later when this device has not shown it yet', async () => {
    at(WEEK_LATER)
    const { fake } = openCalendar('/calendar', { date: '2026-11-30', closures: { pending: [ITEM], waiting: [] } })
    await settled(fake)
    expect(await sheet()).toBeInTheDocument()
  })

  it('a week later, once shown, only the row waits', async () => {
    markShown(USER_ID, ITEM)
    at(WEEK_LATER)
    const { fake } = openCalendar('/calendar', { date: '2026-11-30', closures: { pending: [ITEM], waiting: [] } })
    await settled(fake)
    await screen.findByText(c.row.say(NAME))
    expect(noSheet()).not.toBeInTheDocument()
  })

  it('Moed B of an exam whose Moed A sheet was shown opens by itself', async () => {
    markShown(USER_ID, ITEM)
    const moedB: ClosureItem = { ...ITEM, sitting: 2, options: ['done'] }
    openCalendar('/calendar', { closures: { pending: [moedB], waiting: [] } })
    expect(await sheet()).toBeInTheDocument()
    expect(wasShown(USER_ID, moedB)).toBe(true)
  })

  it('does not open over another sheet, and opens once that one closes', async () => {
    at(BEFORE)
    const { fake, queryClient } = openCalendar('/calendar', { date: EXAM_DAY, closures: { pending: [ITEM], waiting: [] } })
    await settled(fake)
    await userEvent.click(await screen.findByRole('button', { name: en.calendar.side.freeTime }))
    await screen.findByRole('dialog', { name: en.calendar.sheets.freeTime.title })
    at(AT)
    await refetchClosures(queryClient)
    await screen.findByText(c.row.say(NAME))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: en.calendar.sheets.freeTime.title })).toBeInTheDocument()
    expect(wasShown(USER_ID, ITEM)).toBe(false)
    await userEvent.click(closeX())
    expect(await sheet()).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('a failed GET /closures opens nothing and shows no row', async () => {
    const { fake } = openCalendar('/calendar')
    fake.on('GET /closures', new Error('down'))
    await settled(fake)
    expect(noSheet()).not.toBeInTheDocument()
    expect(row()).toBeNull()
  })
})

describe('two exams close on the same day', () => {
  beforeEach(() => {
    stubMedia({ desktop: true })
  })

  it('opens the first; Tell me about the second moves the sheet to it; the X of an undecided first does not chain to the second', async () => {
    at(AT)
    const { fake } = openCalendar('/calendar', { date: EXAM_DAY, closures: { pending: [ITEM, SECOND], waiting: [] } })
    await sheet()
    await userEvent.click(screen.getByRole('button', { name: c.sheet.nailed }))
    await screen.findByRole('dialog', { name: c.sheet.bloomed(NAME) })
    await userEvent.click(await screen.findByRole('button', { name: c.sheet.next(SECOND.exam_name) }))
    expect(await sheet(SECOND.exam_name)).toBeInTheDocument()
    expect(wasShown(USER_ID, SECOND)).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: c.sheet.nailed }))
    await screen.findByRole('dialog', { name: c.sheet.bloomed(SECOND.exam_name) })
    await userEvent.click(primaryClose())
    await waitFor(() => {
      expect(noSheet()).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(row()).toBeNull()
    })
    expect(fake.calls('POST', /\/close$/).map((x) => x.path)).toEqual(['/exams/exam-1/close', '/exams/exam-2/close'])
  })

  it('the row counts both; dismissing the first leaves the second to the row', async () => {
    at(AT)
    const { fake } = openCalendar('/calendar', { date: EXAM_DAY, closures: { pending: [ITEM, SECOND], waiting: [] } })
    await sheet()
    await userEvent.click(closeX())
    await waitFor(() => {
      expect(noSheet()).not.toBeInTheDocument()
    })
    await settled(fake)
    expect(screen.getByText(c.row.sayMany(2))).toBeInTheDocument()
    expect(noSheet()).not.toBeInTheDocument()
  })
})
