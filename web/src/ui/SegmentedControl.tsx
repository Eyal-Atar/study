import { ToggleButton, ToggleButtonGroup, type Key } from 'react-aria-components'
import { cx, FOCUS_RING } from './styles'

export interface SegmentedControlProps<T extends string> {
  // The name of the group says what is being switched: "Day view".
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
  // The .seg of the prototype: the chosen option is a raised piece of surface on the track, in ink.
  // The shadow alone is too faint to carry the choice (WCAG 1.4.11), so it also has the line-strong
  // border, which is 3:1 on the track.
  if (isSelected) return 'border-line-strong bg-surface text-ink shadow-raised'
  return cx('border-transparent', isHovered ? 'text-ink' : 'text-ink-muted')
}

// A switch between two or three views of the same content ("List" / "Timeline"). Each option acts at
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
      // A grid of equal columns as wide as the longest label: with flex-1 the options split the sum of
      // their widths evenly, and the longer label was cut.
      // The track: surface-muted with the corners of a control and 3px of padding, as in the prototype.
      className="inline-grid max-w-full auto-cols-fr grid-flow-col gap-0.5 rounded-control bg-surface-muted p-0.75"
    >
      {options.map((option) => (
        <ToggleButton
          key={option.id}
          id={option.id}
          className={({ isSelected, isHovered }) =>
            cx(
              // 8px corners inside the 10px of the track (the prototype's own, written as they are),
              // and a medium label, like the tabs.
              'inline-flex min-h-touch min-w-0 cursor-pointer items-center justify-center rounded-[8px] border px-3 text-small font-medium transition-colors duration-(--duration-fast)',
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
