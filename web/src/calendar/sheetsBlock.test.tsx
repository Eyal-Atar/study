import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Block } from '../board/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { blockName } from '../board/blockName'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
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

function setupActions(block: Block) {
  const fake = fakeFor(block)
  const onClose = vi.fn()
  const onDefer = vi.fn()
  renderBoard(<BlockActionsSheet block={block} tz={TZ} onClose={onClose} onDefer={onDefer} />, { api: fake.api })
  return { fake, onClose, onDefer }
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
