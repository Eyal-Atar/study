import { Check, ChevronDown } from './icons'
import {
  Button,
  FieldError,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
  Text,
} from 'react-aria-components'
import { en } from '../i18n/en'
import { ICON_STROKE } from './styles'
import { UserText } from './UserText'
import { FIELD_BOX_CLASS, FIELD_CLASS, FIELD_DESCRIPTION_CLASS, FIELD_ERROR_CLASS, FIELD_LABEL_CLASS } from './TextField'

export interface SelectOption {
  value: string
  label: string
  // The label is the user's own text (a topic name): it is shown through UserText, so it takes
  // its own direction. The textValue (type-ahead, screen reader) stays the plain string.
  userContent?: boolean
}

export interface SelectProps {
  label: string
  // The value of the chosen option. A value that no option has shows the placeholder.
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  // Typed with `| undefined` like every field (see TextFieldProps), so a caller can pass a condition.
  description?: string | undefined
  // Shown under the field and linked to it; the field is invalid while it is set.
  errorMessage?: string | undefined
  isDisabled?: boolean | undefined
  // Shown in the trigger while nothing is chosen.
  placeholder?: string | undefined
}

// The trigger is the box of a TextField. It is a button, so its focus shows only for the keyboard.
// React Aria marks the whole field as invalid (data-invalid on the root) and not the button, so the
// danger border hangs on the group (the data-[invalid] of FIELD_BOX_CLASS never matches the button).
// Invalid and focused together keeps the danger border under the brand ring, as in a TextField:
// group-data-[invalid] and data-[focus-visible] are equally specific and the second is emitted
// later, so alone it would turn the border brand; the stacked variant is more specific and wins.
const TRIGGER_CLASS = `${FIELD_BOX_CLASS} flex cursor-pointer items-center justify-between gap-2 px-3 text-start group-data-[invalid]:border-danger data-[focus-visible]:border-brand data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand group-data-[invalid]:data-[focus-visible]:border-danger data-[disabled]:cursor-not-allowed`

// React Aria keeps the focus of the list on one option (keyboard or pointer) and marks it
// data-focused; the chosen option is marked by weight, fill and a check, not by colour alone.
// The muted fill of the focused option is faint, and on the chosen option it does not show at all
// (data-[selected] is emitted after data-[focused], so its fill wins). Keyboard focus therefore
// also draws the brand ring, inside the option so the scrolling list does not clip it.
const OPTION_CLASS =
  'flex min-h-touch cursor-pointer items-center justify-between gap-2 rounded-control px-3 text-body text-ink outline-none data-[focused]:bg-surface-muted data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[focus-visible]:ring-inset data-[selected]:bg-brand-soft data-[selected]:font-semibold data-[selected]:text-brand-strong'

// React Aria identifies an option by a key. The key is the option's place in the list and not its
// value, because a value may be the empty string ("no topic"), which is not a usable key.
function keyOf(index: number): string {
  return `option-${String(index)}`
}

// One choice from a list that is too long for RadioCards (task kinds, topics). React Aria's Select
// and not the browser's: the same look, focus and direction as the other fields, and a list a test can open.
export function Select({
  label,
  value,
  options,
  onChange,
  description,
  errorMessage,
  isDisabled,
  placeholder = en.common.choose,
}: SelectProps) {
  const chosen = options.findIndex((option) => option.value === value)
  return (
    <AriaSelect
      value={chosen === -1 ? null : keyOf(chosen)}
      onChange={(key) => {
        const option = options.find((_, index) => keyOf(index) === key)
        if (option !== undefined) onChange(option.value)
      }}
      placeholder={placeholder}
      isDisabled={isDisabled ?? false}
      isInvalid={errorMessage !== undefined}
      className={`group ${FIELD_CLASS}`}
    >
      <Label className={FIELD_LABEL_CLASS}>{label}</Label>
      <Button className={TRIGGER_CLASS}>
        <SelectValue className="min-w-0 flex-1 truncate data-[placeholder]:text-ink-muted" />
        <ChevronDown aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="shrink-0 text-ink-muted" />
      </Button>
      {description === undefined ? null : (
        <Text slot="description" className={FIELD_DESCRIPTION_CLASS}>
          {description}
        </Text>
      )}
      <FieldError className={FIELD_ERROR_CLASS}>{errorMessage}</FieldError>
      {/* It floats, so it has the shadow, and it is as wide as its trigger. */}
      <Popover
        offset={4}
        className="w-(--trigger-width) rounded-card border border-line bg-surface p-1 shadow-overlay transition-opacity duration-(--duration-slow) data-[entering]:opacity-0 data-[exiting]:opacity-0"
      >
        <ListBox className="max-h-72 overflow-auto outline-none">
          {options.map((option, index) => (
            <ListBoxItem key={keyOf(index)} id={keyOf(index)} textValue={option.label} className={OPTION_CLASS}>
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
