import { useId } from 'react'
import { SwitchButton, SwitchField } from 'react-aria-components'
import { cx } from './styles'

export interface SwitchProps {
  // The name of the setting, always visible, at the start of the row.
  label: string
  // One quiet line under the label, linked to the switch (aria-describedby).
  description?: string | undefined
  isSelected: boolean
  onChange: (isSelected: boolean) => void
  isDisabled?: boolean | undefined
}

// The colours of the track and of the knob. They are chosen from React Aria's render state and
// not with data-[…] variants: Tailwind orders those by the name of the attribute, so "selected"
// could not reliably lose to "disabled" (the same reason as in CheckButton).
function trackColors(isSelected: boolean, isDisabled: boolean): string {
  // Disabled is muted and never transparent; a disabled switch that is on keeps a darker knob.
  if (isDisabled) return 'border-line bg-surface-muted'
  return isSelected ? 'border-brand bg-brand' : 'border-line-strong bg-surface'
}

function knobColors(isSelected: boolean, isDisabled: boolean): string {
  if (isDisabled) return isSelected ? 'bg-ink-muted' : 'bg-line-strong'
  return isSelected ? 'bg-on-brand' : 'bg-line-strong'
}

// A setting that is on or off and takes effect with the form it sits in ("זמן לעצמי כל יום").
// React Aria's SwitchField: role="switch", Space toggles, and the whole row (label and track) is the
// 44px target. The track is 44x24 with a 16px knob; off is an outlined track with a grey knob, on
// is a brand track with a white knob that moved to the end side, so the state is carried by the
// place of the knob and not by colour alone. No shadow: nothing here floats.
export function Switch({ label, description, isSelected, onChange, isDisabled }: SwitchProps) {
  const descriptionId = useId()
  return (
    <div className="flex flex-col">
      <SwitchField
        isSelected={isSelected}
        onChange={onChange}
        isDisabled={isDisabled ?? false}
        {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
        className="flex flex-col"
      >
        <SwitchButton className="flex min-h-touch cursor-pointer items-center justify-between gap-3 data-[disabled]:cursor-not-allowed">
          {({ isSelected: on, isDisabled: disabled, isFocusVisible }) => (
            <>
              <span className={cx('min-w-0 text-body font-medium break-words', disabled ? 'text-ink-muted' : 'text-ink')}>{label}</span>
              <span
                aria-hidden="true"
                className={cx(
                  'flex h-6 w-11 shrink-0 items-center rounded-full border px-[3px] transition-colors',
                  trackColors(on, disabled),
                  isFocusVisible && 'ring-2 ring-brand ring-offset-2',
                )}
              >
                {/* The knob moves toward the end side: left in RTL, right in LTR. */}
                <span
                  className={cx(
                    'size-4 rounded-full transition-transform',
                    knobColors(on, disabled),
                    on && 'ltr:translate-x-5 rtl:-translate-x-5',
                  )}
                />
              </span>
            </>
          )}
        </SwitchButton>
      </SwitchField>
      {description === undefined ? null : (
        <p id={descriptionId} className="text-small text-ink-muted">
          {description}
        </p>
      )}
    </div>
  )
}
