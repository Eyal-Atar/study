import { useId } from 'react'

export interface SelectOption {
  value: string
  label: string
}

// A labelled native select: the phone's own picker, 44px tall. Used where a list of options is too
// long for RadioCards (task kinds, topics).
export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
