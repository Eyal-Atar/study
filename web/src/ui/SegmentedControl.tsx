import { ToggleButton, ToggleButtonGroup, type Key } from 'react-aria-components'
import { cx, FOCUS_RING } from './styles'

export interface SegmentedControlProps<T extends string> {
  // The name of the group says what is being switched: "תצוגת היום".
  'aria-label': string
  options: readonly { id: T; label: string }[]
  value: T
  // Called with the id of the option that was asked for. The control is controlled: it shows
  // `value`, so a press on the chosen option calls nothing.
  onChange: (value: T) => void
}

// The colours of one option. They are chosen here from React Aria's render state and not with
// data-[…] variants: Tailwind orders those by the name of the attribute and not by the order of
// the classes, so "selected" could not reliably win over "hovered" (design language 5.8).
// The border is always there, transparent while not chosen, so choosing does not move the label.
function optionColors(isSelected: boolean, isHovered: boolean): string {
  // The chosen option is a piece of surface on the track, set apart by a line and not by a shadow.
  if (isSelected) return 'border-line-strong bg-surface text-ink'
  return cx('border-transparent', isHovered ? 'text-ink' : 'text-ink-muted')
}

// A switch between two or three views of the same content ("רשימה" / "ציר"). Each option acts at
// once and changes what is shown below it; a choice that is a value of a form is RadioCards.
// React Aria's ToggleButtonGroup with a single selection renders a radiogroup of radios: one Tab
// stop, the arrows move between the options, and Space or Enter chooses. It never becomes empty,
// since one of the views is always the one on screen.
export function SegmentedControl<T extends string>({
  'aria-label': label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  function choose(keys: Set<Key>) {
    // The ids of the options are the keys, so the key that comes back is one of them.
    const next = options.find((option) => keys.has(option.id))
    if (next !== undefined && next.id !== value) onChange(next.id)
  }

  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={choose}
      className="inline-flex max-w-full gap-1 rounded-control bg-surface-muted p-1"
    >
      {options.map((option) => (
        <ToggleButton
          key={option.id}
          id={option.id}
          className={({ isSelected, isHovered }) =>
            cx(
              'inline-flex min-h-touch min-w-0 flex-1 cursor-pointer items-center justify-center rounded-control border px-4 text-small font-semibold transition-colors duration-(--duration-fast)',
              FOCUS_RING,
              optionColors(isSelected, isHovered),
            )
          }
        >
          <span className="truncate">{option.label}</span>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
