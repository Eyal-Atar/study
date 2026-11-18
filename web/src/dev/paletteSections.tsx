import { EXAM_COLOR_COUNT, examColor } from '../ui/examColor'
import { cx } from '../ui/styles'
import { devText } from './devText'
import { Example, Section } from './Section'

const t = devText

// A time: always left to right, so "10:00–10:45" does not flip (design language 3).
function Time({ children }: { children: string }) {
  return <span dir="ltr">{children}</span>
}

// A block of the calendar, as in the prototype (.blk): the soft fill, a 1px border in the line
// colour, a 4px stripe at the start and an 18px checkbox with corners of 6px, both in the strong
// colour. The block's text colour is the strong one (currentColor carries it to the stripe and the
// checkbox, as in the prototype); the name and the time are ink, since ink-muted is not allowed on
// an exam colour. A sample only: the checkbox is decoration here, S32 builds the real block.
function SampleBlock({ index }: { index: number }) {
  const c = examColor(index)
  return (
    <div
      data-part="block"
      className={cx('rounded-control border border-s-4 border-s-current px-2 py-1.5 text-small', c.soft, c.line, c.text)}
    >
      <div className="flex items-start gap-1.5">
        <span
          data-part="check"
          aria-hidden="true"
          className="mt-px grid size-[18px] shrink-0 place-items-center rounded-[6px] border-2 border-current bg-surface"
        />
        <div className="min-w-0 flex-1">
          <p data-part="text" className="font-semibold text-ink">
            {t.palette.blockTitle}
          </p>
          <p data-part="text" className="text-caption text-ink">
            <Time>{t.palette.blockTime}</Time>
          </p>
        </div>
      </div>
    </div>
  )
}

// The card of the next task, as in the prototype (.next): white on the strong colour, with the
// two actions as light pills. The prototype darkens the colour into a gradient; the flat colour is
// the pair that theme.test.ts checks (on-brand on exam-N), and the gradient only darkens it.
function SampleNext({ index }: { index: number }) {
  const c = examColor(index)
  return (
    <div data-part="next" className={cx('rounded-card p-4 text-on-brand', c.solid)}>
      <p className="text-caption">
        {t.palette.nextWhen} · {t.palette.exams[index]}
      </p>
      <p className="mt-1.5 mb-0.5 font-semibold">{t.palette.nextTitle}</p>
      <p className="text-small">{t.palette.nextLength}</p>
      {/* The look of the actions only: no handlers on this page. */}
      <div aria-hidden="true" className="mt-3.5 flex gap-2 text-small font-semibold">
        <span className="rounded-control bg-surface/95 px-3.5 py-2 text-ink">{t.palette.nextDone}</span>
        <span className="rounded-control bg-on-brand/20 px-3.5 py-2">{t.palette.nextDefer}</span>
      </div>
    </div>
  )
}

// Busy time (a commitment, an event): grey, with no checkbox, since it is not a task. The calendar
// scope draws it, hatched; this is its colours only.
function SampleBusy() {
  return (
    <div data-part="busy" className="rounded-control border border-s-4 border-busy-line border-s-busy bg-busy-soft px-2 py-1.5 text-small">
      <p className="font-semibold text-ink">{t.palette.busyTitle}</p>
      <p className="text-caption text-ink-muted">
        <Time>{t.palette.busyTime}</Time>
      </p>
    </div>
  )
}

export function ExamPaletteSection() {
  return (
    <Section id="exam-palette">
      <p className="text-small text-ink-muted">{t.palette.caption}</p>
      <ul role="list" className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: EXAM_COLOR_COUNT }, (_, n) => (
          <li key={n} data-exam={n} className="grid min-w-0 gap-2">
            <p className="flex items-center gap-2 text-small font-medium">
              <span aria-hidden="true" className={cx('size-3 shrink-0 rounded-[4px]', examColor(n).solid)} />
              <span>
                <span dir="ltr">{`exam-${String(n)}`}</span> · {t.palette.hues[n]} · {t.palette.exams[n]}
              </span>
            </p>
            <SampleBlock index={n} />
            <SampleNext index={n} />
          </li>
        ))}
      </ul>
      <Example caption={t.palette.busy}>
        <SampleBusy />
      </Example>
    </Section>
  )
}

