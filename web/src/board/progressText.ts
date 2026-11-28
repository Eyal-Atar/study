import { en } from '../i18n/en'
import type { CompleteResult } from './types'
import { badgeName } from '../progress/badgeNames'

// The "done" and "undone" toasts with what S19's progress says changed (S18, the S19 roadmap row):
// the XP, a new level and new badges, in one quiet line, its parts joined like the details of a row (design language 5.2). A badge lost on undo is not announced:
// the toast already says the mark was undone, and the progress board shows the badges.

export function completeText(result: CompleteResult, undone: boolean): string {
  const parts: string[] = [undone ? en.board.uncompleted : en.board.completed]
  const progress = result.progress
  if (progress !== undefined) {
    if (progress.xp_change > 0) parts.push(en.board.xpGained(progress.xp_change))
    if (progress.xp_change < 0) parts.push(en.board.xpLost(-progress.xp_change))
    if (progress.level_up) parts.push(en.board.levelUp(progress.level))
    if (progress.badges_earned.length > 0) parts.push(en.board.badgeEarned(progress.badges_earned.map(badgeName).join(', ')))
  }
  return parts.join('. ')
}
