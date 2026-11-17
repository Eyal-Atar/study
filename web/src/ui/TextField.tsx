import {
  FieldError,
  Input,
  Label,
  Text,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components'

export interface TextFieldProps extends Omit<AriaTextFieldProps, 'children' | 'className' | 'isInvalid'> {
  label: string
  // Every field takes these two the same way. They are typed with `| undefined` on purpose
  // (exactOptionalPropertyTypes), so a screen can write errorMessage={failed ? text : undefined}.
  description?: string | undefined
  placeholder?: string | undefined
  // Shown under the field and linked to it (aria-describedby); the field is invalid while it is set.
  errorMessage?: string | undefined
}

// The parts of a field (design language 5.4), shared with Select and DatePicker so the three look
// like one family. The label is always visible above the control: a placeholder is not a label.
export const FIELD_CLASS = 'flex flex-col gap-1.5'
export const FIELD_LABEL_CLASS = 'text-small font-semibold text-ink'
export const FIELD_DESCRIPTION_CLASS = 'text-small text-ink-muted'
export const FIELD_ERROR_CLASS = 'text-small text-danger'

// The box of a control, without its focus: 44px high, a line-strong border (3:1 on every
// background), and text-body (16px) so iOS does not zoom the page on focus. A disabled box is muted
// and never transparent, so its value stays readable (ink-muted on surface-muted is a checked pair).
export const FIELD_BOX_CLASS =
  'min-h-touch w-full rounded-control border border-line-strong bg-surface text-body text-ink outline-none transition-colors duration-(--duration-fast) data-[invalid]:border-danger data-[disabled]:border-line data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted'

// A box whose focus is inside it (the segments of a date or of a time): the box shows it.
export const FIELD_FOCUS_WITHIN_CLASS =
  'data-[focus-within]:border-brand data-[focus-within]:ring-2 data-[focus-within]:ring-brand'

// One typed segment of a date or of a time (DatePicker, TimeField). The focused segment is filled
// with brand. Tailwind emits data-[...] variants in the alphabetical order of the attribute, so
// data-[placeholder] comes after data-[focused] and its muted text would win on the brand fill
// (unreadable): the stacked variant is more specific, and keeps a focused placeholder on-brand.
// A literal (the "." or ":" between segments) is never focused, so it needs no such rule.
export const FIELD_SEGMENT_CLASS =
  'rounded-badge px-0.5 tabular-nums outline-none data-[placeholder]:text-ink-muted data-[type=literal]:text-ink-muted data-[focused]:bg-brand data-[focused]:text-on-brand data-[focused]:data-[placeholder]:text-on-brand'

// A text input shows its focus for the pointer too (data-focused), because the caret is in it. The
// ring has no offset: the border itself turns brand and the ring thickens it.
// Focused and invalid together: the border stays danger and the ring is brand. Tailwind emits the
// data-[...] variants alphabetically, so data-[invalid] (in FIELD_BOX_CLASS) comes after
// data-[focused] and wins the border. Select and the segment fields are made to match.
const INPUT_CLASS = `${FIELD_BOX_CLASS} px-3 placeholder:text-ink-muted data-[focused]:border-brand data-[focused]:ring-2 data-[focused]:ring-brand`

// A labelled one-line text field, with its error next to it.
export function TextField({ label, description, placeholder, errorMessage, ...props }: TextFieldProps) {
  return (
    <AriaTextField {...props} isInvalid={errorMessage !== undefined} className={FIELD_CLASS}>
      <Label className={FIELD_LABEL_CLASS}>{label}</Label>
      <Input placeholder={placeholder} className={INPUT_CLASS} />
      {description === undefined ? null : (
        <Text slot="description" className={FIELD_DESCRIPTION_CLASS}>
          {description}
        </Text>
      )}
      <FieldError className={FIELD_ERROR_CLASS}>{errorMessage}</FieldError>
    </AriaTextField>
  )
}