// The general colours. The swatch classes are written in full: Tailwind finds only classes that
// appear as they are in the source (and emits only the theme variables that some class uses).
const COLOURS = [
  { name: 'canvas', swatch: 'bg-canvas' },
  { name: 'surface', swatch: 'bg-surface' },
  { name: 'surface-muted', swatch: 'bg-surface-muted' },
  { name: 'ink', swatch: 'bg-ink' },
  { name: 'ink-muted', swatch: 'bg-ink-muted' },
  { name: 'line', swatch: 'bg-line' },
  { name: 'line-strong', swatch: 'bg-line-strong' },
  { name: 'brand', swatch: 'bg-brand' },
  { name: 'brand-strong', swatch: 'bg-brand-strong' },
  { name: 'brand-soft', swatch: 'bg-brand-soft' },
  { name: 'on-brand', swatch: 'bg-on-brand' },
  { name: 'sprout', swatch: 'bg-sprout' },
  { name: 'clay', swatch: 'bg-clay' },
  { name: 'on-clay', swatch: 'bg-on-clay' },
  { name: 'sand', swatch: 'bg-sand' },
  { name: 'gold', swatch: 'bg-gold' },
  { name: 'sky-from', swatch: 'bg-sky-from' },
  { name: 'sky-to', swatch: 'bg-sky-to' },
  { name: 'sky', swatch: 'bg-sky' },
  { name: 'now', swatch: 'bg-now' },
  { name: 'now-text', swatch: 'bg-now-text' },
  { name: 'danger', swatch: 'bg-danger' },
  { name: 'danger-soft', swatch: 'bg-danger-soft' },
  { name: 'success', swatch: 'bg-success' },
  { name: 'success-soft', swatch: 'bg-success-soft' },
  { name: 'warning', swatch: 'bg-warning' },
  { name: 'warning-soft', swatch: 'bg-warning-soft' },
  { name: 'inverse', swatch: 'bg-inverse' },
  { name: 'on-inverse', swatch: 'bg-on-inverse' },
  { name: 'inverse-action', swatch: 'bg-inverse-action' },
  { name: 'inverse-success', swatch: 'bg-inverse-success' },
  { name: 'inverse-danger', swatch: 'bg-inverse-danger' },
  { name: 'busy', swatch: 'bg-busy' },
  { name: 'busy-soft', swatch: 'bg-busy-soft' },
  { name: 'busy-line', swatch: 'bg-busy-line' },
] as const

export function ColoursSection() {
  return (
    <Section id="colours">
      <p className="text-small text-ink-muted">{t.colours.caption}</p>
      <ul role="list" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {COLOURS.map(({ name, swatch }) => (
          <li key={name} className="flex min-w-0 items-center gap-2">
            {/* A line around every swatch, so white and near-white show their edge. */}
            <span aria-hidden="true" className={cx('size-8 shrink-0 rounded-badge border border-line', swatch)} />
            <span dir="ltr" className="truncate text-small">
              {name}
            </span>
          </li>
        ))}
      </ul>
      {/* The dawn sky behind Archie is a gradient, from sky-from at the top to sky-to; text on it is
          ink (theme.test.ts measures both ends and sky, the tone between them). */}
      <Example caption={t.colours.skyCaption}>
        <div data-part="sky" className="rounded-card bg-linear-to-b from-sky-from to-sky-to p-4 text-small text-ink">
          {t.colours.sky}
        </div>
      </Example>
    </Section>
  )
}

const WEIGHTS = ['font-normal', 'font-medium', 'font-semibold', 'font-bold'] as const
const SIZES = ['text-display', 'text-title', 'text-body', 'text-small', 'text-caption'] as const

export function TypographySection() {
  return (
    <Section id="typography">
      <Example caption={t.typography.weights}>
        <ul role="list" className="space-y-2">
          {WEIGHTS.map((weight) => (
            <li key={weight}>
              <p data-sample={weight} className={cx('text-body', weight)}>
                {t.typography.sample}
              </p>
              <p className="text-caption text-ink-muted">{t.typography.weightNames[weight]}</p>
            </li>
          ))}
        </ul>
      </Example>
      <Example caption={t.typography.sizes}>
        <ul role="list" className="space-y-2">
          {SIZES.map((size) => (
            <li key={size}>
              <p data-sample={size} className={size}>
                {t.typography.sample}
              </p>
              <p className="text-caption text-ink-muted">{t.typography.sizeNames[size]}</p>
            </li>
          ))}
        </ul>
      </Example>
    </Section>
  )
}

const CORNERS = ['rounded-badge', 'rounded-control', 'rounded-card', 'rounded-sheet'] as const
const SHADOWS = ['shadow-raised', 'shadow-overlay', 'shadow-lift', 'shadow-sheet'] as const

export function ShapeSection() {
  return (
    <Section id="shape">
      <Example caption={t.shape.corners}>
        <ul role="list" className="flex flex-wrap gap-4">
          {CORNERS.map((corner) => (
            <li key={corner} className="flex flex-col items-center gap-1">
              <span aria-hidden="true" className={cx('size-16 border border-line-strong bg-surface', corner)} />
              <span className="text-caption text-ink-muted">{t.shape.names[corner]}</span>
            </li>
          ))}
        </ul>
      </Example>
      <Example caption={t.shape.shadows}>
        {/* Room around the samples, so the long shadows (lift, sheet upwards) are seen whole. */}
        <ul role="list" className="flex flex-wrap gap-6 py-4">
          {SHADOWS.map((shadow) => (
            <li key={shadow} className="flex flex-col items-center gap-2">
              <span aria-hidden="true" className={cx('size-16 rounded-card bg-surface', shadow)} />
              <span className="text-caption text-ink-muted">{t.shape.names[shadow]}</span>
            </li>
          ))}
        </ul>
      </Example>
    </Section>
  )
}
