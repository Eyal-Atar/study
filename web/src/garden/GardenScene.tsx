import type { JSX, KeyboardEvent, ReactNode, SVGProps } from 'react'
import { isolate } from '../i18n/bidi'
import { en } from '../i18n/en'
import { cx } from '../ui/styles'
import { StoneShape } from './BadgeStone'
import './garden.css'
import type { GardenItem, GardenModel } from './model'
import { LEAF, POND, rakeLine, STAGE_ART } from './gardenShapes'
import { Leaf, PlantShape, StagePlant, StreakBranch, StreakBud, StreakFlower } from './parts'
import { badgeName } from '../progress/badgeNames'

export { PlantShape } from './parts'

/*
  The garden of the progress screen (S33, Task 5): one SVG scene on a 360 x 160 grid. The sky is
  the gradient of the frame in CSS, so the sides beside a wide screen are sky too; the sand runs
  from x=-200 to x=560 for the same reason (the SVG does not clip).

  At the centre (x=180, base y=118) the plant of the stage, its leaves at fixed places and the
  raked rings around its base; the exam plants in eight fixed places on both sides of it; the
  stones in a row in front; the streak flowers or buds in the front right corner.

  With onSelect every item is a button of at least 44 units with its short name; without it the
  scene is a picture only (the before and after of the celebration sheet).
*/

export interface GardenSceneProps {
  model: GardenModel
  selected?: GardenItem | null
  /** Without it nothing is focusable (the sheet's before and after). */
  onSelect?: (item: GardenItem) => void
  /** The opening motion of the progress screen. */
  play?: 'open' | null
  /** The accessible name of the group (summaryOf). */
  label: string
  className?: string
}

/** The opening sway of the centre (decision 11, garden.css): 1,200ms. The falling leaf ends with it. */
export const SWAY_MS = 1200

const CENTRE_X = 180
const BASE_Y = 118
const GROUND_Y = 112
// The eight places of the exam plants, alternating left and right of the centre.
const PLANT_X = [140, 220, 104, 256, 68, 292, 32, 328] as const
const HIT = 44
const RING_GAP = 7
const MAX_STONES = 18
const STONE_SCALE = 0.6
const STONE_SIZE = 48 * STONE_SCALE

const sameItem = (a: GardenItem | null | undefined, b: GardenItem) => {
  if (a === null || a === undefined || a.kind !== b.kind) return false
  if (a.kind === 'plant' && b.kind === 'plant') return a.id === b.id
  if (a.kind === 'stone' && b.kind === 'stone') return a.key === b.key
  return true
}

const itemId = (item: GardenItem) =>
  item.kind === 'plant' ? `plant:${item.id}` : item.kind === 'stone' ? `stone:${item.key}` : item.kind

// The hit area of an item and the dashed line of its focus, the same shape.
type Area = { kind: 'rect'; x: number; y: number; width: number; height: number } | { kind: 'circle'; r: number }

function AreaShape({ area, className, ...rest }: { area: Area; className?: string } & SVGProps<SVGRectElement & SVGCircleElement>) {
  return area.kind === 'rect' ? (
    <rect x={area.x} y={area.y} width={area.width} height={area.height} rx={8} className={className} {...rest} />
  ) : (
    <circle r={area.r} className={className} {...rest} />
  )
}

// One thing in the garden, with what both of its layers need.
interface Entry {
  item: GardenItem
  label: string
  area: Area
  transform?: string
  data?: Record<`data-${string}`, string>
  art: ReactNode
}

// The art of a thing: a button when the scene is interactive, a picture otherwise. Its hit area is
// not here but in the layer under all the art (HitLayer), so a tap on drawn art always goes to the
// thing drawn there, and the 44-unit area only catches taps on the empty sand around it.
function Item({
  entry,
  selected,
  onSelect,
}: {
  entry: Entry
  selected: boolean
  onSelect?: (item: GardenItem) => void
}) {
  const { item, label, area, transform, data, art } = entry
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect?.(item)
    }
  }
  return (
    <g
      transform={transform}
      className="garden-item"
      data-item={itemId(item)}
      data-selected={selected ? '' : undefined}
      {...data}
      {...(onSelect
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': label,
            'aria-pressed': selected,
            onClick: () => {
              onSelect(item)
            },
            onKeyDown,
          }
        : { 'aria-hidden': true })}
    >
      <g aria-hidden="true">{art}</g>
      <AreaShape
        area={area}
        aria-hidden="true"
        className="garden-ring stroke-brand"
        fill="none"
        strokeWidth={2}
        strokeDasharray="4 3"
        pointerEvents="none"
      />
    </g>
  )
}

