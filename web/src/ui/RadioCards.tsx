import { FieldError, Label, RadioButton, RadioField, RadioGroup, Text } from 'react-aria-components'
import { FOCUS_RING } from './styles'
import { FIELD_DESCRIPTION_CLASS, FIELD_ERROR_CLASS, FIELD_LABEL_CLASS } from './TextField'

export interface ChoiceOption {
  value: string
  label: string
  description?: string | undefined
}

export interface RadioCardsProps {
  label: string
  // Shown under the label and linked to the group. Typed with `| undefined` like every field
  // (see TextFieldProps), so a caller can pass a condition.
  description?: string | undefined
  options: readonly ChoiceOption[]
  value: string
  onChange: (value: string) => void
  // The grid of the options, e.g. 'grid-cols-4'.
  columns?: string | undefined
  isDisabled?: boolean | undefined
  // Shown under the options and linked to the group; the group is invalid while it is set.
  errorMessage?: string | undefined
}

// The look of one option, shared with CheckboxCards: a 44px-high bordered box, filled when chosen.
// Chosen is said by the border, the fill and the weight together. A disabled option is muted and
// never transparent, so its text stays readable, and a chosen one keeps its weight and a stronger
// border (the stacked variant wins by specificity), so the choice still shows.
// (One string and not cx(): fast refresh allows a component file to export only constants.)
export const OPTION_CLASS = `flex min-h-touch flex-1 cursor-pointer flex-col items-center justify-center rounded-control border border-line-strong bg-surface px-2 py-2 text-center text-small text-ink transition-colors duration-(--duration-fast) ${FOCUS_RING} data-[hovered]:bg-surface-muted data-[selected]:border-brand data-[selected]:bg-brand-soft data-[selected]:font-semibold data-[selected]:text-brand-strong data-[disabled]:cursor-not-allowed data-[disabled]:border-line data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted data-[disabled]:data-[selected]:border-line-strong data-[disabled]:data-[selected]:bg-surface-muted data-[disabled]:data-[selected]:text-ink-muted`

// A single choice from a few options, each a visible box (faster to tap on a phone than a select).
export function RadioCards({
  label,
  description,
  options,
  value,
  onChange,
  columns = 'grid-cols-3',
  isDisabled,
  errorMessage,
}: RadioCardsProps) {
  return (
    <RadioGroup
      value={value}
      onChange={onChange}
      isDisabled={isDisabled ?? false}
      isInvalid={errorMessage !== undefined}
      className="flex flex-col gap-2"
    >
      {/* The label of the group is a field label (design language 5.4). */}
      <Label className={FIELD_LABEL_CLASS}>{label}</Label>
      {description === undefined ? null : (
        <Text slot="description" className={FIELD_DESCRIPTION_CLASS}>
          {description}
        </Text>
      )}
      <div className={`grid gap-2 ${columns}`}>
        {options.map((option) => (
          <RadioField key={option.value} value={option.value} className="flex">
            <RadioButton className={OPTION_CLASS}>
              <span>{option.label}</span>
              {option.description === undefined ? null : (
                <span className="text-caption font-normal text-ink-muted tabular-nums">{option.description}</span>
              )}
            </RadioButton>
          </RadioField>
        ))}
      </div>
      {/* React Aria renders it only while the group is invalid, and links it (aria-describedby). */}
      <FieldError className={FIELD_ERROR_CLASS}>{errorMessage}</FieldError>
    </RadioGroup>
  )
}
