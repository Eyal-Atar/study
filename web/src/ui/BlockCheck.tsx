import { ToggleButton } from 'react-aria-components'
import { CheckMarkIcon } from './icons'
import { cx, FOCUS_RING } from './styles'

export interface BlockCheckProps {
  isDone: boolean
  // Called with the state that was asked for (!isDone). The box shows `isDone`, so the caller decides when it turns.
  onChange: (isDone: boolean) => void
  // The name carries the block, since the box repeats on the grid: "Done: Expectation practice".
  'aria-label': string
  isDisabled?: boolean | undefined
  // Written as data-check: the XP burst finds the box by it.
  dataId?: string | undefined
  className?: string | undefined
}

// The check of a block on the calendar grid (design language 5.8): a 16px square with 6px corners,
// drawn in the colour of the block's text, and filled with the brand and a check when done. The
// button around it is 44px wide and as tall as the block's row. A press on it must neither start
// a drag of the block nor open it, so pointer-down stops here.
export function BlockCheck({ isDone, onChange, 'aria-label': label, isDisabled, dataId, className }: BlockCheckProps) {
  return (
    <ToggleButton
      aria-label={label}
      isSelected={isDone}
      onChange={onChange}
      isDisabled={isDisabled ?? false}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      {...(dataId === undefined ? {} : { 'data-check': dataId })}
      className={cx(
        'flex min-w-touch cursor-pointer items-center justify-center self-stretch data-[disabled]:cursor-not-allowed',
        FOCUS_RING,
        className,
      )}
    >
      <span
        className={cx(
          'flex size-4 items-center justify-center rounded-[6px] border-2 transition-colors duration-(--duration-fast) motion-reduce:transition-none',
          isDone ? 'border-brand bg-brand' : 'border-current bg-surface',
        )}
      >
        {isDone ? <CheckMarkIcon size={12} className="text-on-brand" /> : null}
      </span>
    </ToggleButton>
  )
}
