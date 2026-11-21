import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard, USER_ID } from '../test/boardFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
import { todayKey } from './api'
import { BlockRow } from './BlockRow'
import { formatRange } from './time'
import type { Block, Slots, Today } from './types'

const TITLE = 'פרק 3: גרפים'
const BLOCK = makeBlock()

function slots(list: string[]): Slots {
  return { study_date: '2026-11-16', day_starts_at: '2026-11-16T05:00:00Z', day_ends_at: '2026-11-16T21:00:00Z', slots: list }
}

function setup({ reply = slots(['2026-11-16T13:00:00Z', '2026-11-16T13:30:00Z']) }: { reply?: unknown } = {}) {
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', makeToday([BLOCK]))
    .on({ method: 'GET', path: /^\/plan/ }, makePlan([BLOCK]))
    .on(`GET /blocks/${BLOCK.id}/slots`, reply)
  // A row is an <li>: it sits in a list.
  const rendered = renderBoard(
    <ul>
      <BlockRow block={BLOCK} tz="Asia/Jerusalem" />
    </ul>,
    { api: fake.api },
  )
  return { fake, ...rendered }
}

async function toasts() {
  return within(await screen.findByRole('region', { name: en.common.notifications }))
}

// "הזזה" is in the row's menu (S27): the menu button, then the item.
async function openMenuItem(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: en.board.actionsLabel(TITLE) }))
  await user.click(await screen.findByRole('menuitem', { name: en.move.move }))
}

async function openDialog() {
  const user = userEvent.setup()
  await openMenuItem(user)
  const dialog = await screen.findByRole('dialog', { name: en.move.dialogTitle(TITLE) })
  return { user, dialog: within(dialog) }
}

