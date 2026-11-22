import { useId } from 'react'
import type { ArchieMood } from '../archie/Archie'
import { Button } from '../ui/Button'
import { ChevronRight } from '../ui/icons'
import { ICON_STROKE } from '../ui/styles'
import { ArchiSays } from './ArchiSays'
// A type alone: the rows are listed in CalendarBanner (BANNER_ROWS), and nothing of it runs here.
import type { BannerRow } from './CalendarBanner'
import type { Ghost } from './ghost'

// One row of the calendar's banner (CalendarBanner): Archi, his sentence and a quiet button that
// opens the row's panel in place. Every row of the banner is built from it, so they look and
// behave alike.

// What the banner gives every row.
export interface RowProps {
  expanded: boolean
  onToggle: () => void
  onPreview: (ghosts: Ghost[]) => void
}

export function Row({
  ref,
  name,
  mood,
  expanded,
  onToggle,
  label,
  children,
  panel,
}: {
  ref?: React.Ref<HTMLDivElement>
  name: BannerRow
  mood: ArchieMood
  expanded: boolean
  onToggle: () => void
  label: string
  children: React.ReactNode
  panel: React.ReactNode
}) {
  const panelId = useId()
  return (
    <div ref={ref} data-banner-row={name} className="border-b border-sand px-3 pt-2">
      <ArchiSays mood={mood} size="sm">
        {children}
      </ArchiSays>
      <div className="flex justify-end pb-1">
        <Button variant="quiet" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} onPress={onToggle}>
          {label}
          <ChevronRight aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className={expanded ? 'rotate-90' : undefined} />
        </Button>
      </div>
      {expanded ? (
        <div id={panelId} className="pb-3">
          {panel}
        </div>
      ) : null}
    </div>
  )
}
