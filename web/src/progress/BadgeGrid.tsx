import { Award, CircleDashed } from 'lucide-react'
import { useId } from 'react'
import { useProfileTimezone } from '../board/time'
import { he } from '../i18n/he'
import { List, ListRow } from '../ui/List'
import { SectionHeading } from '../ui/SectionHeading'
import { ICON_STROKE } from '../ui/styles'
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

// One badge as a row. Earned: a green award and "earned on" with the date under the name.
// Not earned: a dashed circle, and how far along it is at the end of the row. The two differ in
// the shape of the icon and in the words, so the colour carries nothing alone.
function BadgeRow({ badge, current, timeZone }: { badge: Badge; current: number; timeZone: string }) {
  const { name, description } = badgeText(badge.key)
  if (badge.earned) {
    const when = badge.earned_at === null ? t.earned : t.earnedOn(formatEarnedDate(badge.earned_at, timeZone))
    return (
      <ListRow
        leading={<Award aria-hidden="true" data-badge="earned" size={18} strokeWidth={ICON_STROKE} className="text-success" />}
        title={name}
        subtitle={t.details([description, when])}
      />
    )
  }
  return (
    <ListRow
      leading={<CircleDashed aria-hidden="true" data-badge="open" size={18} strokeWidth={ICON_STROKE} className="text-ink-muted" />}
      title={name}
      subtitle={description === '' ? undefined : description}
      trailing={
        <>
          {/* The count is the visible way of saying "not yet"; a screen reader hears the words first. */}
          <span className="sr-only">{t.notEarned}</span>
          <span className="text-small whitespace-nowrap text-ink-muted tabular-nums">
            {t.towards(formatNumber(Math.min(current, badge.threshold)), formatNumber(badge.threshold))}
          </span>
        </>
      }
    />
  )
}

// Every badge, earned or not, grouped as the server orders them: a list of rows per group and not
// a box per badge (design language 5.2), so 18 badges read as one quiet column.
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
          <div key={group}>
            <SectionHeading level={3}>{t.groups[group]}</SectionHeading>
            <List aria-label={t.groups[group]}>
              {badges.map((badge) => (
                <BadgeRow key={badge.key} badge={badge} current={current} timeZone={timeZone} />
              ))}
            </List>
          </div>
        )
      })}
    </section>
  )
}
