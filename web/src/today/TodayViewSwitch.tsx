import { he } from '../i18n/he'
import { SegmentedControl } from '../ui/SegmentedControl'
import type { TodayView } from './todayView'

const VIEWS: readonly { id: TodayView; label: string }[] = [
  { id: 'list', label: he.move.list },
  { id: 'timeline', label: he.move.timeline },
]

// The switch between the list and the timeline of today's blocks (todayView.ts).
export function TodayViewSwitch({ view, onChange }: { view: TodayView; onChange: (view: TodayView) => void }) {
  return <SegmentedControl aria-label={he.move.viewLabel} options={VIEWS} value={view} onChange={onChange} />
}
