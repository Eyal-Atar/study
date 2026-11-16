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

export type { DateValue }

export interface DatePickerProps extends Omit<AriaDatePickerProps<DateValue>, 'children' | 'className' | 'isInvalid'> {
  label: string
  // Shown under the field and linked to it; the field is invalid while it is set.
  errorMessage?: string
}

const ICON = 'size-5'

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={`${ICON} ${className ?? ''}`}>
      <path d="M12.5 4.5 7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" className={ICON}>
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <path d="M3 8.5h14M7 2.5v4M13 2.5v4" strokeLinecap="round" />
    </svg>
  )
}

const ICON_BUTTON =
  'inline-flex size-11 items-center justify-center rounded-lg text-ink-muted outline-none data-[hovered]:bg-surface-muted data-[pressed]:bg-surface-muted data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[disabled]:opacity-40'

// React Aria's DatePicker: typed segments (the locale's order, he-IL: day, month, year) and a calendar
// in a popover. React Aria gives the calendar button and the month arrows their Hebrew labels.
export function DatePicker({ label, errorMessage, ...props }: DatePickerProps) {
  return (
    <AriaDatePicker {...props} isInvalid={errorMessage !== undefined} className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium text-ink">{label}</Label>
      <Group className="flex min-h-11 items-center rounded-lg border border-line bg-surface ps-3 data-[focus-within]:border-brand data-[focus-within]:ring-2 data-[focus-within]:ring-brand data-[invalid]:border-danger">
        <DateInput className="flex flex-1 py-2 text-base text-ink">
          {(segment) => (
            <DateSegment
              segment={segment}
              className="rounded px-0.5 tabular-nums outline-none data-[placeholder]:text-ink-muted data-[type=literal]:text-ink-muted data-[focused]:bg-brand data-[focused]:text-on-brand"
            />
          )}
        </DateInput>
        <Button className={ICON_BUTTON}>
          <CalendarIcon />
        </Button>
      </Group>
      <FieldError className="text-sm text-danger">{errorMessage}</FieldError>
      <Popover className="rounded-xl border border-line bg-surface p-3 shadow-lg outline-none">
        <Dialog className="outline-none">
          <Calendar className="flex flex-col gap-2">
            <header className="flex items-center justify-between gap-2">
              <Button slot="previous" className={ICON_BUTTON}>
                <Chevron className="rtl:rotate-180" />
              </Button>
              <Heading className="text-base font-medium text-ink" />
              <Button slot="next" className={ICON_BUTTON}>
                <Chevron className="ltr:rotate-180" />
              </Button>
            </header>
            <CalendarGrid className="border-separate border-spacing-0.5">
              {(date) => (
                <CalendarCell
                  date={date}
                  className="flex size-11 items-center justify-center rounded-full text-sm text-ink outline-none data-[outside-month]:hidden data-[hovered]:bg-brand-soft data-[pressed]:bg-brand-soft data-[unavailable]:text-ink-muted data-[unavailable]:line-through data-[disabled]:text-ink-muted data-[disabled]:opacity-50 data-[selected]:bg-brand data-[selected]:text-on-brand data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand"
                />
              )}
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </AriaDatePicker>
  )
}
