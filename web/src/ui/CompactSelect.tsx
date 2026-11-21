import { Check, ChevronDown } from './icons'
import { Button, ListBox, ListBoxItem, Popover, Select as AriaSelect, SelectValue } from 'react-aria-components'
import type { SelectOption } from './Select'
import { UserText } from './UserText'
import { cx, FOCUS_RING, ICON_STROKE } from './styles'

export interface CompactSelectProps {
  // There is no visible label: the row the select sits in says what it is, and this names it for
  // a screen reader, with the item ("File type syllabus.pdf").
  'aria-label': string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  isDisabled?: boolean | undefined
}

// A button as wide as its value, with the look of a secondary Button: its value and its chevron say
// what it is, so it has the quiet line of that button. Disabled is muted and never transparent.
const TRIGGER = cx(
  'inline-flex min-h-touch max-w-full cursor-pointer items-center gap-2 rounded-control border border-line bg-field px-3 text-small font-medium text-ink',
  'transition-colors duration-(--duration-fast) data-[hovered]:bg-surface-muted data-[pressed]:bg-surface-muted',
  'data-[disabled]:cursor-not-allowed data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted',
  FOCUS_RING,
)

// The same option as in Select: the chosen one is marked by weight, fill and a check.
const OPTION =
  'flex min-h-touch cursor-pointer items-center justify-between gap-2 rounded-control px-3 text-body text-ink outline-none data-[focused]:bg-surface-muted data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[focus-visible]:ring-inset data-[selected]:bg-brand-soft data-[selected]:font-semibold data-[selected]:text-brand-strong'

function keyOf(index: number): string {
  return `option-${String(index)}`
}

// One choice from a short list, inside a row of a list (the kind of a file). Select is a field of
// a form, with a visible label above it and the full width; in a list of fifteen files fifteen
// labels are noise, so this one has only an accessible name and is as wide as its value.
// (S29: fold this into Select as an option of an aria-label instead of a label.)
export function CompactSelect({ 'aria-label': label, value, options, onChange, isDisabled }: CompactSelectProps) {
  const chosen = options.findIndex((option) => option.value === value)
  const chosenOption = options[chosen]
  return (
    <AriaSelect
      aria-label={label}
      value={chosen === -1 ? null : keyOf(chosen)}
      onChange={(key) => {
        const option = options.find((_, index) => keyOf(index) === key)
        if (option !== undefined) onChange(option.value)
      }}
      isDisabled={isDisabled ?? false}
      className="inline-flex max-w-full"
    >
      <Button className={TRIGGER}>
        <SelectValue className={cx('min-w-0', chosenOption?.userContent !== true && 'truncate')}>
          {({ isPlaceholder, defaultChildren }) =>
            !isPlaceholder && chosenOption?.userContent === true ? <UserText truncate>{chosenOption.label}</UserText> : defaultChildren
          }
        </SelectValue>
        <ChevronDown aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="shrink-0 text-ink-muted" />
      </Button>
      <Popover
        offset={4}
        className="min-w-(--trigger-width) rounded-card border border-line bg-surface p-1 shadow-overlay transition-opacity duration-(--duration-slow) data-[entering]:opacity-0 data-[exiting]:opacity-0"
      >
        <ListBox className="max-h-72 overflow-auto outline-none">
          {options.map((option, index) => (
            <ListBoxItem key={keyOf(index)} id={keyOf(index)} textValue={option.label} className={OPTION}>
              {({ isSelected }) => (
                <>
                  <span className="min-w-0 break-words">
                    {option.userContent === true ? <UserText>{option.label}</UserText> : option.label}
                  </span>
                  {isSelected ? <Check aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="shrink-0" /> : null}
                </>
              )}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  )
}
