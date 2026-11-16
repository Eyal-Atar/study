import { CheckboxButton, CheckboxField, CheckboxGroup, Label, Text } from 'react-aria-components'
import { OPTION_CLASS, type ChoiceOption } from './RadioCards'

export interface CheckboxCardsProps {
  label: string
  description?: string
  options: readonly ChoiceOption[]
  value: string[]
  onChange: (value: string[]) => void
  columns?: string
  isDisabled?: boolean
  // The id of an error shown elsewhere (e.g. a role=alert message), linked to the group.
  errorId?: string
}

// Any number of options, each a visible box.
export function CheckboxCards({
  label,
  description,
  options,
  value,
  onChange,
  columns = 'grid-cols-2',
  isDisabled,
  errorId,
}: CheckboxCardsProps) {
  return (
    <CheckboxGroup
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      isInvalid={errorId !== undefined}
      aria-describedby={errorId}
      className="flex flex-col gap-2"
    >
      <Label className="text-base font-medium text-ink">{label}</Label>
      {description === undefined ? null : (
        <Text slot="description" className="text-sm text-ink-muted">
          {description}
        </Text>
      )}
      <div className={`grid gap-2 ${columns}`}>
        {options.map((option) => (
          <CheckboxField key={option.value} value={option.value} className="flex">
            <CheckboxButton className={OPTION_CLASS}>
              <span>{option.label}</span>
              {option.description === undefined ? null : (
                <span className="text-xs text-ink-muted tabular-nums">{option.description}</span>
              )}
            </CheckboxButton>
          </CheckboxField>
        ))}
      </div>
    </CheckboxGroup>
  )
}
