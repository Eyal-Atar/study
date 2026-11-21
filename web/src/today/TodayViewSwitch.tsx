import { en } from '../i18n/en'
import { SegmentedControl } from '../ui/SegmentedControl'
import type { TodayView } from './todayView'

const VIEWS: readonly { id: TodayView; label: string }[] = [
  { id: 'list', label: en.move.list },
  { id: 'timeline', label: en.move.timeline },
]

// The switch between the list and the timeline of today's blocks (todayView.ts).
export function TodayViewSwitch({ view, onChange }: { view: TodayView; onChange: (view: TodayView) => void }) {
  return <SegmentedControl aria-label={en.move.viewLabel} options={VIEWS} value={view} onChange={onChange} />
}
