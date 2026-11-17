import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi } from '../test/fakeApi'
import { NextBlock } from '../today/NextBlock'
import { List } from '../ui/List'
import { blockName } from './blockName'
import { BlockRow } from './BlockRow'
import type { Block, BlockState } from './types'

const TITLE = 'פרק 3: גרפים'
const TZ = 'Asia/Jerusalem'

// A promise the test resolves when it wants.
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function setup(ui: ReactNode, blocks: Block[], tz = TZ) {
  const fake = createFakeApi()
    .on('GET /me', makeMe(tz))
    .on('GET /today', makeToday(blocks))
    .on({ method: 'GET', path: /^\/plan/ }, makePlan(blocks))
  const rendered = renderBoard(ui, { api: fake.api })
  return { fake, ...rendered }
}

function setupRow(block: Block, tz = TZ) {
  return setup(
    <List>
      <BlockRow block={block} tz={tz} />
    </List>,
    [block],
    tz,
  )
}

function setupNext(block: Block, { tz = TZ, when }: { tz?: string; when?: string } = {}) {
  return setup(when === undefined ? <NextBlock block={block} tz={tz} /> : <NextBlock block={block} tz={tz} when={when} />, [block], tz)
}

// A row has no name of its own (ListRow takes none): it is the list item that holds the title.
function rowOf(title: string): HTMLElement {
  const item = screen.getByText(title).closest('li')
  if (item === null) throw new Error(`no row for ${title}`)
  return item
}

function row() {
  return within(rowOf(TITLE))
}

function rowEl() {
  return rowOf(TITLE)
}

function nextEl() {
  return screen.getByRole('region', { name: he.today.next })
}

function next() {
  return within(nextEl())
}

function names(scope: HTMLElement): (string | null)[] {
  return within(scope)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent)
}

async function menuItems(): Promise<(string | null)[]> {
  const menu = await screen.findByRole('menu')
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent)
}

const planned = (state: BlockState, pinned = false) => makeBlock({ status: 'planned', state, pinned })

