import { useId } from 'react'
import type { ArchieMood } from '../archie/Archie'
import { Button } from '../ui/Button'
import { ChevronRight } from '../ui/icons'
import { ICON_STROKE } from '../ui/styles'
import { ArchiSays } from './ArchiSays'
import type { Ghost } from './ghost'

// One row of the calendar's banner (CalendarBanner): Archi, his sentence and a quiet button that
// opens the row's panel in place. Every row of the banner is built from it, so they look and
// behave alike. A row that opens a sheet instead (the closure of S45) says so with `opensDialog`:
// its button has aria-haspopup="dialog", nothing expands, and it has no panel.

// The names of the banner's rows. Their order is CalendarBanner's (BANNER_ROWS, which must list
// every one); the type is here so that this file imports nothing from the banner.
export type BannerRow = 'closure' | 'review' | 'report' | 'split'

// What the banner gives every row.
export interface RowProps {
  expanded: boolean
  onToggle: () => void
  onPreview: (ghosts: Ghost[]) => void
}

type RowShape =
  // Opens its panel in place, under the line.
  | { opensDialog?: false; expanded: boolean; panel: React.ReactNode }
  // Opens a sheet: no panel and nothing that expands.
  | { opensDialog: true; expanded?: never; panel?: never }

export function Row({
  ref,
  name,
  mood,
  onToggle,
  label,
  children,
  ...shape
}: {
  ref?: React.Ref<HTMLDivElement>
  name: BannerRow
  mood: ArchieMood
  onToggle: () => void
  label: string
  children: React.ReactNode
} & RowShape) {
  const panelId = useId()
  const expanded = shape.opensDialog === true ? false : shape.expanded
  const aria =
    shape.opensDialog === true
      ? { 'aria-haspopup': 'dialog' as const }
      : { 'aria-expanded': expanded, 'aria-controls': expanded ? panelId : undefined }
  return (
    <div ref={ref} data-banner-row={name} className="border-b border-sand px-3 pt-2">
      <ArchiSays mood={mood} size="sm">
        {children}
      </ArchiSays>
      <div className="flex justify-end pb-1">
        <Button variant="quiet" {...aria} onPress={onToggle}>
          {label}
          <ChevronRight aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className={expanded ? 'rotate-90' : undefined} />
        </Button>
      </div>
      {expanded && shape.opensDialog !== true ? (
        <div id={panelId} className="pb-3">
          {shape.panel}
        </div>
      ) : null}
    </div>
  )
}
