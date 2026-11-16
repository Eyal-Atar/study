import { useId } from 'react'
import { useProfileTimezone } from '../board/time'
import { he } from '../i18n/he'
import { formatEarnedDate, formatNumber } from './format'
import type { Badge, BadgeGroup, Progress } from './types'

const t = he.progress.badges

const GROUPS: BadgeGroup[] = ['first', 'blocks', 'streak', 'level', 'xp']

function badgeText(key: string): { name: string; description: string } {
  return (t.items as Record<string, { name: string; description: string } | undefined>)[key] ?? t.unknown
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

function BadgeItem({ badge, current, timeZone }: { badge: Badge; current: number; timeZone: string }) {
  const { name, description } = badgeText(badge.key)
  const earned = badge.earned
  return (
    <li
      className={`flex h-full flex-col gap-1 rounded-lg p-3 ${
        earned ? 'bg-brand-soft' : 'border border-dashed border-line-strong bg-surface'
      }`}
    >
      <h4 className={`font-medium ${earned ? 'text-brand-strong' : 'text-ink-muted'}`}>{name}</h4>
      {description === '' ? null : <p className={`text-sm ${earned ? 'text-ink' : 'text-ink-muted'}`}>{description}</p>}
      {earned ? (
        badge.earned_at === null ? null : (
          <p className="mt-auto pt-1 text-sm text-brand-strong">{t.earnedOn(formatEarnedDate(badge.earned_at, timeZone))}</p>
        )
      ) : (
        <p className="mt-auto flex flex-wrap justify-between gap-x-2 pt-1 text-sm text-ink-muted">
          <span>{t.notEarned}</span>
          <span className="tabular-nums">
            {t.towards(formatNumber(Math.min(current, badge.threshold)), formatNumber(badge.threshold))}
          </span>
        </p>
      )}
    </li>
  )
}

// Every badge, earned or not, grouped as the server orders them: earned ones tinted with the date,
// the rest dashed and muted, with "not yet" in words and how far along it is.
export function BadgeGrid({ progress }: { progress: Progress }) {
  const titleId = useId()
  const timeZone = useProfileTimezone()
  const earned = progress.badges.filter((b) => b.earned).length

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={titleId} className="text-lg font-medium text-ink">
          {t.title}
        </h2>
        <p className="text-sm text-ink-muted tabular-nums">{t.summary(earned, progress.badges.length)}</p>
      </div>
      {GROUPS.map((group) => {
        const badges = progress.badges.filter((b) => b.group === group)
        if (badges.length === 0) return null
        const current = currentFor(group, progress)
        return (
          <div key={group} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-ink-muted">{t.groups[group]}</h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {badges.map((badge) => (
                <BadgeItem key={badge.key} badge={badge} current={current} timeZone={timeZone} />
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
