import { useId } from 'react'
import { useProfileTimezone } from '../board/time'
import { BadgeStone } from '../garden/BadgeStone'
import { badgeTier } from '../garden/model'
import { en } from '../i18n/en'
import { SectionHeading } from '../ui/SectionHeading'
import { cx } from '../ui/styles'
import { formatEarnedShort, formatNumber } from './format'
import type { Badge, BadgeGroup, Progress } from './types'

const t = en.progress.badges

const GROUPS: BadgeGroup[] = ['first', 'blocks', 'streak', 'level', 'xp']
const STONE_SIZE = 44

function badgeName(key: string): string {
  return (t.items as Record<string, { name: string } | undefined>)[key]?.name ?? t.unknown.name
}

// Where the user stands on what the group counts (the server's rules, plan decision 4).
function currentFor(group: BadgeGroup, progress: Progress): number {
  switch (group) {
    case 'first':
    case 'blocks':
      return progress.blocks_done
    case 'streak':
      return progress.streak.longest
    case 'level':
      return progress.level
    case 'xp':
      return progress.total_xp
  }
}

// One badge as a tile: its stone, its name and one line under it. Earned: the stone in gold and
// "earned on" with the day. Not earned: a dashed border, an open stone, how far along it is, and
// the words for a screen reader. The two differ in shape and in words, so colour carries nothing
// alone. The description is not shown: the name already says it.
function BadgeTile({ badge, current, timeZone, progress }: { badge: Badge; current: number; timeZone: string; progress: Progress }) {
  const known = (t.items as Record<string, unknown>)[badge.key] !== undefined
  // badgeTier throws on a key it does not know, and the server may send a newer one.
  const { tier, tiers } = known ? badgeTier(progress.badges, badge.key) : { tier: 1, tiers: 1 }
  const line = badge.earned
    ? badge.earned_at === null
      ? t.earned
      : t.earnedOn(formatEarnedShort(badge.earned_at, timeZone))
    : t.towards(formatNumber(Math.min(current, badge.threshold)), formatNumber(badge.threshold))
  return (
    <li
      className={cx(
        'flex flex-col items-center gap-1 rounded-card border bg-surface p-2',
        badge.earned ? 'border-line' : 'border-dashed border-line',
      )}
    >
      <BadgeStone group={badge.group} tier={tier} tiers={tiers} earned={badge.earned} size={STONE_SIZE} />
      <span className="text-center text-small font-medium">{badgeName(badge.key)}</span>
      {badge.earned ? null : <span className="sr-only">{t.notEarned}</span>}
      <span className="text-center text-caption text-ink-muted tabular-nums">{line}</span>
    </li>
  )
}

// Every badge, earned or not, as stones in a grid per group, in the order the server gives.
export function BadgeGrid({ progress }: { progress: Progress }) {
  const titleId = useId()
  const timeZone = useProfileTimezone()
  const earned = progress.badges.filter((b) => b.earned).length

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <SectionHeading id={titleId}>{t.title}</SectionHeading>
        <p className="text-small text-ink-muted tabular-nums">{t.summary(earned, progress.badges.length)}</p>
      </div>
      {GROUPS.map((group) => {
        const badges = progress.badges.filter((b) => b.group === group)
        if (badges.length === 0) return null
        const current = currentFor(group, progress)
        return (
          <div key={group} className="flex flex-col gap-2">
            <SectionHeading level={3}>{t.groups[group]}</SectionHeading>
            <ul aria-label={t.groups[group]} className="grid grid-cols-3 gap-2 min-[360px]:grid-cols-4">
              {badges.map((badge) => (
                <BadgeTile key={badge.key} badge={badge} current={current} timeZone={timeZone} progress={progress} />
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
