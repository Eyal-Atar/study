import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Block } from '../board/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { blockName } from '../board/blockName'
import { USER_ID, makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
import { BUTTON_REST } from '../ui/styles'
import { focusPath, focusStorageKey, type FocusSession } from '../session/focusSession'
import { BlockActionsSheet } from './BlockActionsSheet'
import { DeferSheet } from './DeferSheet'
import type { Ghost } from './ghost'

const TZ = 'Asia/Jerusalem'
const TITLE = 'פרק 3: גרפים'
const TODAY = '2026-11-16'

function fakeFor(block: Block) {
  return createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', makeToday([block]))
    .on({ method: 'GET', path: /^\/plan/ }, makePlan([block]))
    .on(`POST /blocks/${block.id}/complete`, { block, xp_awarded: 0, xp_total: 0, level: 1 })
}

function setupActions(block: Block, { today = TODAY, now = Date.now() }: { today?: string; now?: number } = {}) {
  const fake = fakeFor(block)
  const onClose = vi.fn()
  const onDefer = vi.fn()
  const { router } = renderBoard(<BlockActionsSheet block={block} tz={TZ} today={today} now={now} onClose={onClose} onDefer={onDefer} />, {
    api: fake.api,
  })
  return { fake, onClose, onDefer, router }
}

function setupDefer(block: Block, extra?: (fake: ReturnType<typeof createFakeApi>) => void) {
  const fake = fakeFor(block)
  extra?.(fake)
  const onClose = vi.fn()
  const onPreview = vi.fn<(ghosts: Ghost[]) => void>()
  renderBoard(<DeferSheet block={block} tz={TZ} today={TODAY} onClose={onClose} onPreview={onPreview} />, { api: fake.api })
  return { fake, onClose, onPreview }
}

function buttonNames(): (string | null)[] {
  return screen
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent)
}

describe('BlockActionsSheet', () => {
  it('shows the five buttons of an upcoming block, named from the en functions', async () => {
    const block = makeBlock()
    setupActions(block)
    const name = blockName(block)
    await screen.findByRole('dialog', { name: en.calendar.sheets.actions.title })
    const names = buttonNames()
    for (const expected of [
      en.board.completeLabel(name),
      en.board.deferLabel(name),
      en.move.moveLabel(name),
      en.board.pinLabel(name),
      en.review.skipLabel(name),
    ]) {
      expect(names).toContain(expected)
    }
    expect(screen.getByText(en.calendar.sheets.actions.skipHint)).toBeInTheDocument()
  })

  it('puts the task name in data-user-text', async () => {
    setupActions(makeBlock())
    await screen.findByRole('dialog')
    const marked = document.querySelectorAll('[data-user-text]')
    expect([...marked].some((el) => el.textContent === TITLE)).toBe(true)
  })

  it('offers only uncomplete for a done block', async () => {
    const block = makeBlock({ state: 'done', status: 'done' })
    setupActions(block)
    await screen.findByRole('dialog')
    const names = buttonNames()
    expect(names).toContain(en.board.uncompleteLabel(blockName(block)))
    expect(names).not.toContain(en.board.completeLabel(blockName(block)))
    expect(names).not.toContain(en.board.deferLabel(blockName(block)))
    expect(names).not.toContain(en.review.skipLabel(blockName(block)))
  })

  it('has no Move for an overdue block', async () => {
    const block = makeBlock({ state: 'overdue' })
    setupActions(block)
    await screen.findByRole('dialog')
    expect(buttonNames()).not.toContain(en.move.moveLabel(blockName(block)))
  })

  it('Done posts the complete request and closes', async () => {
    const block = makeBlock()
    const { fake, onClose } = setupActions(block)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: en.board.completeLabel(blockName(block)) }))
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${block.id}/complete`)).toHaveLength(1)
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('Move opens the move dialog', async () => {
    const block = makeBlock()
    const { fake } = setupActions(block)
    fake.on(`GET /blocks/${block.id}/slots`, { study_date: TODAY, day_starts_at: null, day_ends_at: null, slots: [] })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: en.move.moveLabel(blockName(block)) }))
    expect(await screen.findByRole('dialog', { name: en.move.dialogTitle(TITLE) })).toBeInTheDocument()
  })

  it('Defer calls onDefer', async () => {
    const block = makeBlock()
    const { onDefer } = setupActions(block)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: en.board.deferLabel(blockName(block)) }))
    expect(onDefer).toHaveBeenCalledWith(block)
  })

  it('Skip posts the skip request', async () => {
    const block = makeBlock()
    const { fake } = setupActions(block)
    fake.on(`POST /blocks/${block.id}/skip`, { task_status: 'skipped', version_id: null })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: en.review.skipLabel(blockName(block)) }))
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${block.id}/skip`)).toHaveLength(1)
    })
  })
})

