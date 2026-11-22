import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { makeBlock } from '../test/boardFixtures'
import { problem } from '../test/fakeApi'
import type { SplitResult } from './splitOffers'
import { CAL_NOW, CAL_TODAY, makeSplitOffer, openCalendar, stubMedia, type CalendarServer } from './testFixtures'

// The split offer on the calendar screen itself (S44 Task 4): the row of the banner, its ghosts on
// the grid, the split, its Undo, and where the focus goes when the row leaves.

const s = en.calendar.side.banner.split
const OFFER = makeSplitOffer()
const SPLIT_PATH = `/tasks/${OFFER.task_id}/split`

// The block the offer is about: 16:00–17:30 in Jerusalem, today.
const FRICTION = makeBlock({
  id: 'block-1',
  task_id: 'task-1',
  task_title: OFFER.task_title,
  task_kind: 'practice',
  study_date: CAL_TODAY,
  starts_at: '2026-11-24T14:00:00Z',
  ends_at: '2026-11-24T15:30:00Z',
})
const BITES: Block[] = OFFER.parts.map((part, index) =>
  makeBlock({
    id: `bite-${String(index)}`,
    task_id: OFFER.task_id,
    task_title: OFFER.task_title,
    task_kind: 'practice',
    study_date: part.starts_at.slice(0, 10),
    starts_at: part.starts_at,
    ends_at: part.ends_at,
    part_index: index + 1,
    part_count: OFFER.parts.length,
  }),
)
const RESULT: SplitResult = { task_id: OFFER.task_id, bite_minutes: OFFER.bite_minutes, blocks: BITES, version_id: 'v-split' }

function open(init: Partial<CalendarServer> = {}) {
  const calendar = openCalendar('/calendar', { blocks: [FRICTION], splitOffers: [OFFER], ...init })
  const { fake, state } = calendar
  // The server: a split replaces the block by its bites and takes the offer; an Undo puts both back.
  fake
    .on(`POST ${SPLIT_PATH}`, () => {
      state.blocks = BITES
      state.splitOffers = []
      return RESULT
    })
    .on('POST /plan/undo', () => {
      state.blocks = [FRICTION]
      state.splitOffers = [OFFER]
      return {}
    })
  return calendar
}

function column(date: string) {
  const el = document.querySelector<HTMLElement>(`[data-date="${date}"]`)
  if (el === null) throw new Error(`no column for ${date}`)
  return el
}

function targets(date: string) {
  return column(date).querySelectorAll('[data-ghost][data-tone="target"]')
}

function frictionBlock() {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${FRICTION.id}"]`)
  if (el === null) throw new Error('no block')
  return el
}

function splitRow() {
  return document.querySelector<HTMLElement>('[data-banner-row="split"]')
}

async function showMe(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: s.show }))
  await waitFor(() => {
    expect(document.querySelector('[data-ghost]')).not.toBeNull()
  })
}