// The transparent hit areas of every thing, in one layer under all the art. The same choice as the
// button above it; a pointer only, since the keyboard reaches the button itself.
function HitLayer({ entries, onSelect }: { entries: Entry[]; onSelect: (item: GardenItem) => void }) {
  return (
    <g aria-hidden="true">
      {entries.map(({ item, area, transform }) => (
        <g key={itemId(item)} transform={transform}>
          <AreaShape
            area={area}
            fill="none"
            pointerEvents="all"
            className="garden-hit"
            data-hit={itemId(item)}
            onClick={() => {
              onSelect(item)
            }}
          />
        </g>
      ))}
    </g>
  )
}

// The stones, from the base outwards on both sides, alternating between a back row (y=128) and a
// front row (y=140); the back row is drawn first so the front one covers it. A stone is 28.8 units
// wide, so its centre stays 14.4 units inside the card. With flowers in the front right corner, the
// right side ends left of their area and the rest go to the left, closer together.
const STONE_HALF = STONE_SIZE / 2
const STONE_FIRST = 34
const STONE_STEP = 16
const STONE_REACH = CENTRE_X - STONE_HALF

function stoneSide(count: number, sign: 1 | -1, reach: number) {
  const step = count > 1 ? Math.min(STONE_STEP, (reach - STONE_FIRST) / (count - 1)) : STONE_STEP
  return Array.from({ length: count }, (_, k) => ({
    x: Math.round((CENTRE_X + sign * (STONE_FIRST + k * step)) * 100) / 100,
    y: k % 2 === 0 ? 140 : 128,
  }))
}

function stonePlaces(count: number, flowers: Area | null) {
  const n = Math.min(count, MAX_STONES)
  const rightReach = flowers?.kind === 'rect' ? Math.min(STONE_REACH, flowers.x - STONE_HALF - CENTRE_X) : STONE_REACH
  const rightRoom = Math.max(0, Math.floor((rightReach - STONE_FIRST) / STONE_STEP) + 1)
  const rightCount = Math.min(Math.ceil(n / 2), rightRoom)
  const leftCount = n - rightCount
  const right = stoneSide(rightCount, 1, rightReach)
  const left = stoneSide(leftCount, -1, STONE_REACH)
  // Stone i goes right and left in turn while the right side has room, then left.
  const places: { index: number; x: number; y: number }[] = []
  let r = 0
  let l = 0
  for (let i = 0; i < n; i++) {
    const place = (i % 2 === 0 && r < rightCount) || l >= leftCount ? right[r++] : left[l++]
    if (place) places.push({ index: i, ...place })
  }
  return places.sort((a, b) => a.y - b.y)
}

// The flowers of the streak, the branches above them, or the buds: in the front right corner,
// from the right edge leftwards.
const CORNER_RIGHT = 352
function Flowers({ model }: { model: GardenModel }) {
  return (
    <>
      {Array.from({ length: model.branches }, (_, i) => (
        <StreakBranch key={`b${String(i)}`} x={CORNER_RIGHT - 4 - i * 16} y={134} />
      ))}
      {Array.from({ length: model.flowers }, (_, i) => (
        <StreakFlower key={`f${String(i)}`} x={CORNER_RIGHT - i * 9} y={150} />
      ))}
      {Array.from({ length: model.buds }, (_, i) => (
        <StreakBud key={`u${String(i)}`} x={CORNER_RIGHT - i * 8} y={150} />
      ))}
    </>
  )
}

function flowersArea(model: GardenModel): Area {
  const reach = Math.max(model.branches * 16, model.flowers * 9, model.buds * 8)
  const width = Math.max(HIT, reach + 12)
  return { kind: 'rect', x: CORNER_RIGHT + 6 - width, y: 116, width, height: HIT }
}