describe('MoveDialog', () => {
  it('lists the free times, and moving sends PATCH with the chosen start', async () => {
    const { fake, queryClient } = setup()
    const { user, dialog } = await openDialog()
    const list = await dialog.findByRole('listbox', { name: en.move.slotsLabel })
    // The cache holds today (after the sign-in settled, which clears it), so the optimistic move shows in it.
    queryClient.setQueryData<Today>(todayKey(USER_ID), makeToday([BLOCK]))
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['15:00', '15:30'])
    expect(dialog.getByRole('button', { name: en.move.confirm })).toBeDisabled()

    fake.on(`PATCH /blocks/${BLOCK.id}`, (call: { body: { starts_at: string } }) => ({
      ...BLOCK,
      starts_at: call.body.starts_at,
      ends_at: '2026-11-16T14:30:00Z',
      pinned: true,
    }))
    await user.click(within(list).getByRole('option', { name: '15:30' }))
    await user.click(dialog.getByRole('button', { name: en.move.confirm }))

    await waitFor(() => {
      expect(fake.calls('PATCH', `/blocks/${BLOCK.id}`)).toEqual([
        { method: 'PATCH', path: `/blocks/${BLOCK.id}`, body: { starts_at: '2026-11-16T13:30:00Z' } },
      ])
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const moved = queryClient.getQueryData<Today>(todayKey(USER_ID))?.blocks[0]
    expect(moved?.starts_at).toBe('2026-11-16T13:30:00.000Z')
    expect(moved?.ends_at).toBe('2026-11-16T14:30:00.000Z')
    expect(moved?.pinned).toBe(true)

    const region = await toasts()
    expect(await region.findByText(en.move.moved('15:30'))).toBeInTheDocument()
    await user.click(region.getByRole('button', { name: en.common.undo }))
    await waitFor(() => {
      expect(fake.calls('PATCH', `/blocks/${BLOCK.id}`)[1]?.body).toEqual({ starts_at: BLOCK.starts_at, pinned: false })
    })
    // The region mounts again once the first toast went, so look it up again.
    expect(await (await toasts()).findByText(en.move.undone)).toBeInTheDocument()
  })

  it('says so when there is no other free time', async () => {
    setup({ reply: slots([]) })
    const { dialog } = await openDialog()
    expect(await dialog.findByText(en.move.empty)).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: en.move.confirm })).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: en.common.cancel })).toBeInTheDocument()
  })

  it('shows a failed load with a retry', async () => {
    const { fake } = setup({ reply: problem(0, 'network') })
    const { user, dialog } = await openDialog()
    expect(await dialog.findByRole('alert')).toHaveTextContent(en.move.loadFailed)
    fake.on(`GET /blocks/${BLOCK.id}/slots`, slots(['2026-11-16T13:00:00Z']))
    await user.click(dialog.getByRole('button', { name: en.common.retry }))
    expect(await dialog.findByRole('option', { name: '15:00' })).toBeInTheDocument()
  })

  it('cancel closes without a request', async () => {
    const { fake } = setup()
    const { user, dialog } = await openDialog()
    await dialog.findByRole('listbox')
    await user.click(dialog.getByRole('button', { name: en.common.cancel }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('a refused move puts the block back and says why', async () => {
    const { fake, queryClient } = setup()
    fake.on(`PATCH /blocks/${BLOCK.id}`, problem(409, 'slot_taken', { blocked_by: 'other' }))
    const { user, dialog } = await openDialog()
    const option = await dialog.findByRole('option', { name: '15:00' })
    queryClient.setQueryData<Today>(todayKey(USER_ID), makeToday([BLOCK]))
    await user.click(option)
    await user.click(dialog.getByRole('button', { name: en.move.confirm }))

    const region = await toasts()
    expect(await region.findByText(codeText('slot_taken'))).toBeInTheDocument()
    const back: Block | undefined = queryClient.getQueryData<Today>(todayKey(USER_ID))?.blocks[0]
    expect(back?.starts_at).toBe(BLOCK.starts_at)
    expect(back?.pinned).toBe(false)
  })

  it('names itself after the block, says what moving does, and shows the time the block has now', async () => {
    setup()
    await openDialog()
    const dialog = screen.getByRole('dialog', { name: en.move.dialogTitle(TITLE) })
    expect(dialog).toHaveAccessibleDescription(en.move.dialogLead)
    expect(within(dialog).getByText(formatRange(BLOCK, 'Asia/Jerusalem'))).toHaveAttribute('dir', 'ltr')
  })

  it('pressing the chosen time again leaves nothing chosen', async () => {
    const { fake } = setup()
    const { user, dialog } = await openDialog()
    const option = await dialog.findByRole('option', { name: '15:00' })
    await user.click(option)
    expect(option).toHaveAttribute('aria-selected', 'true')
    expect(dialog.getByRole('button', { name: en.move.confirm })).toBeEnabled()

    await user.click(option)
    expect(option).toHaveAttribute('aria-selected', 'false')
    expect(dialog.getByRole('button', { name: en.move.confirm })).toBeDisabled()
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('the close button closes without a request', async () => {
    const { fake } = setup()
    const { user, dialog } = await openDialog()
    await dialog.findByRole('listbox')
    await user.click(dialog.getByRole('button', { name: en.common.close }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('every opening asks the server anew and starts with nothing chosen', async () => {
    const { fake } = setup()
    const { user, dialog } = await openDialog()
    await user.click(await dialog.findByRole('option', { name: '15:00' }))
    await user.click(dialog.getByRole('button', { name: en.common.cancel }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    // How many requests one opening makes depends on the harness (StrictMode mounts twice, and the
    // first request is cancelled), so the count is compared and not fixed.
    const before = fake.calls('GET', `/blocks/${BLOCK.id}/slots`).length
    expect(before).toBeGreaterThan(0)

    await openMenuItem(user)
    const again = within(await screen.findByRole('dialog', { name: en.move.dialogTitle(TITLE) }))
    await waitFor(() => {
      expect(fake.calls('GET', `/blocks/${BLOCK.id}/slots`).length).toBeGreaterThan(before)
    })
    expect(await again.findByRole('option', { name: '15:00' })).toHaveAttribute('aria-selected', 'false')
    expect(again.getByRole('button', { name: en.move.confirm })).toBeDisabled()
  })
})
