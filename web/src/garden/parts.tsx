import type { CSSProperties, JSX } from 'react'
import { examColor } from '../ui/examColor'
import { LEAF, STAGE_ART, type LeafSpot } from './gardenShapes'
import type { PlantGrowth, Stage } from './model'

/*
  The pieces of the garden scene (S33, Task 5), each drawn in code at its own origin: the base of
  a plant is (0, 0) and up is negative y, so the scene only has to place them. Every colour is a
  token class (fill-*, stroke-*, examColor), so day and dusk need no branch here.
*/

// The five petals of BlossomIcon (ui/icons/archi.tsx) on its 24 grid, centred on (12, 12): the
// streak branches and the flowering branch of the full garden draw it larger, in their own colour.
const BLOSSOM =
  'M9.88 9.09C7.44 1.77 16.56 1.77 14.12 9.09 20.32 4.51 23.14 13.17 15.42 13.11 21.7 17.6 14.33 22.96 12 15.6 9.67 22.96 2.3 17.6 8.58 13.11.86 13.17 3.68 4.51 9.88 9.09Z'

/** A blossom of the icon set, `size` units wide, centred on (x, y), gold on its gold line. */
export function Blossom({ x, y, size }: { x: number; y: number; size: number }): JSX.Element {
  const scale = size / 24
  return (
    <g transform={`translate(${String(x - size / 2)} ${String(y - size / 2)}) scale(${String(scale)})`}>
      <path d={BLOSSOM} className="fill-gold-soft stroke-gold-ink" strokeWidth={1 / scale} strokeLinejoin="round" />
      <circle cx={12} cy={12} r={1.6} className="fill-gold-ink" />
    </g>
  )
}

// The flowering branch of the full garden: three blossoms on its pads.
const GARDEN_BLOSSOMS: readonly (readonly [number, number])[] = [
  [-36, -58],
  [-24, -60],
  [33, -76],
]

/** A leaf of the model at one of the fixed places. */
export function Leaf({ spot }: { spot: LeafSpot }): JSX.Element {
  const [x, y, angle] = spot
  return (
    <path
      d={LEAF}
      transform={`translate(${String(x)} ${String(y)}) rotate(${String(angle)})`}
      className="fill-sprout stroke-brand"
      strokeWidth={1}
      strokeLinejoin="round"
      data-leaf=""
    />
  )
}

/** The plant at the centre without its leaves: what the stage draws. */
export function StagePlant({ stage }: { stage: Stage }): JSX.Element {
  const art = STAGE_ART[stage]
  return (
    <>
      {stage === 'seed' && (
        <>
          {/* A low mound of sand, the seed in it as a pebble, and the first stem out of it. */}
          <path d="M-14 1c3-4 8-6 14-6s11 2 14 6Z" className="fill-sand stroke-line-strong" strokeWidth={1.25} />
          <ellipse cx={0} cy={-6} rx={5} ry={3.5} className="fill-surface-muted stroke-line-strong" strokeWidth={1.25} />
          <path d="M0-9.5c0-2 .6-3.4 2.2-4.5" fill="none" className="stroke-brand" strokeWidth={1.5} strokeLinecap="round" />
        </>
      )}
      {stage === 'sprout' && (
        <>
          <ellipse cx={-5} cy={-1.5} rx={4.5} ry={2.75} className="fill-surface-muted stroke-line-strong" strokeWidth={1.25} />
          <path d="M0 0C0-8-1-14 0-20" fill="none" className="stroke-brand" strokeWidth={2} strokeLinecap="round" />
          <path d="M0-20c-3-5-9-6-12-3 3 4 8 5 12 3Z" className="fill-sprout stroke-brand" strokeWidth={1.25} strokeLinejoin="round" />
          <path d="M0-20c3-6 10-8 13-4-3 4-9 6-13 4Z" className="fill-sprout stroke-brand" strokeWidth={1.25} strokeLinejoin="round" />
        </>
      )}
      {art.wood.map((d) => (
        <path key={d} d={d} className="fill-clay" />
      ))}
      {art.pads.map(([cx, cy, rx, ry]) => (
        <ellipse key={`${String(cx)},${String(cy)}`} cx={cx} cy={cy} rx={rx} ry={ry} className="fill-sprout stroke-brand" strokeWidth={1.25} />
      ))}
      {stage === 'garden' && GARDEN_BLOSSOMS.map(([x, y]) => <Blossom key={`${String(x)},${String(y)}`} x={x} y={y} size={10} />)}
    </>
  )
}

// The leaves of an exam plant, pairs up its stem.
function StemLeaves({ at }: { at: number[] }) {
  return (
    <>
      {at.map((y, i) => (
        <path
          key={y}
          d={i % 2 === 0 ? `M0 ${String(y)}c-2.5-3.5-6.5-4-8.5-2 2 3 6 3.5 8.5 2Z` : `M0 ${String(y)}c2.5-3.5 6.5-4 8.5-2-2 3-6 3.5-8.5 2Z`}
          className="fill-sprout stroke-brand"
          strokeWidth={1}
          strokeLinejoin="round"
        />
      ))}
    </>
  )
}

