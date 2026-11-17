import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { makeBlock } from '../test/boardFixtures'
import { completeText } from './progressText'
import type { ProgressChange } from './types'

function progress(overrides: Partial<ProgressChange> = {}): ProgressChange {
  return { xp_change: 10, total_xp: 110, level: 2, level_up: false, badges_earned: [], badges_lost: [], ...overrides }
}

describe('completeText', () => {
  it('without progress (an API before S19) is the plain text', () => {
    expect(completeText({ block: makeBlock(), task_status: 'done' }, false)).toBe(he.board.completed)
  })

  it('adds the XP gained', () => {
    expect(completeText({ block: makeBlock(), task_status: 'done', progress: progress() }, false)).toBe(
      `${he.board.completed} · ${he.board.xpGained(10)}`,
    )
  })

  it('adds a new level and the names of new badges', () => {
    const text = completeText(
      { block: makeBlock(), task_status: 'done', progress: progress({ level_up: true, level: 3, badges_earned: ['first_task', 'future_badge'] }) },
      false,
    )
    expect(text).toBe(
      [
        he.board.completed,
        he.board.xpGained(10),
        he.board.levelUp(3),
        he.board.badgeEarned(`${he.progress.badges.items.first_task.name}, ${he.progress.badges.unknown.name}`),
      ].join(' · '),
    )
  })

  it('on undo says the XP went down, and does not announce lost badges', () => {
    const text = completeText(
      { block: makeBlock(), task_status: 'todo', progress: progress({ xp_change: -10, badges_lost: ['first_task'] }) },
      true,
    )
    expect(text).toBe(`${he.board.uncompleted} · ${he.board.xpLost(10)}`)
  })

  it('no XP change adds nothing', () => {
    expect(completeText({ block: makeBlock(), task_status: 'done', progress: progress({ xp_change: 0 }) }, false)).toBe(he.board.completed)
  })
})