export function GardenScene({ model, selected, onSelect, play, label, className }: GardenSceneProps): JSX.Element {
  const stageArt = STAGE_ART[model.stage]
  const treeHeight = Math.max(HIT, stageArt.height + 8)
  const treeWidth = Math.max(HIT, stageArt.width)
  const showFlowers = model.flowers + model.branches + model.buds > 0
  const flowers = showFlowers ? flowersArea(model) : null

  const entries: Entry[] = [
    {
      item: { kind: 'tree' },
      label: en.garden.scene.stage[model.stage],
      area: { kind: 'rect', x: -treeWidth / 2, y: 4 - treeHeight, width: treeWidth, height: treeHeight },
      transform: `translate(${String(CENTRE_X)} ${String(BASE_Y)})`,
      data: { 'data-stage': model.stage },
      art: (
        <>
          <g className={play === 'open' ? 'garden-sway' : undefined}>
            <StagePlant stage={model.stage} />
            {stageArt.leaves.slice(0, model.leaves).map((spot) => (
              <Leaf key={spot.join(',')} spot={spot} />
            ))}
          </g>
          {play === 'open' && (
            <g transform={`translate(${String(stageArt.fall[0])} ${String(stageArt.fall[1])})`}>
              <path d={LEAF} className="garden-leaf-fall fill-sprout stroke-brand" strokeWidth={1} strokeLinejoin="round" />
            </g>
          )}
        </>
      ),
    },
    ...model.plants.slice(0, PLANT_X.length).map((plant, i): Entry => {
      const x = PLANT_X[i] ?? CENTRE_X
      return {
        item: { kind: 'plant', id: plant.id },
        label: isolate(plant.name),
        area: { kind: 'rect', x: -HIT / 2, y: -42, width: HIT, height: 46 },
        transform: `translate(${String(x)} ${String(BASE_Y)})`,
        data: { 'data-x': String(x) },
        art: <PlantShape growth={plant.growth} colorIndex={plant.colorIndex} />,
      }
    }),
    ...stonePlaces(model.stones.length, flowers).flatMap(({ index, x, y }): Entry[] => {
      const stone = model.stones[index]
      if (stone === undefined) return []
      return [
        {
          item: { kind: 'stone', key: stone.key },
          label: badgeName(stone.key),
          area: { kind: 'circle', r: HIT / 2 },
          transform: `translate(${String(x)} ${String(y)})`,
          art: (
            <g transform={`translate(${String(-STONE_HALF)} ${String(-STONE_HALF)}) scale(${String(STONE_SCALE)})`}>
              <StoneShape group={stone.group} earned onSand />
            </g>
          ),
        },
      ]
    }),
    ...(flowers === null
      ? []
      : [
          {
            item: { kind: 'flowers' } as const,
            label: model.streakCurrent > 0 ? en.garden.celebrate.streak(model.streakCurrent) : en.garden.scene.buds,
            area: flowers,
            art: <Flowers model={model} />,
          },
        ]),
  ]

  return (
    <div className={cx('relative overflow-hidden rounded-card bg-linear-to-b from-sky-from to-sky-to', className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 360 160"
        overflow="visible"
        preserveAspectRatio="xMidYMax meet"
        className="block h-auto w-full max-h-64"
        role="group"
        aria-label={label}
      >
        {/* The sand, wider than the grid, and three raked lines across it. */}
        <g aria-hidden="true">
          <rect x={-200} y={GROUND_Y} width={760} height={160 - GROUND_Y} className="fill-sand" />
          {[126, 138, 150].map((y) => (
            <path key={y} d={rakeLine(y)} fill="none" className="stroke-line" strokeWidth={1.25} strokeLinecap="round" />
          ))}
        </g>

        {/* A raked ring around the base for every level, up to eight. */}
        <g aria-hidden="true" transform={`translate(${String(CENTRE_X)} ${String(BASE_Y + 3)})`}>
          {Array.from({ length: model.rings }, (_, i) => (
            <ellipse key={i} rx={22 + i * RING_GAP} ry={5 + i * 2} fill="none" className="stroke-line-strong" strokeWidth={1.25} data-ring="" />
          ))}
        </g>

        {model.stage === 'garden' && (
          <ellipse
            aria-hidden="true"
            cx={CENTRE_X + POND.cx}
            cy={BASE_Y + POND.cy}
            rx={POND.rx}
            ry={POND.ry}
            className="fill-sky stroke-line-strong"
            strokeWidth={1}
            data-part="pond"
          />
        )}

        {onSelect && <HitLayer entries={entries} onSelect={onSelect} />}

        {entries.map((entry) => (
          <Item key={itemId(entry.item)} entry={entry} selected={sameItem(selected, entry.item)} onSelect={onSelect} />
        ))}
      </svg>
    </div>
  )
}
