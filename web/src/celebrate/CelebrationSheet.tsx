import { useEffect, useMemo, useRef, useState } from 'react'
import { Archie } from '../archie/Archie'
import { blockMinutes, durationText, formatTime } from '../board/time'
import type { Block } from '../board/types'
import { BadgeStone } from '../garden/BadgeStone'
import { GardenScene } from '../garden/GardenScene'
import '../garden/garden.css'
import { badgeTier, gardenModel, summaryOf, type Stage } from '../garden/model'
import { useGardenExams } from '../garden/useGardenExams'
import { en } from '../i18n/en'
import { formatNumber } from '../progress/format'
import { levelPercent } from '../progress/levelPercent'
import { LevelRing } from '../progress/LevelRing'
import type { Progress } from '../progress/types'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { Dialog } from '../ui/Dialog'
import { StreakLeafIcon, XpSparkIcon } from '../ui/icons'
import { prefersReducedMotion } from '../ui/reducedMotion'
import type { Celebration } from './rules'

/*
  The celebration sheet of the calendar (S33, Task 9; plan decisions 3, 11, 16): one sheet for the
  moment a Done earned, the biggest moment leading (a new stage, a level, a badge, the day), and a
  line for each thing that happened with it. Archi eureka hops once on the sheet's edge. It closes
  with one tap (Close, the X, Escape or the scrim), never by itself, and asks the server nothing.

  The motion plays once, and only for whoever did not ask for less (read once, at the entrance):
  the level ring fills from 0 (Element.animate, --duration-celebrate), the garden "after" enters
  (garden-enter) and the stone settles (garden-settle). With less motion the end state shows at once.
*/

const t = en.garden.celebrate

// --duration-celebrate (index.css) and --ease-standard, for the ring's Element.animate.
const CELEBRATE_MS = 600
const EASE_STANDARD = 'cubic-bezier(0.2, 0, 0, 1)'
const RING_SIZE = 96
const RING_STROKE = 8
const STONE_SIZE = 96

// A badge the web does not know yet (a newer API) has no name to say: it is left out of the lines,
// and only a sheet led by it alone falls back to the generic name.
function badgeName(key: string): string | null {
  const items: Partial<Record<string, { name: string }>> = en.progress.badges.items
  return items[key]?.name ?? null
}

export interface CelebrationSheetProps {
  celebration: Celebration
  // GET /progress, when the calendar has it: the chips, the ring, the gardens and the stone.
  progress: Progress | undefined
  todayBlocks: Block[]
  // The first block planned tomorrow, from the calendar's seven days ahead.
  tomorrowFirst: Block | null
  tz: string
  onClose: () => void
}

export function CelebrationSheet({ celebration, progress, todayBlocks, tomorrowFirst, tz, onClose }: CelebrationSheetProps) {
  const [motion] = useState(() => !prefersReducedMotion())
  const { lead } = celebration
  const known = celebration.badges.filter((key) => badgeName(key) !== null)
  const leadBadge = lead === 'badge' ? (known[0] ?? celebration.badges[0] ?? null) : null

  let title: string
  if (lead === 'stage' && celebration.stageAfter !== null) title = t.stageTitle(en.garden.scene.stage[celebration.stageAfter])
  else if ((lead === 'level' || lead === 'stage') && celebration.level !== null) title = t.levelTitle(celebration.level)
  else if (lead === 'badge') title = t.badgeTitle((leadBadge === null ? null : badgeName(leadBadge)) ?? en.progress.badges.unknown.name)
  else title = t.dayTitle

  const others = known.filter((key) => key !== leadBadge).map((key) => badgeName(key) ?? '')
  const also = [
    celebration.level !== null && lead !== 'level' && lead !== 'stage' ? t.alsoLevel(celebration.level) : null,
    others.length > 0 ? t.alsoBadges(others) : null,
    celebration.day !== null && lead !== 'day' ? t.alsoDay : null,
  ].filter((line): line is string => line !== null)

  return (
    <Dialog
      title={<span className="font-display text-[2.5rem] leading-none font-bold">{title}</span>}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      figure={
        <div className="w-[150px]">
          <Archie mood="eureka" entrance="hop" decorative />
        </div>
      }
      footer={
        <Button variant="primary" className="flex-1" onPress={onClose}>
          {t.close}
        </Button>
      }
    >
      {lead === 'day' ? (
        <DayPart day={celebration.day} progress={progress} todayBlocks={todayBlocks} tomorrowFirst={tomorrowFirst} tz={tz} />
      ) : null}
      {lead === 'level' && celebration.level !== null ? (
        <LevelPart level={celebration.level} progress={progress} motion={motion} />
      ) : null}
      {lead === 'stage' && celebration.level !== null ? (
        <StagePart celebration={celebration} level={celebration.level} progress={progress} tz={tz} motion={motion} />
      ) : null}
      {lead === 'badge' ? <BadgePart badge={leadBadge} progress={progress} motion={motion} /> : null}
      {also.map((line) => (
        <p key={line} className="text-body">
          {line}
        </p>
      ))}
    </Dialog>
  )
}

