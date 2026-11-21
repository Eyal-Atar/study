import { Check, type LucideIcon } from 'lucide-react'
import { CheckboxButton, CheckboxField, CheckboxGroup, FieldError, Label, Text } from 'react-aria-components'
import { cx, FOCUS_RING, ICON_STROKE } from './styles'
import { FIELD_DESCRIPTION_CLASS, FIELD_ERROR_CLASS, FIELD_LABEL_CLASS } from './TextField'

export interface IconChoiceOption {
  value: string
  label: string
  // A range or a short detail under the label, read left to right ("06:00–12:00").
  description?: string | undefined
  icon: LucideIcon
}

export interface IconChoiceCardsProps {
  label: string
  description?: string | undefined
  options: readonly IconChoiceOption[]
  value: string[]
  onChange: (value: string[]) => void
  // Shown under the options and linked to the group; the group is invalid while it is set.
  errorMessage?: string | undefined
  // For an error shown elsewhere: its id, linked to the group, which is invalid while it is set.
  errorId?: string | undefined
}

// One tile: the 2×2 windows of the mockup's onboarding step 3. Aligned to the start, the icon
// above the label and the range. Chosen: a 2px brand border on brand-soft and a ✓ in the corner,
// so the choice is not in colour alone; the padding drops by the extra pixel so nothing moves.
const TILE = cx(
  'relative flex min-h-touch w-full cursor-pointer flex-col items-start gap-1 rounded-control border border-line bg-field p-3 text-start text-ink transition-colors duration-(--duration-fast)',
  FOCUS_RING,
  'data-[hovered]:bg-surface-muted',
  'data-[selected]:border-2 data-[selected]:border-brand data-[selected]:bg-brand-soft data-[selected]:p-[11px]',
  'data-[disabled]:cursor-not-allowed data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted',
)

// Any number of options with an icon each, in two columns (CheckboxCards for options that are
// told apart by a picture and a range: the times of day to study).
export function IconChoiceCards({ label, description, options, value, onChange, errorMessage, errorId }: IconChoiceCardsProps) {
  return (
    <CheckboxGroup
      value={value}
      onChange={onChange}
      isInvalid={errorMessage !== undefined || errorId !== undefined}
      {...(errorId === undefined ? {} : { 'aria-describedby': errorId })}
      className="flex flex-col gap-2"
    >
      <Label className={FIELD_LABEL_CLASS}>{label}</Label>
      {description === undefined ? null : (
        <Text slot="description" className={FIELD_DESCRIPTION_CLASS}>
          {description}
        </Text>
      )}
      <div className="grid grid-cols-2 gap-2">
        {options.map(({ value: optionValue, label: optionLabel, description: detail, icon: Icon }) => (
          <CheckboxField key={optionValue} value={optionValue} className="flex">
            <CheckboxButton className={TILE}>
              {({ isSelected }) => (
                <>
                  <Icon aria-hidden="true" size={22} strokeWidth={ICON_STROKE} className="text-ink" />
                  <span className="text-small font-semibold">{optionLabel}</span>
                  {detail === undefined ? null : (
                    <span dir="ltr" className="text-caption text-ink-muted tabular-nums">
                      {detail}
                    </span>
                  )}
                  {isSelected ? (
                    <span
                      data-check=""
                      aria-hidden="true"
                      className="absolute end-2 top-2 inline-flex size-5 items-center justify-center rounded-full bg-brand text-on-brand"
                    >
                      <Check size={14} strokeWidth={ICON_STROKE} />
                    </span>
                  ) : null}
                </>
              )}
            </CheckboxButton>
          </CheckboxField>
        ))}
      </div>
      {errorMessage === undefined ? null : <FieldError className={FIELD_ERROR_CLASS}>{errorMessage}</FieldError>}
    </CheckboxGroup>
  )
}
