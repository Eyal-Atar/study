import { Check } from 'lucide-react'
import { ToggleButton } from 'react-aria-components'
import { cx, FOCUS_RING, ICON_STROKE } from './styles'

export interface CheckButtonProps {
  isDone: boolean
  // Called with the state that was asked for (!isDone). The button is controlled: it shows
  // `isDone`, so the caller decides when the row turns (at once, or after the save).
  onChange: (isDone: boolean) => void
  // The name carries the item, since the button repeats in a list: "בוצע: תרגול תוחלת".
  'aria-label': string
  isDisabled?: boolean | undefined
}

// The colours of the 22px box. They are chosen here from React Aria's render state and not
// with data-[…] variants: Tailwind orders those by the name of the attribute and not by the order
// of the classes, so "selected" could not reliably win over "hovered" or lose to "disabled".
function circleColors(isDone: boolean, isHovered: boolean, isDisabled: boolean): string {
  // Disabled is muted and never transparent, like a disabled Button.
  if (isDisabled) return isDone ? 'border-line-strong bg-line-strong text-on-brand' : 'border-line bg-surface-muted'
  if (isDone) return 'border-brand bg-brand text-on-brand'
  return cx('border-line-strong', isHovered ? 'bg-surface-muted' : 'bg-surface')
}

// The check button of a task or a block (design language 5.2): marks it done, and unmarks it. It
// goes in the `trailing` of a ListRow. The drawing is the .chk of the prototype, a 22px square with
// 7px corners and a 2px border, filled with a check when done; the button around it is the 44px
// touch target, with the corners of a control, and the focus ring goes around that. It is a toggle button (aria-pressed)
// and not a checkbox: pressing it acts at once, it is not a field of a form.
export function CheckButton({ isDone, onChange, 'aria-label': label, isDisabled }: CheckButtonProps) {
  return (
    <ToggleButton
      aria-label={label}
      isSelected={isDone}
      onChange={onChange}
      isDisabled={isDisabled ?? false}
      className={cx(
        'inline-flex size-touch shrink-0 cursor-pointer items-center justify-center rounded-control data-[disabled]:cursor-not-allowed',
        FOCUS_RING,
      )}
    >
      {({ isHovered, isDisabled: disabled }) => (
        <span
          className={cx(
            'flex size-5.5 items-center justify-center rounded-[7px] border-2 transition-colors duration-(--duration-fast)',
            circleColors(isDone, isHovered, disabled),
          )}
        >
          {isDone ? <Check aria-hidden="true" size={14} strokeWidth={ICON_STROKE} /> : null}
        </span>
      )}
    </ToggleButton>
  )
}
