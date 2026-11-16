import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { codeText } from '../i18n/codes'
import { he } from '../i18n/he'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard, USER_ID } from '../test/boardFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
import { todayKey } from './api'
import { BlockCard } from './BlockCard'
import type { Block, Slots, Today } from './types'

const TITLE = 'פרק 3: גרפים'
const BLOCK = makeBlock()

function slots(list: string[]): Slots {
  return { study_date: '2026-11-16', day_starts_at: '2026-11-16T05:00:00Z', day_ends_at: '2026-11-16T21:00:00Z', slots: list }
}

function setup({ variant = 'full', reply = slots(['2026-11-16T13:00:00Z', '2026-11-16T13:30:00Z']) }: { variant?: 'full' | 'compact'; reply?: unknown } = {}) {
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', makeToday([BLOCK]))
    .on({ method: 'GET', path: /^\/plan/ }, makePlan([BLOCK]))
    .on(`GET /blocks/${BLOCK.id}/slots`, reply)
  const rendered = renderBoard(<BlockCard block={BLOCK} tz="Asia/Jerusalem" variant={variant} />, { api: fake.api })
  return { fake, ...rendered }
}

async function toasts() {
  return within(await screen.findByRole('region', { name: he.common.notifications }))
}

async function openDialog() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: he.move.moveLabel(TITLE) }))
  const dialog = await screen.findByRole('dialog', { name: he.move.dialogTitle(TITLE) })
  return { user, dialog: within(dialog) }
}

describe('MoveDialog', () => {
  it('lists the free times, and moving sends PATCH with the chosen start', async () => {
    const { fake, queryClient } = setup()
    const { user, dialog } = await openDialog()
    const list = await dialog.findByRole('listbox', { name: he.move.slotsLabel })
    // The cache holds today (after the sign-in settled, which clears it), so the optimistic move shows in it.
    queryClient.setQueryData<Today>(todayKey(USER_ID), makeToday([BLOCK]))
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['15:00', '15:30'])
    expect(dialog.getByRole('button', { name: he.move.confirm })).toBeDisabled()

    fake.on(`PATCH /blocks/${BLOCK.id}`, (call: { body: { starts_at: string } }) => ({
      ...BLOCK,
      starts_at: call.body.starts_at,
      ends_at: '2026-11-16T14:30:00Z',
      pinned: true,
    }))
    await user.click(within(list).getByRole('option', { name: '15:30' }))
    await user.click(dialog.getByRole('button', { name: he.move.confirm }))

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
    expect(await region.findByText(he.move.moved('15:30'))).toBeInTheDocument()
    await user.click(region.getByRole('button', { name: he.common.undo }))
    await waitFor(() => {
      expect(fake.calls('PATCH', `/blocks/${BLOCK.id}`)[1]?.body).toEqual({ starts_at: BLOCK.starts_at, pinned: false })
    })
    // The region mounts again once the first toast went, so look it up again.
    expect(await (await toasts()).findByText(he.move.undone)).toBeInTheDocument()
  })

  it('says so when there is no other free time', async () => {
    setup({ reply: slots([]) })
    const { dialog } = await openDialog()
    expect(await dialog.findByText(he.move.empty)).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: he.move.confirm })).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: he.common.cancel })).toBeInTheDocument()
  })

  it('shows a failed load with a retry', async () => {
    const { fake } = setup({ reply: problem(0, 'network') })
    const { user, dialog } = await openDialog()
    expect(await dialog.findByRole('alert')).toHaveTextContent(he.move.loadFailed)
    fake.on(`GET /blocks/${BLOCK.id}/slots`, slots(['2026-11-16T13:00:00Z']))
    await user.click(dialog.getByRole('button', { name: he.common.retry }))
    expect(await dialog.findByRole('option', { name: '15:00' })).toBeInTheDocument()
  })

  it('cancel closes without a request', async () => {
    const { fake } = setup()
    const { user, dialog } = await openDialog()
    await dialog.findByRole('listbox')
    await user.click(dialog.getByRole('button', { name: he.common.cancel }))
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
    await user.click(dialog.getByRole('button', { name: he.move.confirm }))

    const region = await toasts()
    expect(await region.findByText(codeText('slot_taken'))).toBeInTheDocument()
    const back: Block | undefined = queryClient.getQueryData<Today>(todayKey(USER_ID))?.blocks[0]
    expect(back?.starts_at).toBe(BLOCK.starts_at)
    expect(back?.pinned).toBe(false)
  })

  it('opens from the actions menu of the compact card', async () => {
    const user = userEvent.setup()
    setup({ variant: 'compact' })
    await user.click(screen.getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    await user.click(await screen.findByRole('menuitem', { name: he.move.move }))
    const dialog = within(await screen.findByRole('dialog', { name: he.move.dialogTitle(TITLE) }))
    expect(await dialog.findByRole('option', { name: '15:30' })).toBeInTheDocument()
  })
})