const SLOTS = {
  study_date: TODAY,
  day_starts_at: '2026-11-16T05:00:00Z',
  day_ends_at: '2026-11-16T21:00:00Z',
  slots: ['2026-11-16T12:00:00Z', '2026-11-16T12:15:00Z'],
}

describe('DeferSheet', () => {
  it('asks the question as its title', async () => {
    setupDefer(makeBlock())
    expect(await screen.findByRole('dialog', { name: en.calendar.sheets.defer.title })).toBeInTheDocument()
  })

  it('Tomorrow posts { to: tomorrow } and closes after the answer', async () => {
    const block = makeBlock()
    const { fake, onClose } = setupDefer(block, (f) => {
      f.on(`POST /blocks/${block.id}/defer`, { blocks: [block], version_id: null, placed_task_ids: [] })
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: en.calendar.sheets.defer.tomorrow }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(fake.calls('POST', `/blocks/${block.id}/defer`)[0]?.body).toEqual({ to: 'tomorrow' })
  })

  it('Next free spot posts { to: next }', async () => {
    const block = makeBlock()
    const { fake } = setupDefer(block, (f) => {
      f.on(`POST /blocks/${block.id}/defer`, { blocks: [block], version_id: null, placed_task_ids: [] })
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: en.calendar.sheets.defer.next }))
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${block.id}/defer`)).toHaveLength(1)
    })
    expect(fake.calls('POST', `/blocks/${block.id}/defer`)[0]?.body).toEqual({ to: 'next' })
  })

  it('Pick a time loads the slots, previews the choice and sends { to: at }', async () => {
    const block = makeBlock()
    const { fake, onPreview } = setupDefer(block, (f) => {
      f.on(`GET /blocks/${block.id}/slots?date=${TODAY}`, SLOTS)
      f.on(`POST /blocks/${block.id}/defer`, { blocks: [block], version_id: null, placed_task_ids: [] })
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: en.calendar.sheets.defer.pick }))
    const grid = await screen.findByRole('listbox', { name: en.calendar.sheets.defer.slots })
    await user.click(within(grid).getByRole('option', { name: '14:15' }))
    const confirm = await screen.findByRole('button', { name: en.calendar.sheets.defer.confirmAt('14:15') })
    const ghosts = onPreview.mock.calls.at(-1)?.[0]
    expect(ghosts).toHaveLength(1)
    expect(ghosts?.[0]?.startMin).toBe(855)
    await user.click(confirm)
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${block.id}/defer`)).toHaveLength(1)
    })
    expect(fake.calls('POST', `/blocks/${block.id}/defer`)[0]?.body).toEqual({ to: 'at', starts_at: '2026-11-16T12:15:00Z' })
  })

  it('shows slot_busy inside the sheet, with no toast, and stays open', async () => {
    const block = makeBlock()
    const { onClose } = setupDefer(block, (f) => {
      f.on(`GET /blocks/${block.id}/slots?date=${TODAY}`, SLOTS)
      f.on(`POST /blocks/${block.id}/defer`, problem(409, 'slot_busy'))
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: en.calendar.sheets.defer.pick }))
    const grid = await screen.findByRole('listbox', { name: en.calendar.sheets.defer.slots })
    await user.click(within(grid).getByRole('option', { name: '14:15' }))
    await user.click(await screen.findByRole('button', { name: en.calendar.sheets.defer.confirmAt('14:15') }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(codeText('slot_busy'))).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: en.common.notifications })?.textContent ?? '').not.toContain(codeText('slot_busy'))
    expect(onClose).not.toHaveBeenCalled()
  })

  // S32 final review, M1: a refusal that comes after the sheet is gone is not silent, and closes nothing.
  it('a slot_busy answered after the sheet is gone is a toast, and onClose is not called', async () => {
    const block = makeBlock()
    const fake = fakeFor(block)
    fake.on(`GET /blocks/${block.id}/slots?date=${TODAY}`, SLOTS)
    let reject!: (error: unknown) => void
    fake.on(`POST /blocks/${block.id}/defer`, () => new Promise((_, rej) => { reject = rej }))
    const onClose = vi.fn()
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => { setOpen(false) }}>hide</button>
          {open ? <DeferSheet block={block} tz={TZ} today={TODAY} onClose={onClose} onPreview={vi.fn()} /> : null}
        </>
      )
    }
    renderBoard(<Harness />, { api: fake.api })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: en.calendar.sheets.defer.pick }))
    const grid = await screen.findByRole('listbox', { name: en.calendar.sheets.defer.slots })
    await user.click(within(grid).getByRole('option', { name: '14:15' }))
    await user.click(await screen.findByRole('button', { name: en.calendar.sheets.defer.confirmAt('14:15') }))
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${block.id}/defer`)).toHaveLength(1)
    })
    // The dialog makes the rest of the page inert, so the press goes in as a plain event.
    fireEvent.click(screen.getByRole('button', { name: 'hide', hidden: true }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    reject(problem(409, 'slot_busy'))
    const region = await screen.findByRole('region', { name: en.common.notifications })
    expect(await within(region).findByText(codeText('slot_busy'))).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on placement_failed', async () => {
    const block = makeBlock()
    const { onClose } = setupDefer(block, (f) => {
      f.on(`POST /blocks/${block.id}/defer`, problem(409, 'placement_failed', { reason: 'no_room' }))
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: en.calendar.sheets.defer.next }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('Skip shows its hint and skips the task', async () => {
    const block = makeBlock()
    const { fake } = setupDefer(block, (f) => {
      f.on(`POST /blocks/${block.id}/skip`, { task_status: 'skipped', version_id: null })
    })
    const user = userEvent.setup()
    expect(await screen.findByText(en.calendar.sheets.actions.skipHint)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: en.calendar.sheets.defer.skip }))
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${block.id}/skip`)).toHaveLength(1)
    })
  })

  it('Escape clears the preview and closes', async () => {
    const { onClose, onPreview } = setupDefer(makeBlock())
    const user = userEvent.setup()
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(onPreview).toHaveBeenLastCalledWith([])
  })
})

