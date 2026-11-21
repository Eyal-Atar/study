import type { BusyItem } from '../availability/types'
import { formatRange } from '../board/time'
import { en } from '../i18n/en'
import { CalendarClock, ClassIcon, WorkIcon } from '../ui/icons'
import { cx, FOCUS_RING_NATIVE } from '../ui/styles'
import { UserText } from '../ui/UserText'

function BusyIcon({ kind }: { kind: BusyItem['kind'] }) {
  const look = { size: 14, 'aria-hidden': true, className: 'shrink-0 text-busy' } as const
  if (kind === 'work') return <WorkIcon {...look} />
  if (kind === 'class') return <ClassIcon {...look} />
  return <CalendarClock {...look} />
}

export interface BusyBlockProps {
  item: BusyItem
  tz: string
  top: number
  height: number
  onOpen: (item: BusyItem) => void
}

// Busy time on the grid (design language 2.9, decision 15): a commitment or an event. It is not a
// task: it lies under the study blocks, hatched, with no exam colour and no check.
export function BusyBlock({ item, tz, top, height, onOpen }: BusyBlockProps) {
  const range = formatRange(item, tz)
  const compact = height < 25
  return (
    <button
      type="button"
      aria-label={en.calendar.grid.busyLabel(item.title ?? en.calendar.grid.busyUntitled, range)}
      data-busy-id={item.id}
      onClick={() => {
        onOpen(item)
      }}
      style={{ top, height }}
      className={cx(
        // A button centres what it holds: the column puts the title back at the top.
        'absolute inset-x-[3px] z-0 flex cursor-pointer flex-col items-stretch overflow-hidden rounded-[10px] border border-s-4 border-busy-line border-s-busy ps-[7px] pe-[6px] text-start',
        'bg-[repeating-linear-gradient(135deg,var(--color-busy-soft)_0_7px,var(--color-surface-muted)_7px_14px)]',
        'text-[12px] leading-[15px] group-data-[view=day]/cal:text-[13.5px] group-data-[view=day]/cal:leading-[17px]',
        compact ? 'justify-center py-0' : 'justify-start py-1',
        FOCUS_RING_NATIVE,
      )}
    >
      <span className="flex items-start gap-[5px]">
        <BusyIcon kind={item.kind} />
        {item.title === null ? (
          <span className="min-w-0 flex-1 truncate font-medium text-ink">{en.calendar.grid.busyUntitled}</span>
        ) : (
          <UserText truncate className="flex-1 font-medium text-ink">
            {item.title}
          </UserText>
        )}
      </span>
      {height >= 38 ? (
        <span className="mt-0.5 block truncate ps-[19px] text-[11px] leading-[14px] text-ink-muted tabular-nums group-data-[view=day]/cal:text-[12px] group-data-[view=day]/cal:leading-[15px]">
          {range}
        </span>
      ) : null}
    </button>
  )
}