describe('BlockRow', () => {
  it('upcoming has a menu and, last, the check button', () => {
    setupRow(planned('upcoming'))
    expect(names(rowEl())).toEqual([he.board.actionsLabel(TITLE), he.board.completeLabel(TITLE)])
    expect(row().getByRole('button', { name: he.board.completeLabel(TITLE) })).toHaveAttribute('aria-pressed', 'false')
  })

  it('the menu of an upcoming block holds defer, move and pin, and never complete', async () => {
    const user = userEvent.setup()
    setupRow(planned('upcoming'))
    await user.click(row().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    expect(await screen.findByRole('menu', { name: he.board.actionsLabel(TITLE) })).toBeInTheDocument()
    expect(await menuItems()).toEqual([he.board.defer, he.move.move, he.board.pin])
  })

  it('the menu of a block in progress holds defer and pin', async () => {
    const user = userEvent.setup()
    setupRow(planned('in_progress'))
    await user.click(row().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    expect(await menuItems()).toEqual([he.board.defer, he.board.pin])
  })

  it.each(['upcoming', 'in_progress'] as const)('the menu of a pinned %s block offers unpin, and the row says it is pinned', async (state) => {
    const user = userEvent.setup()
    setupRow(planned(state, true))
    expect(row().getByText(he.board.pinned)).toBeInTheDocument()
    await user.click(row().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    const items = await menuItems()
    expect(items).toContain(he.board.unpin)
    expect(items).not.toContain(he.board.pin)
  })

  it('an unpinned block does not say it is pinned', () => {
    setupRow(planned('upcoming'))
    expect(row().queryByText(he.board.pinned)).not.toBeInTheDocument()
  })

  it.each([
    ['overdue', 'planned'],
    ['missed', 'missed'],
    ['skipped', 'skipped'],
  ] as const)('%s offers only complete, has no menu, and shows its badge', (state, status) => {
    setupRow(makeBlock({ state, status }))
    expect(names(rowEl())).toEqual([he.board.completeLabel(TITLE)])
    expect(row().getByText(he.board.states[state])).toBeInTheDocument()
  })

  it('done offers only uncomplete, strikes the title through, and has no badge', () => {
    setupRow(makeBlock({ state: 'done', status: 'done' }))
    expect(names(rowEl())).toEqual([he.board.uncompleteLabel(TITLE)])
    expect(row().getByRole('button', { name: he.board.uncompleteLabel(TITLE) })).toHaveAttribute('aria-pressed', 'true')
    expect(row().getByText(TITLE)).toHaveClass('line-through')
    // The check and the line already say it (S27 decision 5).
    expect(row().queryByText(he.board.states.done)).not.toBeInTheDocument()
  })

  it('in progress has the "now" badge, and upcoming has none', () => {
    const { unmount } = setupRow(planned('in_progress'))
    expect(row().getByText(he.board.states.in_progress)).toBeInTheDocument()
    unmount()
    setupRow(planned('upcoming'))
    expect(row().getByText(TITLE)).not.toHaveClass('line-through')
    for (const text of Object.values(he.board.states)) {
      expect(row().queryByText(text)).not.toBeInTheDocument()
    }
  })

  it('shows the part when the task is split, and not otherwise', () => {
    const { unmount } = setupRow(makeBlock({ part_index: 2, part_count: 3 }))
    expect(row().getByText(new RegExp(he.board.part(2, 3)))).toBeInTheDocument()
    expect(he.board.part(2, 3)).toBe('חלק 2 מתוך 3')
    unmount()
    setupRow(makeBlock())
    expect(row().queryByText(/מתוך/)).not.toBeInTheDocument()
  })

  it('a split block names the menu, the menu button and the check button with its part', async () => {
    const user = userEvent.setup()
    setupRow(makeBlock({ part_index: 1, part_count: 2 }))
    const name = 'פרק 3: גרפים (חלק 1 מתוך 2)'
    expect(blockName(makeBlock({ part_index: 1, part_count: 2 }))).toBe(name)
    expect(blockName(makeBlock())).toBe(TITLE)
    expect(names(rowEl())).toEqual([he.board.actionsLabel(name), he.board.completeLabel(name)])
    await user.click(row().getByRole('button', { name: he.board.actionsLabel(name) }))
    expect(await screen.findByRole('menu', { name: he.board.actionsLabel(name) })).toBeInTheDocument()
  })

  it('two parts of one task on one day have different names', () => {
    const first = makeBlock({ id: 'block-1', part_index: 1, part_count: 2 })
    const second = makeBlock({ id: 'block-2', part_index: 2, part_count: 2, starts_at: '2026-11-16T15:00:00Z', ends_at: '2026-11-16T16:00:00Z' })
    setup(
      <List>
        <BlockRow block={first} tz={TZ} />
        <BlockRow block={second} tz={TZ} />
      </List>,
      [first, second],
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    const all = names(screen.getByRole('list'))
    expect(all).toEqual([
      he.board.actionsLabel(blockName(first)),
      he.board.completeLabel(blockName(first)),
      he.board.actionsLabel(blockName(second)),
      he.board.completeLabel(blockName(second)),
    ])
    expect(new Set(all).size).toBe(4)
  })

  it('shows the exam, the kind and the duration, with commas and a full stop', () => {
    setupRow(makeBlock())
    const meta = row().getByText(/אלגוריתמים/)
    expect(meta).toHaveTextContent(he.board.kinds.learn)
    expect(meta).toHaveTextContent(he.board.hour)
    expect(meta.textContent).toBe(he.board.meta('אלגוריתמים', he.board.kinds.learn, he.board.hour))
    // The exam's name is isolated, so a Latin name does not reorder the line.
    expect(he.board.meta('הסתברות', 'תרגול', 'שעה').replace(/[⁨⁩]/g, '')).toBe('הסתברות, תרגול. שעה')
    expect(rowOf(TITLE)).not.toHaveTextContent('·')
  })

  it('shows the start hour in the given timezone, left to right, the part and the pinned mark', () => {
    const { unmount } = setupRow(makeBlock({ part_index: 2, part_count: 3, pinned: true }), 'America/New_York')
    expect(row().getByText('07:00')).toHaveAttribute('dir', 'ltr')
    expect(row().getByText(new RegExp(he.board.part(2, 3)))).toBeInTheDocument()
    expect(row().getByText(he.board.pinned)).toBeInTheDocument()
    unmount()
    setupRow(makeBlock())
    expect(row().getByText('14:00')).toBeInTheDocument()
  })

  it('pressing the check button sends POST /blocks/{id}/complete', async () => {
    const user = userEvent.setup()
    const block = makeBlock()
    const { fake } = setupRow(block)
    fake.on('POST /blocks/block-1/complete', { block: { ...block, status: 'done', state: 'done' }, task_status: 'done' })

    await user.click(row().getByRole('button', { name: he.board.completeLabel(TITLE) }))
    await waitFor(() => {
      expect(fake.calls('POST', '/blocks/block-1/complete')).toHaveLength(1)
    })
  })

  it('pressing the check button of a done block sends POST /blocks/{id}/uncomplete', async () => {
    const user = userEvent.setup()
    const block = makeBlock({ state: 'done', status: 'done' })
    const { fake } = setupRow(block)
    fake.on('POST /blocks/block-1/uncomplete', { block: makeBlock(), task_status: 'pending' })

    await user.click(row().getByRole('button', { name: he.board.uncompleteLabel(TITLE) }))
    await waitFor(() => {
      expect(fake.calls('POST', '/blocks/block-1/uncomplete')).toHaveLength(1)
    })
  })

  it('a menu item runs the action: defer sends POST /blocks/{id}/defer', async () => {
    const user = userEvent.setup()
    const { fake } = setupRow(planned('upcoming'))
    fake.on('POST /blocks/block-1/defer', { blocks: [], version_id: null })

    await user.click(row().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    await user.click(await screen.findByRole('menuitem', { name: he.board.defer }))
    await waitFor(() => {
      expect(fake.calls('POST', '/blocks/block-1/defer')).toEqual([{ method: 'POST', path: '/blocks/block-1/defer', body: undefined }])
    })
  })

  it('a menu item runs the action: pin sends PATCH /blocks/{id} {pinned: true}', async () => {
    const user = userEvent.setup()
    const { fake } = setupRow(planned('upcoming'))
    fake.on('PATCH /blocks/block-1', makeBlock({ pinned: true }))

    await user.click(row().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    await user.click(await screen.findByRole('menuitem', { name: he.board.pin }))
    await waitFor(() => {
      expect(fake.calls('PATCH', '/blocks/block-1').map((c) => c.body)).toEqual([{ pinned: true }])
    })
  })

  it('the "move" menu item opens the move dialog', async () => {
    const user = userEvent.setup()
    const { fake } = setupRow(planned('upcoming'))
    fake.on('GET /blocks/block-1/slots', {
      study_date: '2026-11-16',
      day_starts_at: '2026-11-16T05:00:00Z',
      day_ends_at: '2026-11-16T21:00:00Z',
      slots: ['2026-11-16T13:00:00Z'],
    })

    await user.click(row().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    await user.click(await screen.findByRole('menuitem', { name: he.move.move }))
    expect(await screen.findByRole('dialog', { name: he.move.dialogTitle(TITLE) })).toBeInTheDocument()
  })

  it('while an action is pending the menu and the check button are disabled, and only a defer says "deferring"', async () => {
    const user = userEvent.setup()
    const { fake } = setupRow(planned('upcoming'))
    const completing = deferred<unknown>()
    fake.on('POST /blocks/block-1/complete', () => completing.promise)
    const trigger = row().getByRole('button', { name: he.board.actionsLabel(TITLE) })
    const check = row().getByRole('button', { name: he.board.completeLabel(TITLE) })

    await user.click(check)
    await waitFor(() => {
      expect(trigger).toBeDisabled()
    })
    expect(check).toBeDisabled()
    expect(row().queryByText(he.board.deferring)).not.toBeInTheDocument()
    completing.resolve({ block: makeBlock({ status: 'done', state: 'done' }), task_status: 'done' })
    await waitFor(() => {
      expect(trigger).toBeEnabled()
    })
    expect(check).toBeEnabled()

    const deferring = deferred<unknown>()
    fake.on('POST /blocks/block-1/defer', () => deferring.promise)
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: he.board.defer }))
    await waitFor(() => {
      expect(row().getByText(he.board.deferring)).toBeInTheDocument()
    })
    expect(trigger).toBeDisabled()
    expect(check).toBeDisabled()
    deferring.resolve({ blocks: [], version_id: null })
  })

  it('"deferring" shows only in the block that is being deferred', async () => {
    const user = userEvent.setup()
    const first = makeBlock({ id: 'block-1', task_title: 'ראשון' })
    const second = makeBlock({ id: 'block-2', task_id: 'task-2', task_title: 'שני' })
    const { fake } = setup(
      <List>
        <BlockRow block={first} tz={TZ} />
        <BlockRow block={second} tz={TZ} />
      </List>,
      [first, second],
    )
    const answer = deferred<unknown>()
    fake.on('POST /blocks/block-2/defer', () => answer.promise)

    await user.click(within(rowOf('שני')).getByRole('button', { name: he.board.actionsLabel('שני') }))
    await user.click(await screen.findByRole('menuitem', { name: he.board.defer }))
    await waitFor(() => {
      expect(within(rowOf('שני')).getByText(he.board.deferring)).toBeInTheDocument()
    })
    expect(within(rowOf('ראשון')).queryByText(he.board.deferring)).not.toBeInTheDocument()
    expect(within(rowOf('ראשון')).getByRole('button', { name: he.board.completeLabel('ראשון') })).toBeEnabled()
    answer.resolve({ blocks: [], version_id: null })
  })

  it('a long title without spaces wraps inside the row', () => {
    const title = 'א'.repeat(120)
    setupRow(makeBlock({ task_title: title }))
    const text = screen.getByText(title)
    expect(text).toHaveClass('break-words')
    expect(text.parentElement).toHaveClass('min-w-0')
  })
})

describe('NextBlock', () => {
  it('is a region named by its heading, with the title as a heading under it', () => {
    setupNext(planned('upcoming'))
    expect(next().getByRole('heading', { level: 2, name: he.today.next })).toBeInTheDocument()
    expect(next().getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument()
  })

  it('upcoming offers complete, defer, and a menu with move and pin', async () => {
    const user = userEvent.setup()
    setupNext(planned('upcoming'))
    expect(names(nextEl())).toEqual([he.board.completeLabel(TITLE), he.board.deferLabel(TITLE), he.board.actionsLabel(TITLE)])
    expect(next().getByRole('button', { name: he.board.completeLabel(TITLE) })).toHaveTextContent(he.board.complete)
    expect(next().getByRole('button', { name: he.board.deferLabel(TITLE) })).toHaveTextContent(he.board.defer)

    await user.click(next().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    expect(await screen.findByRole('menu', { name: he.board.actionsLabel(TITLE) })).toBeInTheDocument()
    expect(await menuItems()).toEqual([he.move.move, he.board.pin])
  })

  it('in progress offers complete, defer and pin as buttons, without a menu', () => {
    setupNext(planned('in_progress'))
    expect(names(nextEl())).toEqual([he.board.completeLabel(TITLE), he.board.deferLabel(TITLE), he.board.pinLabel(TITLE)])
    expect(next().getByRole('button', { name: he.board.pinLabel(TITLE) })).toHaveTextContent(he.board.pin)
  })

  it('a pinned block in progress offers unpin as a button and says it is pinned', () => {
    setupNext(planned('in_progress', true))
    expect(names(nextEl())).toEqual([he.board.completeLabel(TITLE), he.board.deferLabel(TITLE), he.board.unpinLabel(TITLE)])
    expect(next().getByRole('button', { name: he.board.unpinLabel(TITLE) })).toHaveTextContent(he.board.unpin)
    expect(next().getByText(he.board.pinned)).toBeInTheDocument()
  })

  it('a pinned upcoming block offers unpin in the menu and says it is pinned', async () => {
    const user = userEvent.setup()
    setupNext(planned('upcoming', true))
    expect(next().getByText(he.board.pinned)).toBeInTheDocument()
    await user.click(next().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    expect(await menuItems()).toEqual([he.move.move, he.board.unpin])
  })

  it('an unpinned block does not say it is pinned', () => {
    setupNext(planned('upcoming'))
    expect(next().queryByText(he.board.pinned)).not.toBeInTheDocument()
  })

  it.each([
    ['overdue', 'planned'],
    ['missed', 'missed'],
    ['skipped', 'skipped'],
  ] as const)('%s offers only complete and shows its badge', (state, status) => {
    setupNext(makeBlock({ state, status }))
    expect(names(nextEl())).toEqual([he.board.completeLabel(TITLE)])
    expect(next().getByText(he.board.states[state])).toBeInTheDocument()
  })

  it('done offers only uncomplete and still shows the title', () => {
    setupNext(makeBlock({ state: 'done', status: 'done' }))
    expect(names(nextEl())).toEqual([he.board.uncompleteLabel(TITLE)])
    expect(next().getByRole('button', { name: he.board.uncompleteLabel(TITLE) })).toHaveTextContent(he.board.uncomplete)
    expect(next().getByRole('heading', { name: TITLE })).toBeInTheDocument()
  })

  it('in progress has the "now" badge, and upcoming has none', () => {
    const { unmount } = setupNext(planned('in_progress'))
    expect(next().getByText(he.board.states.in_progress)).toBeInTheDocument()
    unmount()
    setupNext(planned('upcoming'))
    // "בוצע" is also the complete button, so look only at what is not a button.
    for (const text of Object.values(he.board.states)) {
      expect(next().queryByText(text, { ignore: 'button, button *' })).not.toBeInTheDocument()
    }
  })

  it('a block on a later day shows when, in place of a badge', () => {
    setupNext(planned('upcoming'), { when: 'מחר, 09:00' })
    expect(next().getByText('מחר, 09:00')).toBeInTheDocument()
  })

  it('shows the part when the task is split, and not otherwise', () => {
    const { unmount } = setupNext(makeBlock({ part_index: 2, part_count: 3 }))
    expect(next().getByText(new RegExp(he.board.part(2, 3)))).toBeInTheDocument()
    unmount()
    setupNext(makeBlock())
    expect(next().queryByText(/מתוך/)).not.toBeInTheDocument()
  })

  it('a split block names every button with its part, and the heading keeps the title', () => {
    setupNext(makeBlock({ part_index: 2, part_count: 3 }))
    const name = 'פרק 3: גרפים (חלק 2 מתוך 3)'
    expect(names(nextEl())).toEqual([he.board.completeLabel(name), he.board.deferLabel(name), he.board.actionsLabel(name)])
    expect(next().getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument()
  })

  it('shows the duration, the exam and the kind after the time range', () => {
    setupNext(makeBlock())
    const meta = next().getByText(/אלגוריתמים/)
    expect(meta).toHaveTextContent(he.board.kinds.learn)
    expect(meta).toHaveTextContent(he.board.hour)
    expect(meta.textContent.replace(/[⁨⁩]/g, '')).toBe('14:00–15:00, שעה. אלגוריתמים, לימוד')
  })

  it('shows the times in the given timezone, left to right', () => {
    const { unmount } = setupNext(makeBlock(), { tz: 'America/New_York' })
    expect(next().getByText('07:00–08:00')).toHaveAttribute('dir', 'ltr')
    unmount()
    setupNext(makeBlock())
    expect(next().getByText('14:00–15:00')).toBeInTheDocument()
  })

  it('pressing complete sends POST /blocks/{id}/complete', async () => {
    const user = userEvent.setup()
    const block = makeBlock()
    const { fake } = setupNext(block)
    fake.on('POST /blocks/block-1/complete', { block: { ...block, status: 'done', state: 'done' }, task_status: 'done' })

    await user.click(next().getByRole('button', { name: he.board.completeLabel(TITLE) }))
    await waitFor(() => {
      expect(fake.calls('POST', '/blocks/block-1/complete')).toHaveLength(1)
    })
  })

  it('while a complete is pending every button is disabled, and defer does not say it is deferring', async () => {
    const user = userEvent.setup()
    const { fake } = setupNext(makeBlock())
    const answer = deferred<unknown>()
    fake.on('POST /blocks/block-1/complete', () => answer.promise)

    await user.click(next().getByRole('button', { name: he.board.completeLabel(TITLE) }))
    const defer = next().getByRole('button', { name: he.board.deferLabel(TITLE) })
    await waitFor(() => {
      expect(defer).toBeDisabled()
    })
    expect(next().getByRole('button', { name: he.board.completeLabel(TITLE) })).toBeDisabled()
    expect(next().getByRole('button', { name: he.board.actionsLabel(TITLE) })).toBeDisabled()
    expect(defer).toHaveTextContent(he.board.defer)
    expect(defer).not.toHaveTextContent(he.board.deferring)
    answer.resolve({ block: makeBlock({ status: 'done', state: 'done' }), task_status: 'done' })
  })

  it('while a defer is pending the defer button says so', async () => {
    const user = userEvent.setup()
    const { fake } = setupNext(makeBlock())
    const answer = deferred<unknown>()
    fake.on('POST /blocks/block-1/defer', () => answer.promise)

    await user.click(next().getByRole('button', { name: he.board.deferLabel(TITLE) }))
    await waitFor(() => {
      expect(next().getByRole('button', { name: he.board.deferLabel(TITLE) })).toHaveTextContent(he.board.deferring)
    })
    answer.resolve({ blocks: [], version_id: null })
  })

  it('the pin button of a block in progress sends PATCH /blocks/{id} {pinned: true}', async () => {
    const user = userEvent.setup()
    const { fake } = setupNext(planned('in_progress'))
    fake.on('PATCH /blocks/block-1', makeBlock({ pinned: true }))

    await user.click(next().getByRole('button', { name: he.board.pinLabel(TITLE) }))
    await waitFor(() => {
      expect(fake.calls('PATCH', '/blocks/block-1').map((c) => c.body)).toEqual([{ pinned: true }])
    })
  })

  it('a long title without spaces wraps inside the card', () => {
    const title = 'א'.repeat(120)
    setupNext(makeBlock({ task_title: title }))
    expect(next().getByRole('heading', { level: 3, name: title })).toHaveClass('break-words')
  })
})
