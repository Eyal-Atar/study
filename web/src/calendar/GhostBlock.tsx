import { examColor } from '../ui/examColor'
import { KIND_ICON } from '../ui/icons'
import { cx } from '../ui/styles'
import { UserText } from '../ui/UserText'
import type { Ghost } from './ghost'

export interface GhostBlockProps {
  ghost: Ghost
  top: number
  height: number
}

// The preview of a change before it is approved (audit guideline 10, decision 9): where a block
// would land, or where it cannot. A dashed outline on the plain surface, with no transparency, so
// what it says stays readable over whatever lies under it. It is a picture and not a control:
// whoever shows a ghost says the same in a live region or in the sheet's text.
// A ghost of tone "leaving" is never drawn here: TimeGrid marks the block itself.
export function GhostBlock({ ghost, top, height }: GhostBlockProps) {
  const problem = ghost.tone === 'problem'
  const color = ghost.colorIndex === null ? null : examColor(ghost.colorIndex)
  const border = problem ? 'border-danger' : color === null ? 'border-busy' : color.borderStrong
  const tint = problem ? 'text-danger' : color === null ? 'text-busy' : color.text
  const KindIcon = ghost.kind === undefined ? null : KIND_ICON[ghost.kind]
  const tall = height >= 38
  const label =
    ghost.label === undefined ? null : (
      <span className={cx('tabular-nums', problem ? 'font-medium text-danger' : 'text-ink', tall ? (height >= 56 ? 'block' : 'block truncate') : 'shrink-0', tall && KindIcon !== null && 'ps-[19px]')}>
        {ghost.label}
      </span>
    )
  return (
    <div
      aria-hidden="true"
      data-ghost={ghost.id}
      data-tone={ghost.tone}
      style={{ top, height }}
      className={cx(
        // The padding makes up for the thicker border, so the text sits where a block's text does.
        '@container pointer-events-none absolute inset-x-[3px] overflow-hidden rounded-[10px] border-2 border-dashed bg-surface ps-[9px] pe-[6px] text-ink',
        'text-[12px] leading-[15px] group-data-[view=day]/cal:text-[13.5px] group-data-[view=day]/cal:leading-[17px]',
        // A front ghost has the z-index of a leaving block (z-30, CalendarBlock) and, being drawn after the
        // blocks in TimeGrid, lands above it; it ties with the sticky header and the tasks bar as that block does.
        ghost.front === true ? 'z-30' : 'z-20',
        height < 25 ? 'flex flex-col justify-center py-0' : 'py-[3px]',
        border,
      )}
    >
      <div className="flex items-start gap-[5px]">
        {KindIcon === null ? null : <KindIcon size={14} aria-hidden className={cx('shrink-0', tint)} />}
        {/* A low ghost has one line. In a narrow column the label, which says where the block would
            land, takes it, and the title shows only where there is room for both. */}
        <span className={cx('min-w-0 flex-1', !tall && label !== null && 'hidden @[170px]:block')}>
          <UserText truncate className="font-semibold">
            {ghost.title}
          </UserText>
        </span>
        {tall ? null : label}
      </div>
      {tall ? label : null}
    </div>
  )
}
