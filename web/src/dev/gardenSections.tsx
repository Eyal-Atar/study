import { BadgeStone } from '../garden/BadgeStone'
import type { BadgeGroup } from '../progress/types'
import { cx } from '../ui/styles'
import { devText } from './devText'
import { Example, ROW, Section } from './Section'

// The illustrations S33 drew in code (web/src/garden/). Their texts are in devText.s33.
const t = devText.s33

// The tiers of each group, in the server's order (plan, "what I found in the code" 2).
const GROUPS: { group: BadgeGroup; tiers: number }[] = [
  { group: 'first', tiers: 1 },
  { group: 'blocks', tiers: 4 },
  { group: 'streak', tiers: 5 },
  { group: 'level', tiers: 5 },
  { group: 'xp', tiers: 3 },
]

function Stones({ group, tiers, earned }: { group: BadgeGroup; tiers: number; earned: boolean }) {
  return (
    <div className={ROW}>
      <span className="w-28 text-small text-ink-muted">{earned ? t.earned : t.notYet}</span>
      {Array.from({ length: tiers }, (_, i) => (
        <BadgeStone key={i} group={group} tier={i + 1} tiers={tiers} earned={earned} />
      ))}
    </div>
  )
}

function Board({ caption, className }: { caption: string; className: string }) {
  return (
    <Example caption={caption} className={cx('space-y-4 rounded-card border border-line p-4', className)}>
      {GROUPS.map(({ group, tiers }) => (
        <div key={group} className="space-y-2">
          <p className="text-small text-ink">{t.groups[group]}</p>
          <Stones group={group} tiers={tiers} earned />
          <Stones group={group} tiers={tiers} earned={false} />
        </div>
      ))}
    </Example>
  )
}

export function BadgeStonesSection() {
  return (
    <Section id="badge-stones">
      <p className="text-small text-ink-muted">{t.stones}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Board caption={t.surfaces.surface} className="bg-surface" />
        <Board caption={t.surfaces.canvas} className="bg-canvas" />
      </div>
    </Section>
  )
}
