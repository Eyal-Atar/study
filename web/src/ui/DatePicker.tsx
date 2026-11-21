import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from './icons'
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  DateInput,
  DatePicker as AriaDatePicker,
  DateSegment,
  Dialog,
  FieldError,
  Group,
  Heading,
  Label,
  Popover,
  Text,
  type DatePickerProps as AriaDatePickerProps,
  type DateValue,
} from 'react-aria-components'
import { cx, FOCUS_RING, ICON_BUTTON_CLASS, ICON_STROKE } from './styles'
import {
  FIELD_BOX_CLASS,
  FIELD_CLASS,
  FIELD_DESCRIPTION_CLASS,
  FIELD_ERROR_CLASS,
  FIELD_FOCUS_WITHIN_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_SEGMENT_CLASS,
} from './TextField'

export type { DateValue }

export interface DatePickerProps extends Omit<AriaDatePickerProps<DateValue>, 'children' | 'className' | 'isInvalid'> {
  label: string
  // Typed with `| undefined` like every field (see TextFieldProps), so a caller can pass a condition.
  description?: string | undefined
  // Shown under the field and linked to it; the field is invalid while it is set.
  errorMessage?: string | undefined
}

// The calendar button and the month arrows wear ICON_BUTTON_CLASS, the look of an IconButton. The
// component itself cannot be used here: it requires an aria-label, and a label passed here would
// replace the one React Aria gives them (in the locale, English).

// The box of a TextField around the segments and the calendar button. The focus is inside it, on a
// segment or on the button, so the box shows it with data-focus-within.
// Invalid and focused together keeps the danger border, as in a TextField (data-[invalid] is
// emitted after data-[focus-within]).
const GROUP_CLASS = `${FIELD_BOX_CLASS} flex items-center ps-3 ${FIELD_FOCUS_WITHIN_CLASS}`

// A day: a 44px circle. Today is not marked, only the chosen day is. A day that cannot be chosen is
// muted (and crossed out when it is unavailable, not only out of range), never transparent.
// The chosen day can itself be unavailable or disabled (a saved date that is now in the past).
// Tailwind emits data-[...] variants alphabetically, so the muted text of data-[unavailable] would
// win over data-[selected] and sit on the brand fill; the stacked variants are more specific and
// keep it on-brand.
const CELL_CLASS = cx(
  'flex size-touch cursor-pointer items-center justify-center rounded-full text-small text-ink tabular-nums',
  'transition-colors duration-(--duration-fast)',
  FOCUS_RING,
  'data-[outside-month]:hidden data-[hovered]:bg-brand-soft data-[pressed]:bg-brand-soft',
  'data-[selected]:bg-brand data-[selected]:font-semibold data-[selected]:text-on-brand',
  'data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-muted',
  'data-[unavailable]:cursor-not-allowed data-[unavailable]:text-ink-muted data-[unavailable]:line-through',
  'data-[selected]:data-[disabled]:text-on-brand data-[selected]:data-[unavailable]:text-on-brand',
)

// React Aria's DatePicker: typed segments (the locale's order, en-IL: day, month, year) and a calendar
// in a popover whose weeks start on Sunday. React Aria gives the calendar button and the month arrows
// their English labels.
export function DatePicker({ label, description, errorMessage, ...props }: DatePickerProps) {
  return (
    <AriaDatePicker {...props} isInvalid={errorMessage !== undefined} className={FIELD_CLASS}>
      <Label className={FIELD_LABEL_CLASS}>{label}</Label>
      <Group className={GROUP_CLASS}>
        <DateInput className="flex flex-1 py-2">
          {(segment) => <DateSegment segment={segment} className={FIELD_SEGMENT_CLASS} />}
        </DateInput>
        <Button className={ICON_BUTTON_CLASS}>
          <CalendarIcon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        </Button>
      </Group>
      {description === undefined ? null : (
        <Text slot="description" className={FIELD_DESCRIPTION_CLASS}>
          {description}
        </Text>
      )}
      <FieldError className={FIELD_ERROR_CLASS}>{errorMessage}</FieldError>
      <Popover className="rounded-card border border-line bg-surface p-3 shadow-overlay transition-opacity duration-(--duration-slow) data-[entering]:opacity-0 data-[exiting]:opacity-0">
        <Dialog className="outline-none">
          <Calendar className="flex flex-col gap-2">
            {/* The arrows point where the months go: in LTR "previous" points left, "next" right. */}
            <header className="flex items-center justify-between gap-2">
              <Button slot="previous" className={ICON_BUTTON_CLASS}>
                <ChevronLeft aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
              </Button>
              <Heading className="text-body font-semibold text-ink" />
              <Button slot="next" className={ICON_BUTTON_CLASS}>
                <ChevronRight aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
              </Button>
            </header>
            <CalendarGrid className="border-separate border-spacing-0.5">
              {(date) => <CalendarCell date={date} className={CELL_CLASS} />}
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </AriaDatePicker>
  )
}
