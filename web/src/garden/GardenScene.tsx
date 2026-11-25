import type { JSX, KeyboardEvent, ReactNode } from 'react'
import { isolate } from '../i18n/bidi'
import { en } from '../i18n/en'
import { cx } from '../ui/styles'
import { StoneShape } from './BadgeStone'
import './garden.css'
import type { GardenItem, GardenModel } from './model'
import { LEAF, POND, rakeLine, STAGE_ART } from './gardenShapes'
import { Leaf, PlantShape, StagePlant, StreakBranch, StreakBud, StreakFlower } from './parts'

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

function badgeName(key: string): string {
  const items: Partial<Record<string, { name: string }>> = en.progress.badges.items
  return items[key]?.name ?? en.progress.badges.unknown.name
}

// The hit area of an item and the dashed line of its focus, the same shape.
type Area = { kind: 'rect'; x: number; y: number; width: number; height: number } | { kind: 'circle'; r: number }

function AreaShape({ area, className, hit }: { area: Area; className: string; hit?: boolean }) {
  const common = {
    'aria-hidden': true,
    className,
    fill: 'none',
    ...(hit
      ? { pointerEvents: 'all', 'data-hit': '' }
      : { strokeWidth: 2, strokeDasharray: '4 3', pointerEvents: 'none' }),
  } as const
  return area.kind === 'rect' ? (
    <rect x={area.x} y={area.y} width={area.width} height={area.height} rx={8} {...common} />
  ) : (
    <circle r={area.r} {...common} />
  )
}

// One thing in the garden: a button when the scene is interactive, a picture otherwise.
function Item({
  item,
  label,
  area,
  transform,
  selected,
  onSelect,
  data,
  children,
}: {
  item: GardenItem
  label: string
  area: Area
  transform?: string
  selected: boolean
  onSelect?: (item: GardenItem) => void
  data?: Record<`data-${string}`, string>
  children: ReactNode
}) {
  const interactive = onSelect !== undefined
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
      {...(interactive
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
      <AreaShape area={area} className="" hit />
      <g aria-hidden="true">{children}</g>
      <AreaShape area={area} className="garden-ring stroke-brand" />
    </g>
  )
}

// The stones: from the base outwards, one to the right and one to the left, alternating between a
// back row (y=128) and a front row (y=140); the back row is drawn first so the front one covers it.
function stonePlaces(count: number) {
  return Array.from({ length: Math.min(count, MAX_STONES) }, (_, i) => {
    const step = Math.floor(i / 2)
    const side = i % 2 === 0 ? 1 : -1
    return { index: i, x: CENTRE_X + side * (34 + step * 17), y: step % 2 === 0 ? 140 : 128 }
  }).sort((a, b) => a.y - b.y)
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
  const art = STAGE_ART[model.stage]
  const treeHeight = Math.max(HIT, art.height + 8)
  const treeWidth = Math.max(HIT, art.width)
  const pick = { onSelect }
  const showFlowers = model.flowers + model.branches + model.buds > 0

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

        <Item
          item={{ kind: 'tree' }}
          label={en.garden.scene.stage[model.stage]}
          area={{ kind: 'rect', x: -treeWidth / 2, y: 4 - treeHeight, width: treeWidth, height: treeHeight }}
          transform={`translate(${String(CENTRE_X)} ${String(BASE_Y)})`}
          selected={sameItem(selected, { kind: 'tree' })}
          data={{ 'data-stage': model.stage }}
          {...pick}
        >
          <g className={play === 'open' ? 'garden-sway' : undefined}>
            <StagePlant stage={model.stage} />
            {art.leaves.slice(0, model.leaves).map((spot) => (
              <Leaf key={spot.join(',')} spot={spot} />
            ))}
          </g>
          {play === 'open' && (
            <g transform={`translate(${String(art.fall[0])} ${String(art.fall[1])})`}>
              <path d={LEAF} className="garden-leaf-fall fill-sprout stroke-brand" strokeWidth={1} strokeLinejoin="round" />
            </g>
          )}
        </Item>

        {model.plants.slice(0, PLANT_X.length).map((plant, i) => {
          const x = PLANT_X[i] ?? CENTRE_X
          const item: GardenItem = { kind: 'plant', id: plant.id }
          return (
            <Item
              key={plant.id}
              item={item}
              label={isolate(plant.name)}
              area={{ kind: 'rect', x: -HIT / 2, y: -42, width: HIT, height: 46 }}
              transform={`translate(${String(x)} ${String(BASE_Y)})`}
              selected={sameItem(selected, item)}
              data={{ 'data-x': String(x) }}
              {...pick}
            >
              <PlantShape growth={plant.growth} colorIndex={plant.colorIndex} />
            </Item>
          )
        })}

        {stonePlaces(model.stones.length).map(({ index, x, y }) => {
          const stone = model.stones[index]
          if (stone === undefined) return null
          const item: GardenItem = { kind: 'stone', key: stone.key }
          return (
            <Item
              key={stone.key}
              item={item}
              label={badgeName(stone.key)}
              area={{ kind: 'circle', r: HIT / 2 }}
              transform={`translate(${String(x)} ${String(y)})`}
              selected={sameItem(selected, item)}
              {...pick}
            >
              <g transform={`translate(${String(-STONE_SIZE / 2)} ${String(-STONE_SIZE / 2)}) scale(${String(STONE_SCALE)})`}>
                <StoneShape group={stone.group} earned />
              </g>
            </Item>
          )
        })}

        {showFlowers && (
          <Item
            item={{ kind: 'flowers' }}
            label={model.streakCurrent > 0 ? en.garden.celebrate.streak(model.streakCurrent) : en.garden.story.buds}
            area={flowersArea(model)}
            selected={sameItem(selected, { kind: 'flowers' })}
            {...pick}
          >
            <Flowers model={model} />
          </Item>
        )}
      </svg>
    </div>
  )
}
