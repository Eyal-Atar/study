import { useState } from 'react'
import { Button } from '../ui/Button'
import { Note } from '../ui/Note'
import { OptionGrid } from '../ui/OptionGrid'
import { SegmentedControl } from '../ui/SegmentedControl'
import { useToast } from '../ui/useToast'
import { UserText } from '../ui/UserText'
import { devText } from './devText'
import { sample } from './sampleContent'
import { Example, FIELD_GRID, Section } from './Section'

// The components that S27 (the daily screens) added to ui/. They are in a file of their own, so
// the sections that S28 adds in parallel do not meet them in one file.

const t = devText

const VIEWS = [
  { id: 'list', label: t.segmentedControl.list },
  { id: 'timeline', label: t.segmentedControl.timeline },
] as const

const RANGES = [
  { id: 'day', label: t.segmentedControl.day },
  { id: 'week', label: t.segmentedControl.week },
  { id: 'month', label: t.segmentedControl.month },
] as const

// A SegmentedControl that owns its value, with a line under it that says which view is shown:
// the control switches content, so the example has content to switch.
function DemoSegmentedControl<T extends string>({
  label,
  options,
  initial,
}: {
  label: string
  options: readonly { id: T; label: string }[]
  initial: T
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className="flex flex-col items-start gap-2">
      <SegmentedControl aria-label={label} options={options} value={value} onChange={setValue} />
      <p className="text-small text-ink-muted">
        {t.segmentedControl.shown} {options.find((option) => option.id === value)?.label}
      </p>
    </div>
  )
}

export function SegmentedControlSection() {
  return (
    <Section id="segmented-control">
      <div className={FIELD_GRID}>
        <Example caption={t.segmentedControl.two}>
          <DemoSegmentedControl label={t.segmentedControl.viewLabel} options={VIEWS} initial="list" />
        </Example>
        <Example caption={t.segmentedControl.three}>
          <DemoSegmentedControl label={t.segmentedControl.rangeLabel} options={RANGES} initial="week" />
        </Example>
      </div>
    </Section>
  )
}

export function NoteSection() {
  const toast = useToast()
  const retry = () => {
    toast.show({ text: t.note.retried })
  }
  return (
    <Section id="note">
      <div className={FIELD_GRID}>
        <Example caption={t.note.neutral}>
          <Note>{t.note.neutralText}</Note>
        </Example>
        <Example caption={t.note.withTitle}>
          <Note title={t.note.title}>{t.note.titleText}</Note>
        </Example>
        <Example caption={t.note.withAction}>
          <Note
            role="status"
            action={
              <Button variant="quiet" onPress={retry}>
                {t.note.retry}
              </Button>
            }
          >
            {t.note.refreshText}
          </Note>
        </Example>
        <Example caption={t.note.warning}>
          <Note tone="warning" role="alert">
            {t.note.warningText}
          </Note>
        </Example>
        <Example caption={t.note.warningAction}>
          <Note
            tone="warning"
            title={t.note.warningTitle}
            action={
              <Button variant="secondary" onPress={retry}>
                {t.note.rebuild}
              </Button>
            }
          >
            {t.note.warningActionText}
          </Note>
        </Example>
        <Example caption={t.note.long}>
          <Note
            action={
              <Button variant="quiet" onPress={retry}>
                {t.note.retry}
              </Button>
            }
          >
            <UserText>{sample.longFileName}</UserText>
          </Note>
        </Example>
      </div>
    </Section>
  )
}

// Every half hour from `from` (an hour) for `count` slots: '09:00', '09:30', …
function halfHours(from: number, count: number): { id: string; label: string }[] {
  return Array.from({ length: count }, (_, index) => {
    const minutes = from * 60 + index * 30
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    return { id: time, label: time }
  })
}

const FEW_TIMES = halfHours(9, 7)
const MANY_TIMES = halfHours(8, 28)
const DAYS = t.optionGrid.days.map((day) => ({ id: day, label: day }))

// An OptionGrid that owns its value, with a line under it that says what is chosen.
function DemoOptionGrid({
  label,
  options,
  initial = null,
  ltr,
}: {
  label: string
  options: readonly { id: string; label: string }[]
  initial?: string | null
  ltr?: boolean
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className="flex flex-col gap-2">
      <OptionGrid aria-label={label} options={options} value={value} onChange={setValue} ltr={ltr} />
      <p className="text-small text-ink-muted">
        {t.optionGrid.chosen}{' '}
        {value === null ? t.optionGrid.nothing : <span dir={ltr === true ? 'ltr' : undefined}>{value}</span>}
      </p>
    </div>
  )
}

export function OptionGridSection() {
  return (
    <Section id="option-grid">
      <div className={FIELD_GRID}>
        <Example caption={t.optionGrid.empty}>
          <DemoOptionGrid label={t.optionGrid.timeLabel} options={FEW_TIMES} ltr />
        </Example>
        <Example caption={t.optionGrid.selected}>
          <DemoOptionGrid label={t.optionGrid.timeLabel} options={FEW_TIMES} initial="10:00" ltr />
        </Example>
        <Example caption={t.optionGrid.many}>
          <DemoOptionGrid label={t.optionGrid.timeLabel} options={MANY_TIMES} initial="13:30" ltr />
        </Example>
        <Example caption={t.optionGrid.words}>
          <DemoOptionGrid label={t.optionGrid.dayLabel} options={DAYS} />
        </Example>
      </div>
    </Section>
  )
}