async function toasts() {
  return within(await screen.findByRole('region', { name: en.common.notifications }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(CAL_NOW))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('the split offer on a computer', () => {
  beforeEach(() => {
    stubMedia({ desktop: true })
  })

  it('"Show me" draws a ghost for each part on its day, and marks the block that will move', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText(s.say(OFFER.task_title, 90, 30))).toBeInTheDocument()
    expect(document.querySelector('[data-ghost]')).toBeNull()
    await showMe(user)
    expect(targets('2026-11-24')).toHaveLength(1)
    expect(targets('2026-11-25')).toHaveLength(1)
    expect(targets('2026-11-26')).toHaveLength(1)
    expect(document.querySelectorAll('[data-ghost]')).toHaveLength(3)
    expect(within(frictionBlock()).getByText(en.calendar.grid.ghostLeaving)).toBeInTheDocument()
    // Closing the row takes the preview off the grid.
    await user.click(screen.getByRole('button', { name: en.calendar.side.banner.close }))
    expect(document.querySelector('[data-ghost]')).toBeNull()
    expect(within(frictionBlock()).queryByText(en.calendar.grid.ghostLeaving)).not.toBeInTheDocument()
  })

  it('the split sends the basis; then a toast with Undo, no row, no ghost, and the focus on the heading', async () => {
    const user = userEvent.setup()
    const { fake } = open()
    await showMe(user)
    await user.click(screen.getByRole('button', { name: s.action(3, 30, true) }))
    await waitFor(() => {
      expect(splitRow()).toBeNull()
    })
    const calls = fake.calls('POST', SPLIT_PATH)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body).toEqual({ basis: OFFER.basis })
    expect((await toasts()).getByRole('button', { name: en.common.undo })).toBeInTheDocument()
    expect(document.querySelector('[data-ghost]')).toBeNull()
    expect(screen.getByRole('heading', { name: en.calendar.page.planHeading })).toHaveFocus()
    await waitFor(() => {
      expect(document.querySelector('[data-block-id="bite-0"]')).not.toBeNull()
    })
    expect(document.querySelector(`[data-block-id="${FRICTION.id}"]`)).toBeNull()
  })

  it('Undo sends POST /plan/undo, and the offer comes back, closed', async () => {
    const user = userEvent.setup()
    const { fake } = open()
    await showMe(user)
    await user.click(screen.getByRole('button', { name: s.action(3, 30, true) }))
    await user.click((await toasts()).getByRole('button', { name: en.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/undo')).toHaveLength(1)
    })
    expect(fake.calls('POST', '/plan/undo')[0]?.body).toEqual({ version_id: 'v-split' })
    expect(await screen.findByRole('button', { name: s.show })).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })

  it('stays open across a move to the next week, and draws the part that falls there', async () => {
    const user = userEvent.setup()
    const next = { starts_at: '2026-11-29T07:00:00Z', ends_at: '2026-11-29T07:30:00Z', minutes: 30 }
    open({ splitOffers: [makeSplitOffer({ parts: [...OFFER.parts.slice(0, 2), next] })] })
    await showMe(user)
    expect(document.querySelectorAll('[data-ghost]')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: en.calendar.page.nextWeek }))
    await waitFor(() => {
      expect(document.querySelector('[data-date="2026-11-29"]')).not.toBeNull()
    })
    expect(screen.getByRole('button', { name: en.calendar.side.banner.close })).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => {
      expect(targets('2026-11-29')).toHaveLength(1)
    })
    expect(document.querySelectorAll('[data-ghost]')).toHaveLength(1)
  })

  // Review Focus 3: an open sheet has the grid to itself.
  it('a sheet opened over the open row hides the ghosts of the split, and Escape brings them back', async () => {
    const user = userEvent.setup()
    open()
    await showMe(user)
    await user.click(frictionBlock())
    await screen.findByRole('dialog', { name: en.calendar.sheets.actions.title })
    expect(document.querySelector('[data-ghost]')).toBeNull()
    expect(within(frictionBlock()).queryByText(en.calendar.grid.ghostLeaving)).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-ghost][data-tone="target"]')).toHaveLength(3)
    })
    expect(within(frictionBlock()).getByText(en.calendar.grid.ghostLeaving)).toBeInTheDocument()
  })

  it('a stale plan (409) is one toast in Archi’s words, no block changes, and the offers are asked again', async () => {
    const user = userEvent.setup()
    const { fake } = open()
    fake.on(`POST ${SPLIT_PATH}`, problem(409, 'stale_plan'))
    await showMe(user)
    const before = fake.calls('GET', '/split-offers').length
    await user.click(screen.getByRole('button', { name: s.action(3, 30, true) }))
    expect(await (await toasts()).findByText(s.stale)).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/split-offers').length).toBeGreaterThan(before)
    })
    expect(document.querySelector(`[data-block-id="${FRICTION.id}"]`)).not.toBeNull()
    expect(document.querySelector('[data-block-id="bite-0"]')).toBeNull()
    // The offer the server still gives stays on screen.
    expect(splitRow()).not.toBeNull()
  })
})

describe('the split offer on a phone', () => {
  beforeEach(() => {
    stubMedia({ desktop: false })
  })

  it('sits under the header and the strip of days, and names all three days though the grid shows one', async () => {
    const user = userEvent.setup()
    open()
    await showMe(user)
    const row = splitRow()
    if (row === null) throw new Error('no split row')
    const strip = screen.getByRole('group', { name: en.calendar.side.stripLabel })
    expect(strip.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row.compareDocumentPosition(column(CAL_TODAY)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelectorAll('[data-date]')).toHaveLength(1)
    const lines = within(within(row).getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)
    expect(lines).toEqual(['Today, 16:00–16:30, 30 min', 'Tomorrow, 09:00–09:30, 30 min', 'Thu, 26 Nov, 09:00–09:30, 30 min'])
    // Only today's part is on the one day of the grid.
    expect(document.querySelectorAll('[data-ghost]')).toHaveLength(1)
  })
})
