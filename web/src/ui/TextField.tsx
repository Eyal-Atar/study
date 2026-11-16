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
  description?: string
  placeholder?: string
  // Shown under the field and linked to it (aria-describedby); the field is invalid while it is set.
  errorMessage?: string
}

// A labelled one-line text field, with its error next to it.
export function TextField({ label, description, placeholder, errorMessage, ...props }: TextFieldProps) {
  return (
    <AriaTextField {...props} isInvalid={errorMessage !== undefined} className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium text-ink">{label}</Label>
      <Input
        placeholder={placeholder}
        className="min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-base text-ink outline-none placeholder:text-ink-muted data-[focused]:border-brand data-[focused]:ring-2 data-[focused]:ring-brand data-[invalid]:border-danger"
      />
      {description === undefined ? null : (
        <Text slot="description" className="text-sm text-ink-muted">
          {description}
        </Text>
      )}
      <FieldError className="text-sm text-danger">{errorMessage}</FieldError>
    </AriaTextField>
  )
}
