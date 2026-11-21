import { CheckboxButton, CheckboxField, CheckboxGroup, FieldError, Label } from 'react-aria-components'
import { en } from '../i18n/en'
import { OPTION_CLASS } from './RadioCards'
import { FIELD_ERROR_CLASS, FIELD_LABEL_CLASS } from './TextField'

export interface WeekdayPickerProps {
  label: string
  // The chosen days as strings: '0' is Sunday … '6' is Saturday (the Weekday numbers).
  value: string[]
  onChange: (value: string[]) => void
  // Typed with `| undefined` like every field (see TextFieldProps), so a caller can pass a condition.
  errorMessage?: string | undefined
  isDisabled?: boolean | undefined
}

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const

// Seven days as boxes in one row: the box shows the short name (Sun) and a screen reader says the
// full one (Sunday). CheckboxCards has a text label only, so it cannot give a box a different
// accessible name. Each box is 44px high and at least 44px wide; seven of them fit a 360px screen
// because the gap is 2px there (the gap grows from sm up), and the box never shrinks instead.
export function WeekdayPicker({ label, value, onChange, errorMessage, isDisabled }: WeekdayPickerProps) {
  return (
    <CheckboxGroup
      value={value}
      onChange={onChange}
      isDisabled={isDisabled ?? false}
      isInvalid={errorMessage !== undefined}
      className="flex flex-col gap-2"
    >
      <Label className={FIELD_LABEL_CLASS}>{label}</Label>
      <div className="grid grid-cols-7 gap-0.5 sm:gap-1.5">
        {DAYS.map((day) => (
          <CheckboxField key={day} value={String(day)} aria-label={en.commitments.weekdayLong[day]} className="flex min-w-0">
            <CheckboxButton className={`${OPTION_CLASS} min-w-touch max-sm:px-0 max-sm:text-caption`}>
              <span aria-hidden="true">{en.commitments.weekdayShort[day]}</span>
            </CheckboxButton>
          </CheckboxField>
        ))}
      </div>
      <FieldError className={FIELD_ERROR_CLASS}>{errorMessage}</FieldError>
    </CheckboxGroup>
  )
}
