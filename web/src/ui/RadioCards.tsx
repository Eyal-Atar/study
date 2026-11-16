import { Label, RadioButton, RadioField, RadioGroup } from 'react-aria-components'

export interface ChoiceOption {
  value: string
  label: string
  description?: string
}

export interface RadioCardsProps {
  label: string
  options: readonly ChoiceOption[]
  value: string
  onChange: (value: string) => void
  // The grid of the options, e.g. 'grid-cols-4'.
  columns?: string
  isDisabled?: boolean
}

// The look of one option, shared with CheckboxCards: a 44px-high bordered box, filled when chosen.
export const OPTION_CLASS =
  'flex min-h-11 flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border border-line-strong bg-surface px-2 py-2 text-center text-sm text-ink outline-none transition-colors data-[hovered]:bg-surface-muted data-[selected]:border-brand data-[selected]:bg-brand-soft data-[selected]:font-medium data-[selected]:text-brand-strong data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[focus-visible]:ring-offset-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'

// A single choice from a few options, each a visible box (faster to tap on a phone than a select).
export function RadioCards({ label, options, value, onChange, columns = 'grid-cols-3', isDisabled }: RadioCardsProps) {
  return (
    <RadioGroup value={value} onChange={onChange} isDisabled={isDisabled} className="flex flex-col gap-2">
      <Label className="text-base font-medium text-ink">{label}</Label>
      <div className={`grid gap-2 ${columns}`}>
        {options.map((option) => (
          <RadioField key={option.value} value={option.value} className="flex">
            <RadioButton className={OPTION_CLASS}>
              <span>{option.label}</span>
              {option.description === undefined ? null : (
                <span className="text-xs text-ink-muted tabular-nums">{option.description}</span>
              )}
            </RadioButton>
          </RadioField>
        ))}
      </div>
    </RadioGroup>
  )
}