function DayPart({
  day,
  progress,
  todayBlocks,
  tomorrowFirst,
  tz,
}: {
  day: string | null
  progress: Progress | undefined
  todayBlocks: Block[]
  tomorrowFirst: Block | null
  tz: string
}) {
  const done = todayBlocks.filter((b) => b.study_date === day && b.status === 'done')
  const minutes = done.reduce((sum, b) => sum + blockMinutes(b), 0)
  const xp = progress?.days.find((d) => d.date === day)?.xp ?? 0
  const streak = progress?.streak.current ?? 0
  return (
    <>
      <p className="text-body">{t.dayBody(done.length, durationText(minutes))}</p>
      {tomorrowFirst === null ? null : <p className="text-body">{t.tomorrow(formatTime(tomorrowFirst.starts_at, tz))}</p>}
      {xp > 0 || streak > 0 ? (
        <div className="flex flex-wrap gap-2">
          {xp > 0 ? (
            <Chip tone="gold" icon={XpSparkIcon}>
              {t.xpToday(formatNumber(xp))}
            </Chip>
          ) : null}
          {streak > 0 ? (
            <Chip tone="leaf" icon={StreakLeafIcon}>
              {t.streak(streak)}
            </Chip>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function LevelPart({ level, progress, motion }: { level: number; progress: Progress | undefined; motion: boolean }) {
  const ring = useRef<HTMLDivElement>(null)
  const percent = progress === undefined ? 0 : levelPercent(progress)
  // The arc fills from 0 once, as the sheet arrives; its own attribute is the end state.
  const played = useRef(false)
  useEffect(() => {
    if (!motion || played.current) return
    const arc = ring.current?.querySelector<SVGElement>('[data-part="arc"]')
    if (arc === null || arc === undefined || typeof arc.animate !== 'function') return
    played.current = true
    const animation = arc.animate([{ strokeDasharray: '0 100' }, { strokeDasharray: `${percent.toFixed(1)} 100` }], {
      duration: CELEBRATE_MS,
      easing: EASE_STANDARD,
    })
    return () => {
      animation.cancel()
    }
  }, [motion, percent])
  return (
    <>
      <div ref={ring} className="flex justify-center">
        <LevelRing size={RING_SIZE} stroke={RING_STROKE} percent={percent} level={level} />
      </div>
      <p className="text-body">{t.levelBody(level)}</p>
    </>
  )
}

function StagePart({
  celebration,
  level,
  progress,
  tz,
  motion,
}: {
  celebration: Celebration
  level: number
  progress: Progress | undefined
  tz: string
  motion: boolean
}) {
  return (
    <>
      {progress === undefined ? null : <Gardens celebration={celebration} level={level} progress={progress} tz={tz} motion={motion} />}
      <p className="text-body">{t.stageBody(level)}</p>
    </>
  )
}

// "Before" and "after", side by side (one above the other under sm): today's garden at the level
// before the rise, with no new leaves, and at the new level.
function Gardens({
  celebration,
  level,
  progress,
  tz,
  motion,
}: {
  celebration: Celebration
  level: number
  progress: Progress
  tz: string
  motion: boolean
}) {
  const exams = useGardenExams()
  const before = useMemo(() => {
    const lower = Math.max(1, beforeLevel(celebration, level))
    return { ...gardenModel({ progress: { ...progress, level: lower }, exams, timeZone: tz }), leaves: 0 }
  }, [celebration, level, progress, exams, tz])
  const after = useMemo(() => gardenModel({ progress: { ...progress, level }, exams, timeZone: tz }), [level, progress, exams, tz])
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <p className="text-small text-ink-muted">{t.before}</p>
        <GardenScene model={before} label={summaryOf(before)} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-small text-ink-muted">{t.after}</p>
        <GardenScene model={after} label={summaryOf(after)} className={motion ? 'garden-enter' : undefined} />
      </div>
    </div>
  )
}

// The level "before": the one just under the new level, but never past the stage before the rise
// (rules.ts worked that stage out; two rises at once, 5 to 7, still show a sprout before).
const STAGE_LAST: Record<Stage, number> = { seed: 2, sprout: 5, sapling: 10, young: 20, bonsai: 35, garden: 50 }
function beforeLevel(celebration: Celebration, level: number): number {
  return celebration.stageBefore === null ? level - 1 : Math.min(level - 1, STAGE_LAST[celebration.stageBefore])
}

function BadgePart({ badge, progress, motion }: { badge: string | null; progress: Progress | undefined; motion: boolean }) {
  const tier = badge !== null && progress?.badges.some((b) => b.key === badge) ? badgeTier(progress.badges, badge) : null
  return (
    <>
      {tier === null ? null : (
        <div className="flex justify-center">
          <BadgeStone {...tier} earned size={STONE_SIZE} className={motion ? 'garden-settle' : undefined} />
        </div>
      )}
      <p className="text-body">{t.badgeBody}</p>
    </>
  )
}
