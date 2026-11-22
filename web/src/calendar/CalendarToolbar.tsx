import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { ChevronLeft, ChevronRight } from '../ui/icons'
import { IconButton } from '../ui/IconButton'
import { SegmentedControl } from '../ui/SegmentedControl'
import { ICON_STROKE } from '../ui/styles'
import type { CalendarView } from './calendarUrl'

const VIEWS: readonly { id: CalendarView; label: string }[] = [
  { id: 'day', label: en.calendar.day },
  { id: 'week', label: en.calendar.week },
]

export interface CalendarToolbarProps {
  view: CalendarView
  rangeText: string
  onToday: () => void
  onPrevious: () => void
  onNext: () => void
  onView: (view: CalendarView) => void
}

// The controls of the calendar in the header of the shell, on a computer (the .tb of the
// prototype): back to today, the two arrows, the range on screen, and the day and week switch.
// A change of the query alone does not move the focus (useRouteFocus), so the focus stays on the
// control that was pressed; the range is a live region, so a screen reader hears where it went.
export function CalendarToolbar({ view, rangeText, onToday, onPrevious, onNext, onView }: CalendarToolbarProps) {
  const p = en.calendar.page
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button variant="secondary" onPress={onToday}>
        {en.board.today}
      </Button>
      <div role="group" aria-label={p.dateNav} className="flex items-center">
        <IconButton aria-label={view === 'week' ? p.previousWeek : p.previousDay} onPress={onPrevious}>
          <ChevronLeft aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        </IconButton>
        <IconButton aria-label={view === 'week' ? p.nextWeek : p.nextDay} onPress={onNext}>
          <ChevronRight aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      <span aria-live="polite" className="min-w-0 truncate font-semibold tabular-nums">
        {rangeText}
      </span>
      <div className="ms-auto shrink-0">
        <SegmentedControl aria-label={en.calendar.view} options={VIEWS} value={view} onChange={onView} />
      </div>
    </div>
  )
}
