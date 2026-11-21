import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { createFakeApi, problem } from '../test/fakeApi'
import { USER_ID, makeMe, renderBoard } from '../test/boardFixtures'
import { ProgressPage } from './ProgressPage'
import { makeBadges, makeProgress, newUserProgress } from './testFixtures'
import type { Progress } from './types'

const t = en.progress

// Jerusalem, so 2026-11-12T22:30Z is the 13th there.
function setup(progress: Progress | Error) {
  const fake = createFakeApi().on('GET /me', makeMe('Asia/Jerusalem')).on('GET /progress', progress)
  const view = renderBoard(<ProgressPage />, { api: fake.api })
  return { fake, ...view }
}

function section(name: string) {
  return screen.getByRole('region', { name })
}

// A badge is a row of the list of its group; its name is plain text, not a heading.
function badgeItem(name: string) {
  const badges = screen.getByRole('region', { name: t.badges.title })
  const item = within(badges).getByText(name).closest('li')
  if (item === null) throw new Error(`no badge ${name}`)
  return item
}

describe('the progress board', () => {
  it('shows the level, the total XP, the blocks done and the streak', async () => {
    setup(makeProgress())
    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeInTheDocument()
    const level = await screen.findByRole('region', { name: t.level.title })
    expect(within(level).getByText(t.level.level(2))).toBeInTheDocument()
    expect(within(level).getByText(t.level.totalXp('1,240'))).toBeInTheDocument()
    // The bar says how far along the level is, once: no second sentence with what is left.
    expect(within(level).getByText(t.level.barValue('240', '1,000'))).toBeInTheDocument()
    expect(within(level).queryByText(/עוד 760/)).not.toBeInTheDocument()
    expect(within(level).getByText(t.level.blocksDone(12))).toBeInTheDocument()

    const streak = section(t.streak.title)
    expect(within(streak).getByText(t.streak.days(4))).toBeInTheDocument()
    expect(within(streak).getByText(t.streak.days(9))).toBeInTheDocument()
    expect(within(streak).getByText(t.streak.studiedToday)).toBeInTheDocument()
    expect(within(streak).getByText(t.days.summary(5, 14))).toBeInTheDocument()
  })

  it('the bar runs from the start of this level to the next one', async () => {
    setup(makeProgress())
    const bar = await screen.findByRole('progressbar', { name: t.level.barLabel(3) })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '1000')
    expect(bar).toHaveAttribute('aria-valuenow', '240')
    expect(bar).toHaveAttribute('aria-valuetext', t.level.barValue('240', '1,000'))
  })

  it('a new user: level 1, 0 XP, and a streak of 0 is an invitation', async () => {
    setup(newUserProgress())
    const bar = await screen.findByRole('progressbar', { name: t.level.barLabel(2) })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText(t.level.level(1))).toBeInTheDocument()
    expect(screen.getByText(t.level.totalXp('0'))).toBeInTheDocument()
    expect(screen.getByText(t.level.blocksDone(0))).toBeInTheDocument()
    const streak = section(t.streak.title)
    expect(within(streak).getByText(t.streak.start)).toBeInTheDocument()
    expect(within(streak).getByText(t.days.summary(0, 14))).toBeInTheDocument()
    expect(screen.getByText(t.badges.summary(0, 18))).toBeInTheDocument()
    expect(screen.getAllByText(t.badges.notEarned)).toHaveLength(18)
  })

  it('a live streak not yet extended today says so without blame', async () => {
    setup(makeProgress({ streak: { current: 3, longest: 3, studied_today: false, today: '2026-11-16' } }))
    const streak = await screen.findByRole('region', { name: t.streak.title })
    expect(within(streak).getByText(t.streak.keepGoing)).toBeInTheDocument()
  })

  it('at level 50 there is no next target', async () => {
    setup(
      makeProgress({
        total_xp: 1_300_000,
        level: 50,
        level_start_xp: 1_250_000,
        next_level_xp: null,
        badges: makeBadges({ knowledge_seeker_50: '2026-11-15T08:00:00Z' }),
      }),
    )
    const level = await screen.findByRole('region', { name: t.level.title })
    expect(within(level).getByText(t.level.level(50))).toBeInTheDocument()
    expect(within(level).getByText(t.level.max)).toBeInTheDocument()
    expect(within(level).getByText(t.level.totalXp('1,300,000'))).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('badges by group: earned ones with the date, the others say so in text with the way there', async () => {
    setup(makeProgress())
    const badges = await screen.findByRole('region', { name: t.badges.title })
    expect(within(badges).getByText(t.badges.summary(4, 18))).toBeInTheDocument()
    for (const group of Object.values(t.badges.groups)) {
      expect(within(badges).getByRole('heading', { level: 3, name: group })).toBeInTheDocument()
    }

    // 22:30 UTC on the 12th is the 13th in Jerusalem.
    const week = badgeItem(t.badges.items.iron_will_7.name)
    expect(week).toHaveTextContent(t.badges.earnedOn('13 November 2026'))
    expect(week).not.toHaveTextContent(t.badges.notEarned)

    const twenty = badgeItem(t.badges.items.task_master_20.name)
    expect(twenty).toHaveTextContent(t.badges.notEarned)
    expect(twenty).toHaveTextContent(t.badges.items.task_master_20.description)
    expect(twenty).toHaveTextContent(t.badges.towards('12', '20'))
  })

  it('a badge not earned shows how far along it is', async () => {
    setup(makeProgress())
    await screen.findByRole('region', { name: t.badges.title })
    expect(badgeItem(t.badges.items.task_master_50.name)).toHaveTextContent(t.badges.towards('12', '50'))
    expect(badgeItem(t.badges.items.iron_will_10.name)).toHaveTextContent(t.badges.towards('9', '10'))
    expect(badgeItem(t.badges.items.knowledge_seeker_5.name)).toHaveTextContent(t.badges.towards('2', '5'))
    expect(badgeItem(t.badges.items.xp_5000.name)).toHaveTextContent(t.badges.towards('1,240', '5,000'))
  })

  it('an error shows the message and a retry that asks again', async () => {
    const user = userEvent.setup()
    const { fake } = setup(problem(503, 'unavailable'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fake.on('GET /progress', makeProgress())
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    expect(await screen.findByText(t.level.level(2))).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows loading until the answer arrives', () => {
    const fake = createFakeApi().on('GET /me', makeMe()).on('GET /progress', new Promise(() => undefined))
    renderBoard(<ProgressPage />, { api: fake.api })
    expect(screen.getByRole('status')).toHaveTextContent(en.common.loading)
  })

  it('the title of the screen is there while loading, for the focus after a navigation', () => {
    const fake = createFakeApi().on('GET /me', makeMe()).on('GET /progress', new Promise(() => undefined))
    renderBoard(<ProgressPage />, { api: fake.api })
    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('earned or not is said by the icon and the words, not by colour', async () => {
    setup(makeProgress())
    await screen.findByRole('region', { name: t.badges.title })
    const earned = badgeItem(t.badges.items.first_task.name)
    expect(earned.querySelector('svg')).toHaveAttribute('data-badge', 'earned')
    const open = badgeItem(t.badges.items.task_master_100.name)
    expect(open.querySelector('svg')).toHaveAttribute('data-badge', 'open')
    expect(within(open).getByText(t.badges.notEarned)).toBeInTheDocument()
  })

  it('each group of badges is a named list of rows', async () => {
    setup(makeProgress())
    const badges = await screen.findByRole('region', { name: t.badges.title })
    const streak = within(badges).getByRole('list', { name: t.badges.groups.streak })
    expect(within(streak).getAllByRole('listitem')).toHaveLength(5)
  })

  it('asks again when the board key is invalidated, as every block action does', async () => {
    const { fake, queryClient } = setup(makeProgress())
    await screen.findByText(t.level.level(2))
    fake.on('GET /progress', makeProgress({ total_xp: 2100, level: 3, level_start_xp: 2000, next_level_xp: 3000 }))
    await queryClient.invalidateQueries({ queryKey: ['board', USER_ID] })
    expect(await screen.findByText(t.level.level(3))).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/progress')).toHaveLength(2)
    })
  })
})
