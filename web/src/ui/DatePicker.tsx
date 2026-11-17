import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
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
  type DatePickerProps as AriaDatePickerProps,
  type DateValue,
} from 'react-aria-components'
import { cx, FOCUS_RING, ICON_STROKE } from './styles'
import { FIELD_BOX_CLASS, FIELD_CLASS, FIELD_ERROR_CLASS, FIELD_LABEL_CLASS } from './TextField'

export type { DateValue }

export interface DatePickerProps extends Omit<AriaDatePickerProps<DateValue>, 'children' | 'className' | 'isInvalid'> {
  label: string
  // Shown under the field and linked to it; the field is invalid while it is set.
  errorMessage?: string
}

// The look of a quiet IconButton. The component itself cannot be used here: it requires an
// aria-label, and a label passed here would replace the Hebrew one React Aria gives the calendar
// button and the month arrows.
const ICON_BUTTON = cx(
  'inline-flex size-touch shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted',
  'transition-colors duration-(--duration-fast)',
  FOCUS_RING,
  'data-[hovered]:bg-surface-muted data-[hovered]:text-ink data-[pressed]:bg-surface-muted data-[disabled]:cursor-not-allowed',
)

// The box of a TextField around the segments and the calendar button. The focus is inside it, on a
// segment or on the button, so the box shows it with data-focus-within.
const GROUP_CLASS = `${FIELD_BOX_CLASS} flex items-center ps-3 data-[focus-within]:border-brand data-[focus-within]:ring-2 data-[focus-within]:ring-brand`

// A day: a 44px circle. Today is not marked, only the chosen day is. A day that cannot be chosen is
// muted (and crossed out when it is unavailable, not only out of range), never transparent.
const CELL_CLASS = cx(
  'flex size-touch cursor-pointer items-center justify-center rounded-full text-small text-ink tabular-nums',
  'transition-colors duration-(--duration-fast)',
  FOCUS_RING,
  'data-[outside-month]:hidden data-[hovered]:bg-brand-soft data-[pressed]:bg-brand-soft',
  'data-[selected]:bg-brand data-[selected]:font-semibold data-[selected]:text-on-brand',
  'data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-muted',
  'data-[unavailable]:cursor-not-allowed data-[unavailable]:text-ink-muted data-[unavailable]:line-through',
)

// React Aria's DatePicker: typed segments (the locale's order, he-IL: day, month, year) and a calendar
// in a popover. React Aria gives the calendar button and the month arrows their Hebrew labels.
export function DatePicker({ label, errorMessage, ...props }: DatePickerProps) {
  return (
    <AriaDatePicker {...props} isInvalid={errorMessage !== undefined} className={FIELD_CLASS}>
      <Label className={FIELD_LABEL_CLASS}>{label}</Label>
      <Group className={GROUP_CLASS}>
        <DateInput className="flex flex-1 py-2">
          {(segment) => (
            <DateSegment
              segment={segment}
              className="rounded-badge px-0.5 tabular-nums outline-none data-[placeholder]:text-ink-muted data-[type=literal]:text-ink-muted data-[focused]:bg-brand data-[focused]:text-on-brand"
            />
          )}
        </DateInput>
        <Button className={ICON_BUTTON}>
          <CalendarIcon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        </Button>
      </Group>
      <FieldError className={FIELD_ERROR_CLASS}>{errorMessage}</FieldError>
      <Popover className="rounded-card border border-line bg-surface p-3 shadow-overlay transition-opacity duration-(--duration-slow) data-[entering]:opacity-0 data-[exiting]:opacity-0">
        <Dialog className="outline-none">
          <Calendar className="flex flex-col gap-2">
            {/* The arrows point where the months go: in RTL "previous" points to the right. */}
            <header className="flex items-center justify-between gap-2">
              <Button slot="previous" className={ICON_BUTTON}>
                <ChevronLeft aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="rtl:-scale-x-100" />
              </Button>
              <Heading className="text-body font-semibold text-ink" />
              <Button slot="next" className={ICON_BUTTON}>
                <ChevronRight aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="rtl:-scale-x-100" />
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