// Start now, Just 5 minutes and Back to focus (S42 Task 5). The block is 14:00-15:00 in Jerusalem.
describe('BlockActionsSheet, focus', () => {
  const START = Date.parse('2026-11-16T12:00:00Z')
  const BEFORE = Date.parse('2026-11-16T09:00:00Z')

  afterEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
  })

  function freeze(now: number) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    window.localStorage.clear()
  }

  function stored(): FocusSession | null {
    const raw = window.localStorage.getItem(focusStorageKey(USER_ID))
    return raw === null ? null : (JSON.parse(raw) as FocusSession)
  }

  function isPrimary(button: HTMLElement) {
    return button.className.split(/\s+/).includes(BUTTON_REST.primary.split(/\s+/)[0] as string)
  }

  it('a block of today that has not started: Start now first and the only primary, then Just 5 minutes, Done secondary', async () => {
    freeze(BEFORE)
    const block = makeBlock()
    setupActions(block, { now: BEFORE })
    await screen.findByRole('dialog')
    const name = blockName(block)
    const start = screen.getByRole('button', { name: en.focus.startLabel(name) })
    const five = screen.getByRole('button', { name: en.focus.fiveLabel(name) })
    const done = screen.getByRole('button', { name: en.board.completeLabel(name) })
    const names = buttonNames()
    expect(names.indexOf(en.focus.startLabel(name))).toBeLessThan(names.indexOf(en.board.completeLabel(name)))
    expect(names.indexOf(en.focus.startLabel(name))).toBeLessThan(names.indexOf(en.focus.fiveLabel(name)))
    expect(names.indexOf(en.focus.fiveLabel(name))).toBe(names.indexOf(en.focus.startLabel(name)) + 1)
    expect(isPrimary(start)).toBe(true)
    expect(isPrimary(five)).toBe(false)
    expect(isPrimary(done)).toBe(false)
  })

  it('with four minutes left: Start now, no Just 5 minutes', async () => {
    const now = Date.parse('2026-11-16T12:56:00Z')
    freeze(now)
    const block = makeBlock()
    setupActions(block, { now })
    await screen.findByRole('dialog')
    expect(buttonNames()).toContain(en.focus.startLabel(blockName(block)))
    expect(buttonNames()).not.toContain(en.focus.fiveLabel(blockName(block)))
  })

  it('a block that ended: no Start now, Done stays the primary', async () => {
    freeze(Date.parse('2026-11-16T13:30:00Z'))
    const ended = makeBlock()
    setupActions(ended, { now: Date.now() })
    await screen.findByRole('dialog')
    expect(buttonNames()).not.toContain(en.focus.startLabel(blockName(ended)))
    expect(isPrimary(screen.getByRole('button', { name: en.board.completeLabel(blockName(ended)) }))).toBe(true)
  })

  it('a done block: no Start now', async () => {
    freeze(BEFORE)
    const block = makeBlock({ state: 'done', status: 'done' })
    setupActions(block, { now: BEFORE })
    await screen.findByRole('dialog')
    expect(buttonNames()).not.toContain(en.focus.startLabel(blockName(block)))
    expect(buttonNames()).toContain(en.board.uncompleteLabel(blockName(block)))
  })

  it('a block of tomorrow: no Start now', async () => {
    freeze(BEFORE)
    const block = makeBlock({ study_date: '2026-11-17', starts_at: '2026-11-17T12:00:00Z', ends_at: '2026-11-17T13:00:00Z' })
    setupActions(block, { now: BEFORE })
    await screen.findByRole('dialog')
    expect(buttonNames()).not.toContain(en.focus.startLabel(blockName(block)))
    expect(isPrimary(screen.getByRole('button', { name: en.board.completeLabel(blockName(block)) }))).toBe(true)
  })

  it('a live session of this block: only Back to focus; a session that ended brings Start now back', async () => {
    freeze(BEFORE)
    const block = makeBlock()
    const live: FocusSession = { v: 1, blockId: block.id, startedAt: BEFORE - 60_000, endsAt: START + 3_600_000, fiveEndsAt: null }
    window.localStorage.setItem(focusStorageKey(USER_ID), JSON.stringify(live))
    setupActions(block, { now: BEFORE })
    await screen.findByRole('dialog')
    const name = blockName(block)
    expect(buttonNames()).toContain(en.focus.resume)
    expect(buttonNames()).not.toContain(en.focus.startLabel(name))
    expect(buttonNames()).not.toContain(en.focus.fiveLabel(name))
    expect(isPrimary(screen.getByRole('button', { name: en.focus.resume }))).toBe(true)
    expect(isPrimary(screen.getByRole('button', { name: en.board.completeLabel(name) }))).toBe(false)
  })

  it('a session that is over does not count: Start now is back', async () => {
    freeze(BEFORE)
    const block = makeBlock()
    const over: FocusSession = { v: 1, blockId: block.id, startedAt: BEFORE - 3_600_000, endsAt: BEFORE - 1000, fiveEndsAt: null }
    window.localStorage.setItem(focusStorageKey(USER_ID), JSON.stringify(over))
    setupActions(block, { now: BEFORE })
    await screen.findByRole('dialog')
    expect(buttonNames()).toContain(en.focus.startLabel(blockName(block)))
    expect(buttonNames()).not.toContain(en.focus.resume)
  })

  it('a live session of another block does not hide Start now', async () => {
    freeze(BEFORE)
    const block = makeBlock()
    const other: FocusSession = { v: 1, blockId: 'other', startedAt: BEFORE, endsAt: BEFORE + 3_600_000, fiveEndsAt: null }
    window.localStorage.setItem(focusStorageKey(USER_ID), JSON.stringify(other))
    setupActions(block, { now: BEFORE })
    await screen.findByRole('dialog')
    expect(buttonNames()).toContain(en.focus.startLabel(blockName(block)))
  })

  it('Start now closes the sheet, goes to the screen and stores a full session', async () => {
    freeze(BEFORE)
    const block = makeBlock()
    const { onClose, router } = setupActions(block, { now: BEFORE })
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: en.focus.startLabel(blockName(block)) }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(focusPath(block.id))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(stored()).toMatchObject({ blockId: block.id, startedAt: BEFORE, fiveEndsAt: null })
  })

  it('Just 5 minutes stores fiveEndsAt five minutes on', async () => {
    freeze(BEFORE)
    const block = makeBlock()
    const { onClose, router } = setupActions(block, { now: BEFORE })
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: en.focus.fiveLabel(blockName(block)) }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(focusPath(block.id))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(stored()?.fiveEndsAt).toBe(BEFORE + 300_000)
  })

  it('Back to focus goes back to the same session without rewriting it', async () => {
    freeze(BEFORE)
    const block = makeBlock()
    const live: FocusSession = { v: 1, blockId: block.id, startedAt: BEFORE - 120_000, endsAt: START + 3_600_000, fiveEndsAt: null }
    window.localStorage.setItem(focusStorageKey(USER_ID), JSON.stringify(live))
    const { onClose, router } = setupActions(block, { now: BEFORE })
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: en.focus.resume }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(focusPath(block.id))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(stored()).toEqual(live)
  })
})
