import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi } from '../test/fakeApi'
import { BlockCard } from './BlockCard'
import type { Block, BlockState } from './types'

const TITLE = 'פרק 3: גרפים'

// A promise the test resolves when it wants.
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function setup(block: Block, { variant = 'full', tz = 'Asia/Jerusalem' }: { variant?: 'full' | 'compact'; tz?: string } = {}) {
  const fake = createFakeApi()
    .on('GET /me', makeMe(tz))
    .on('GET /today', makeToday([block]))
    .on({ method: 'GET', path: /^\/plan/ }, makePlan([block]))
  const rendered = renderBoard(<BlockCard block={block} tz={tz} variant={variant} />, { api: fake.api })
  return { fake, ...rendered }
}

function card() {
  return within(screen.getByRole('article', { name: TITLE }))
}

function buttonNames(): string[] {
  return card()
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent)
}

const planned = (state: BlockState, pinned = false) => makeBlock({ status: 'planned', state, pinned })

describe('BlockCard (full)', () => {
  it.each(['upcoming', 'in_progress'] as const)('%s offers complete, defer and pin', (state) => {
    setup(planned(state))
    expect(buttonNames()).toEqual([he.board.completeLabel(TITLE), he.board.deferLabel(TITLE), he.board.pinLabel(TITLE)])
    expect(card().getByRole('button', { name: he.board.completeLabel(TITLE) })).toHaveTextContent(he.board.complete)
    expect(card().getByRole('button', { name: he.board.pinLabel(TITLE) })).toHaveTextContent(he.board.pin)
  })

  it.each(['upcoming', 'in_progress'] as const)('a pinned %s block offers unpin and shows the pinned tag', (state) => {
    setup(planned(state, true))
    expect(buttonNames()).toEqual([he.board.completeLabel(TITLE), he.board.deferLabel(TITLE), he.board.unpinLabel(TITLE)])
    expect(card().getByRole('button', { name: he.board.unpinLabel(TITLE) })).toHaveTextContent(he.board.unpin)
    expect(card().getByText(he.board.pinned)).toBeInTheDocument()
  })

  it('an unpinned block has no pinned tag', () => {
    setup(planned('upcoming'))
    expect(card().queryByText(he.board.pinned)).not.toBeInTheDocument()
  })

  it.each([
    ['overdue', 'planned'],
    ['missed', 'missed'],
    ['skipped', 'skipped'],
  ] as const)('%s offers only complete and shows its badge', (state, status) => {
    setup(makeBlock({ state, status }))
    expect(buttonNames()).toEqual([he.board.completeLabel(TITLE)])
    expect(card().getByText(he.board.states[state])).toBeInTheDocument()
  })

  it('done offers only uncomplete, still shows the title, and has the done badge', () => {
    setup(makeBlock({ state: 'done', status: 'done' }))
    expect(buttonNames()).toEqual([he.board.uncompleteLabel(TITLE)])
    expect(card().getByRole('button', { name: he.board.uncompleteLabel(TITLE) })).toHaveTextContent(he.board.uncomplete)
    expect(card().getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(card().getByText(he.board.states.done)).toBeInTheDocument()
  })

  it('in progress has the "now" badge, and upcoming has none', () => {
    const { unmount } = setup(planned('in_progress'))
    expect(card().getByText(he.board.states.in_progress)).toBeInTheDocument()
    unmount()
    setup(planned('upcoming'))
    // "בוצע" is also the complete button, so look only at the tags.
    for (const text of Object.values(he.board.states)) {
      expect(card().queryByText(text, { selector: 'span' })).not.toBeInTheDocument()
    }
  })

  it('shows the part when the task is split, and not otherwise', () => {
    const { unmount } = setup(makeBlock({ part_index: 2, part_count: 3 }))
    expect(card().getByText(new RegExp(he.board.part(2, 3)))).toBeInTheDocument()
    expect(he.board.part(2, 3)).toBe('חלק 2 מתוך 3')
    unmount()
    setup(makeBlock())
    expect(card().queryByText(/מתוך/)).not.toBeInTheDocument()
  })

  it('shows the exam, the kind and the duration', () => {
    setup(makeBlock())
    const meta = card().getByText(/אלגוריתמים/)
    expect(meta).toHaveTextContent(he.board.kinds.learn)
    expect(meta).toHaveTextContent(he.board.hour)
  })

  it('shows the times in the given timezone', () => {
    const { unmount } = setup(makeBlock(), { tz: 'America/New_York' })
    expect(card().getByText('07:00–08:00')).toBeInTheDocument()
    unmount()
    setup(makeBlock(), { tz: 'Asia/Jerusalem' })
    expect(card().getByText('14:00–15:00')).toBeInTheDocument()
  })

  it('pressing complete sends POST /blocks/{id}/complete', async () => {
    const user = userEvent.setup()
    const block = makeBlock()
    const { fake } = setup(block)
    fake.on('POST /blocks/block-1/complete', { block: { ...block, status: 'done', state: 'done' }, task_status: 'done' })

    await user.click(card().getByRole('button', { name: he.board.completeLabel(TITLE) }))
    await waitFor(() => {
      expect(fake.calls('POST', '/blocks/block-1/complete')).toHaveLength(1)
    })
  })

  it('while a complete is pending the buttons are disabled, and defer does not say it is deferring', async () => {
    const user = userEvent.setup()
    const { fake } = setup(makeBlock())
    const answer = deferred<unknown>()
    fake.on('POST /blocks/block-1/complete', () => answer.promise)

    await user.click(card().getByRole('button', { name: he.board.completeLabel(TITLE) }))
    const defer = card().getByRole('button', { name: he.board.deferLabel(TITLE) })
    await waitFor(() => {
      expect(defer).toBeDisabled()
    })
    expect(defer).toHaveTextContent(he.board.defer)
    expect(defer).not.toHaveTextContent(he.board.deferring)
    answer.resolve({ block: makeBlock({ status: 'done', state: 'done' }), task_status: 'done' })
  })

  it('while a defer is pending the defer button says so', async () => {
    const user = userEvent.setup()
    const { fake } = setup(makeBlock())
    const answer = deferred<unknown>()
    fake.on('POST /blocks/block-1/defer', () => answer.promise)

    await user.click(card().getByRole('button', { name: he.board.deferLabel(TITLE) }))
    await waitFor(() => {
      expect(card().getByRole('button', { name: he.board.deferLabel(TITLE) })).toHaveTextContent(he.board.deferring)
    })
    answer.resolve({ blocks: [], version_id: null })
  })
})

describe('BlockCard (compact)', () => {
  it('has one actions button whose menu holds the actions of the state', async () => {
    const user = userEvent.setup()
    setup(planned('upcoming'), { variant: 'compact' })
    expect(card().getAllByRole('button')).toHaveLength(1)
    const trigger = card().getByRole('button', { name: he.board.actionsLabel(TITLE) })
    expect(trigger).toHaveTextContent(he.board.actions)

    await user.click(trigger)
    const menu = await screen.findByRole('menu', { name: he.board.actionsLabel(TITLE) })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      he.board.complete,
      he.board.defer,
      he.board.pin,
    ])
  })

  it('the menu of a pinned block offers unpin, and of a done block only uncomplete', async () => {
    const user = userEvent.setup()
    const { unmount } = setup(planned('upcoming', true), { variant: 'compact' })
    await user.click(card().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    let menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      he.board.complete,
      he.board.defer,
      he.board.unpin,
    ])
    unmount()

    setup(makeBlock({ state: 'done', status: 'done' }), { variant: 'compact' })
    await user.click(card().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([he.board.uncomplete])
  })

  it('an overdue block menu offers only complete', async () => {
    const user = userEvent.setup()
    setup(planned('overdue'), { variant: 'compact' })
    await user.click(card().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([he.board.complete])
  })

  it('a menu item runs the action: defer sends POST /blocks/{id}/defer', async () => {
    const user = userEvent.setup()
    const { fake } = setup(planned('upcoming'), { variant: 'compact' })
    fake.on('POST /blocks/block-1/defer', { blocks: [], version_id: null })

    await user.click(card().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    await user.click(await screen.findByRole('menuitem', { name: he.board.defer }))
    await waitFor(() => {
      expect(fake.calls('POST', '/blocks/block-1/defer')).toEqual([{ method: 'POST', path: '/blocks/block-1/defer', body: undefined }])
    })
  })

  it('a menu item runs the action: pin sends PATCH /blocks/{id} {pinned: true}', async () => {
    const user = userEvent.setup()
    const { fake } = setup(planned('upcoming'), { variant: 'compact' })
    fake.on('PATCH /blocks/block-1', makeBlock({ pinned: true }))

    await user.click(card().getByRole('button', { name: he.board.actionsLabel(TITLE) }))
    await user.click(await screen.findByRole('menuitem', { name: he.board.pin }))
    await waitFor(() => {
      expect(fake.calls('PATCH', '/blocks/block-1').map((c) => c.body)).toEqual([{ pinned: true }])
    })
  })

  it('the actions button is disabled while an action is pending, and says deferring only for a defer', async () => {
    const user = userEvent.setup()
    const { fake } = setup(planned('upcoming'), { variant: 'compact' })
    const completing = deferred<unknown>()
    fake.on('POST /blocks/block-1/complete', () => completing.promise)
    const trigger = card().getByRole('button', { name: he.board.actionsLabel(TITLE) })

    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: he.board.complete }))
    await waitFor(() => {
      expect(trigger).toBeDisabled()
    })
    expect(trigger).toHaveTextContent(he.board.actions)
    completing.resolve({ block: makeBlock({ status: 'done', state: 'done' }), task_status: 'done' })
    await waitFor(() => {
      expect(trigger).toBeEnabled()
    })

    const deferring = deferred<unknown>()
    fake.on('POST /blocks/block-1/defer', () => deferring.promise)
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: he.board.defer }))
    await waitFor(() => {
      expect(trigger).toHaveTextContent(he.board.deferring)
    })
    deferring.resolve({ blocks: [], version_id: null })
  })

  it('shows the time in the given timezone, the part and the pinned tag', () => {
    setup(makeBlock({ part_index: 2, part_count: 3, pinned: true }), { variant: 'compact', tz: 'America/New_York' })
    expect(card().getByText('07:00–08:00')).toBeInTheDocument()
    expect(card().getByText(new RegExp(he.board.part(2, 3)))).toBeInTheDocument()
    expect(card().getByText(he.board.pinned)).toBeInTheDocument()
  })
})
