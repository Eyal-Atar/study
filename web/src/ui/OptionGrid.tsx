import { Check } from './icons'
import { ListBox, ListBoxItem, type Selection } from 'react-aria-components'
import { cx, FOCUS_RING, ICON_STROKE } from './styles'

export interface OptionGridProps {
  // The name of the list says what is being chosen: "A free time".
  'aria-label': string
  options: readonly { id: string; label: string }[]
  // null while nothing is chosen.
  value: string | null
  // Called with the id that was asked for, or with null when the chosen option is pressed again.
  // The grid is controlled: it shows `value`.
  onChange: (value: string | null) => void
  // Puts each label inside dir="ltr": a time or a range of times, which keeps its order even
  // when it sits next to right-to-left user content.
  ltr?: boolean | undefined
  // 4: four columns at every width, for exactly four short options that belong on one row (the
  // free-time amounts). By default three columns, four from sm.
  columns?: 3 | 4 | undefined
}

// The colours of one option. They are chosen here from React Aria's render state and not with
// data-[…] variants: Tailwind orders those by the name of the attribute and not by the order of
// the classes, so "selected" could not reliably win over "hovered" (design language 5.8).
function optionColors(isSelected: boolean, isHovered: boolean): string {
  if (isSelected) return 'border-brand bg-brand text-on-brand'
  return cx('border-line text-ink', isHovered ? 'bg-surface-muted' : 'bg-field')
}

// One choice out of many short options of the same kind (the free times of a day), all visible
// and each chosen in one press. Up to five options that are a field of a form are RadioCards, and
// a long list of names is a Select.
// It is React Aria's ListBox in a grid: one Tab stop, the arrows move in two directions, Space or
// Enter chooses, and typing a label jumps to it. Focus alone does not choose.
// The grid is as high as six rows at most and scrolls inside itself, so a day with forty free
// times does not push the buttons of a dialog off the screen. The padding leaves room for the
// focus ring of an option at the edge, which the scrolling box would otherwise cut.
export function OptionGrid({ 'aria-label': label, options, value, onChange, ltr = false, columns = 3 }: OptionGridProps) {
  function choose(keys: Selection) {
    // 'all' is only for a multiple selection.
    if (keys === 'all') return
    const [first] = keys
    onChange(first === undefined ? null : String(first))
  }

  return (
    <ListBox
      aria-label={label}
      layout="grid"
      selectionMode="single"
      selectedKeys={value === null ? [] : [value]}
      onSelectionChange={choose}
      className={cx(
        'grid max-h-80 gap-2 overflow-y-auto p-1 outline-none',
        columns === 4 ? 'grid-cols-4' : 'grid-cols-3 sm:grid-cols-4',
      )}
    >
      {options.map((option) => (
        <ListBoxItem
          key={option.id}
          id={option.id}
          textValue={option.label}
          className={({ isSelected, isHovered }) =>
            cx(
              'flex min-h-touch min-w-0 cursor-pointer items-center justify-center gap-1 rounded-control border text-small font-medium tabular-nums transition-colors duration-(--duration-fast)',
              // Four on a row of a phone are narrow: the label keeps the whole width, and the check
              // sits in the corner instead of beside it.
              columns === 4 ? 'relative px-1' : 'px-2',
              FOCUS_RING,
              optionColors(isSelected, isHovered),
            )
          }
        >
          {({ isSelected }) => (
            <>
              {/* Chosen is said by the check too, not only by the fill (design language 2). */}
              {isSelected ? (
                <Check
                  aria-hidden="true"
                  size={columns === 4 ? 12 : 14}
                  strokeWidth={ICON_STROKE}
                  className={columns === 4 ? 'absolute end-1 top-1' : 'shrink-0'}
                />
              ) : null}
              <span dir={ltr ? 'ltr' : undefined} className="truncate">
                {option.label}
              </span>
            </>
          )}
        </ListBoxItem>
      ))}
    </ListBox>
  )
}
