import { ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import { he } from '../i18n/he'
import type { TodayView } from './todayView'

// The switch between the list and the timeline of today's blocks (todayView.ts).
const ITEM =
  'min-h-11 rounded-md px-4 text-sm font-medium text-ink-muted outline-none transition-colors data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[hovered]:text-ink data-[selected]:bg-surface data-[selected]:text-ink data-[selected]:shadow-sm'

export function TodayViewSwitch({ view, onChange }: { view: TodayView; onChange: (view: TodayView) => void }) {
  return (
    <ToggleButtonGroup
      aria-label={he.move.viewLabel}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[view]}
      onSelectionChange={(keys) => {
        const [next] = [...keys]
        if (next === 'list' || next === 'timeline') onChange(next)
      }}
      className="inline-flex gap-1 rounded-lg bg-surface-muted p-1 ring-1 ring-line"
    >
      <ToggleButton id="list" className={ITEM}>
        {he.move.list}
      </ToggleButton>
      <ToggleButton id="timeline" className={ITEM}>
        {he.move.timeline}
      </ToggleButton>
    </ToggleButtonGroup>
  )
}
