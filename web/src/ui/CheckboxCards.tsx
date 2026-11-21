import { CheckboxButton, CheckboxField, CheckboxGroup, FieldError, Label, Text } from 'react-aria-components'
import { OPTION_CLASS, type ChoiceOption } from './RadioCards'
import { FIELD_DESCRIPTION_CLASS, FIELD_ERROR_CLASS, FIELD_LABEL_CLASS } from './TextField'

export interface CheckboxCardsProps {
  label: string
  // Typed with `| undefined` like every field (see TextFieldProps), so a caller can pass a condition.
  description?: string | undefined
  options: readonly ChoiceOption[]
  value: string[]
  onChange: (value: string[]) => void
  columns?: string | undefined
  isDisabled?: boolean | undefined
  // Shown under the options and linked to the group; the group is invalid while it is set.
  errorMessage?: string | undefined
  // For an error shown elsewhere (e.g. a role=alert message that the screen renders): its id,
  // linked to the group, which is invalid while it is set. With errorMessage too, both are linked.
  errorId?: string | undefined
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
  errorMessage,
  errorId,
}: CheckboxCardsProps) {
  return (
    <CheckboxGroup
      value={value}
      onChange={onChange}
      isDisabled={isDisabled ?? false}
      isInvalid={errorMessage !== undefined || errorId !== undefined}
      // React Aria adds the ids of its own description and error to this one.
      {...(errorId === undefined ? {} : { 'aria-describedby': errorId })}
      className="flex flex-col gap-2"
    >
      <Label className={FIELD_LABEL_CLASS}>{label}</Label>
      {description === undefined ? null : (
        <Text slot="description" className={FIELD_DESCRIPTION_CLASS}>
          {description}
        </Text>
      )}
      <div className={`grid gap-2 ${columns}`}>
        {options.map((option) => (
          <CheckboxField key={option.value} value={option.value} className="flex">
            <CheckboxButton className={OPTION_CLASS}>
              {option.icon === undefined ? null : <span className="mb-0.5 flex">{option.icon}</span>}
              <span>{option.label}</span>
              {option.description === undefined ? null : (
                <span className="text-caption font-normal text-ink-muted tabular-nums">{option.description}</span>
              )}
            </CheckboxButton>
          </CheckboxField>
        ))}
      </div>
      {/* Rendered only when there is a message: with errorId alone the error is drawn elsewhere. */}
      {errorMessage === undefined ? null : <FieldError className={FIELD_ERROR_CLASS}>{errorMessage}</FieldError>}
    </CheckboxGroup>
  )
}
