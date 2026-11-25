import { useState } from 'react'
import { BadgeStone } from '../garden/BadgeStone'
import { GardenScene, PlantShape } from '../garden/GardenScene'
import { storyOf, summaryOf, type GardenItem, type GardenModel, type GardenPlant, type GardenStone, type PlantGrowth, type Stage } from '../garden/model'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import type { BadgeGroup } from '../progress/types'
import { cx } from '../ui/styles'
import { devText } from './devText'
import { sample } from './sampleContent'
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

// The garden scene (Task 5): every stage of the centre, every growth of an exam plant, and one
// interactive garden with its caption. Exam names are sample user content.
const g = t.garden

const STAGE_SAMPLES: { stage: Stage; level: number; leaves: number; rings: number }[] = [
  { stage: 'seed', level: 1, leaves: 0, rings: 0 },
  { stage: 'sprout', level: 4, leaves: 3, rings: 3 },
  { stage: 'sapling', level: 8, leaves: 5, rings: 7 },
  { stage: 'young', level: 15, leaves: 6, rings: 8 },
  { stage: 'bonsai', level: 28, leaves: 8, rings: 8 },
  { stage: 'garden', level: 50, leaves: 9, rings: 8 },
]

const GROWTHS: PlantGrowth[] = ['seed', 'sprout', 'stem', 'bud', 'bloom']

function samplePlant(i: number, growth: PlantGrowth): GardenPlant {
  return {
    id: `sample-${String(i)}`,
    name: sample.exams[i] ?? '',
    colorIndex: i,
    growth,
    state: growth === 'bloom' ? 'done' : 'active',
    percent: [0, 20, 50, 80, 100][i] ?? 0,
    closedOn: growth === 'bloom' ? '2026-11-12' : null,
    studiedMinutes: growth === 'bloom' ? 600 : 0,
  }
}

const EMPTY: GardenModel = {
  stage: 'seed',
  level: 1,
  maxLevel: 50,
  leaves: 0,
  rings: 0,
  plants: [],
  stones: [],
  flowers: 0,
  branches: 0,
  buds: 0,
  streakCurrent: 0,
}

const STONE_SAMPLES: GardenStone[] = [
  { key: 'first_task', group: 'first', tier: 1, tiers: 1, earnedAt: '2026-10-20' },
  { key: 'task_master_10', group: 'blocks', tier: 1, tiers: 4, earnedAt: '2026-10-28' },
  { key: 'iron_will_7', group: 'streak', tier: 1, tiers: 5, earnedAt: '2026-11-02' },
  { key: 'knowledge_seeker_5', group: 'level', tier: 1, tiers: 5, earnedAt: '2026-11-05' },
  { key: 'xp_1000', group: 'xp', tier: 1, tiers: 3, earnedAt: '2026-11-10' },
]

const FULL_GARDEN: GardenModel = {
  ...EMPTY,
  stage: 'bonsai',
  level: 24,
  leaves: 6,
  rings: 8,
  plants: [
    samplePlant(0, 'bud'),
    samplePlant(1, 'stem'),
    samplePlant(2, 'sprout'),
    samplePlant(3, 'bloom'),
    samplePlant(4, 'seed'),
  ],
  stones: STONE_SAMPLES,
  flowers: 3,
  branches: 1,
  streakCurrent: 10,
}

function badgeName(key: string): string {
  const items: Partial<Record<string, { name: string }>> = en.progress.badges.items
  return items[key]?.name ?? en.progress.badges.unknown.name
}

function InteractiveGarden() {
  const [selected, setSelected] = useState<GardenItem | null>(null)
  const [round, setRound] = useState(0)
  return (
    <Example caption={g.interactive} className="space-y-2">
      <GardenScene
        key={round}
        model={FULL_GARDEN}
        selected={selected}
        onSelect={setSelected}
        play="open"
        label={summaryOf(FULL_GARDEN)}
      />
      <p className="text-small text-ink" aria-live="polite">
        {selected === null ? g.none : g.selected(storyOf(FULL_GARDEN, selected, badgeName))}
      </p>
      <Button
        variant="secondary"
        onClick={() => {
          setRound((r) => r + 1)
        }}
      >
        {g.replay}
      </Button>
    </Example>
  )
}

function OpeningBloom() {
  const [round, setRound] = useState(0)
  return (
    <Example caption={g.opening} className={ROW}>
      <svg viewBox="-24 -48 48 56" width={96} height={112} aria-hidden="true" key={round}>
        <PlantShape growth="bloom" colorIndex={2} opening />
      </svg>
      <Button
        variant="secondary"
        onClick={() => {
          setRound((r) => r + 1)
        }}
      >
        {g.replay}
      </Button>
    </Example>
  )
}

export function GardenSceneSection() {
  return (
    <Section id="garden-scene">
      <p className="text-small text-ink-muted">{g.intro}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {STAGE_SAMPLES.map(({ stage, level, leaves, rings }) => {
          const model: GardenModel = { ...EMPTY, stage, level, leaves, rings }
          return (
            <Example key={stage} caption={g.stage(en.garden.scene.stage[stage], level, leaves, rings)}>
              <GardenScene model={model} label={summaryOf(model)} />
            </Example>
          )
        })}
        <Example caption={g.plants}>
          {(() => {
            const model: GardenModel = { ...EMPTY, stage: 'sapling', level: 6, plants: GROWTHS.map((growth, i) => samplePlant(i, growth)) }
            return <GardenScene model={model} label={summaryOf(model)} />
          })()}
        </Example>
        <Example caption={g.buds}>
          {(() => {
            const model: GardenModel = { ...EMPTY, stage: 'young', level: 12, rings: 8, buds: 4, stones: STONE_SAMPLES.slice(0, 2) }
            return <GardenScene model={model} label={summaryOf(model)} />
          })()}
        </Example>
        <InteractiveGarden />
        <OpeningBloom />
      </div>
    </Section>
  )
}