const stem = (top: number) => (
  <path d={`M0 0C.5 ${String(top / 3)}-.5 ${String((top * 2) / 3)} 0 ${String(top)}`} fill="none" className="stroke-brand" strokeWidth={1.75} strokeLinecap="round" />
)

// The centre of the flower of a bloom, above its base.
const FLOWER_Y = -33
// A petal from the centre up, 7.5 units long: scaled from its bottom, it opens out of the centre.
const PETAL = `M0 ${String(FLOWER_Y)}C-3 ${String(FLOWER_Y - 2)}-3.5 ${String(FLOWER_Y - 6)} 0 ${String(FLOWER_Y - 7.5)}C3.5 ${String(FLOWER_Y - 6)} 3 ${String(FLOWER_Y - 2)} 0 ${String(FLOWER_Y)}Z`
const PETAL_DELAY_MS = 120

/** The plant of an exam, its base at (0, 0): a seed, a sprout, a stem, a bud in the colour of the
 *  exam, or the open flower of a closed exam. `opening` opens the petals one after another. */
export function PlantShape({
  growth,
  colorIndex,
  opening = false,
}: {
  growth: PlantGrowth
  colorIndex: number
  opening?: boolean
}): JSX.Element {
  const colour = examColor(colorIndex).fill
  return (
    <g data-growth={growth}>
      {growth === 'seed' && (
        <>
          <path d="M-7 0c2-3 4.5-4 7-4s5 1 7 4Z" className="fill-sand stroke-line-strong" strokeWidth={1} />
          <ellipse cx={0} cy={-4.5} rx={3} ry={2.2} className="fill-surface-muted stroke-line-strong" strokeWidth={1} />
        </>
      )}
      {growth === 'sprout' && (
        <>
          {stem(-16)}
          <StemLeaves at={[-14, -16]} />
        </>
      )}
      {growth === 'stem' && (
        <>
          {stem(-26)}
          <StemLeaves at={[-10, -17, -24, -26]} />
        </>
      )}
      {growth === 'bud' && (
        <>
          {stem(-27)}
          <StemLeaves at={[-10, -17]} />
          <ellipse cx={0} cy={-31.5} rx={3.4} ry={4.8} className={`${colour} stroke-ink`} strokeWidth={1} data-part="bud" />
        </>
      )}
      {growth === 'bloom' && (
        <>
          {stem(FLOWER_Y + 2)}
          <StemLeaves at={[-10, -17]} />
          {[0, 1, 2, 3, 4].map((i) => {
            const style: CSSProperties | undefined = opening ? { animationDelay: `${String(i * PETAL_DELAY_MS)}ms` } : undefined
            return (
              <g key={i} transform={`rotate(${String(i * 72)} 0 ${String(FLOWER_Y)})`}>
                <path
                  d={PETAL}
                  className={`${colour} stroke-ink${opening ? ' garden-petal' : ''}`}
                  strokeWidth={1}
                  strokeLinejoin="round"
                  style={style}
                  data-petal=""
                />
              </g>
            )
          })}
          <circle cx={0} cy={FLOWER_Y} r={2.2} className="fill-gold stroke-ink" strokeWidth={1} data-part="flower-centre" />
        </>
      )}
    </g>
  )
}

/** A flower of the streak: five round petals, gold-soft on a gold-ink line. */
export function StreakFlower({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g transform={`translate(${String(x)} ${String(y)})`} data-flower="">
      <path d="M0 0v8" className="stroke-brand" strokeWidth={1.25} strokeLinecap="round" />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = ((i * 72 - 90) * Math.PI) / 180
        return (
          <circle
            key={i}
            cx={Math.round(Math.cos(a) * 2.4 * 100) / 100}
            cy={Math.round(Math.sin(a) * 2.4 * 100) / 100}
            r={2}
            className="fill-gold-soft stroke-gold-ink"
            strokeWidth={0.75}
          />
        )
      })}
      <circle r={1.1} className="fill-gold-ink" />
    </g>
  )
}

/** A branch of seven days: a clay twig and the blossom of the icon set, larger. */
export function StreakBranch({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g transform={`translate(${String(x)} ${String(y)})`} data-branch="">
      <path d="M0 14C-.5 9 .5 5 0 0" fill="none" className="stroke-clay" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M0 8c2-1 3.5-1 5 .5-2 1.2-3.5 1-5-.5Z" className="fill-sprout stroke-brand" strokeWidth={0.75} />
      <Blossom x={0} y={0} size={14} />
    </g>
  )
}

/** A bud of a streak that ended: closed, on surface-muted. */
export function StreakBud({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g transform={`translate(${String(x)} ${String(y)})`} data-bud="">
      <path d="M0 0v8" className="stroke-brand" strokeWidth={1.25} strokeLinecap="round" />
      <ellipse cx={0} cy={-.5} rx={2.6} ry={3.4} className="fill-surface-muted stroke-line-strong" strokeWidth={1} />
    </g>
  )
}
