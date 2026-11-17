import { parseTime, Time } from '@internationalized/date'
import { useContext, useEffect, useEffectEvent, useState } from 'react'
import {
  DateInput,
  DateSegment,
  FieldError,
  Label,
  Text,
  TimeField as AriaTimeField,
  TimeFieldStateContext,
} from 'react-aria-components'
import {
  FIELD_BOX_CLASS,
  FIELD_CLASS,
  FIELD_DESCRIPTION_CLASS,
  FIELD_ERROR_CLASS,
  FIELD_FOCUS_WITHIN_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_SEGMENT_CLASS,
} from './TextField'

export interface TimeFieldProps {
  label: string
  // 'HH:MM' in 24 hours, or '' for no time: the shape of the value of <input type="time">, so a
  // screen keeps its state as it is. A string that is not a time is shown as an empty field.
  value: string
  // Gets 'HH:MM' whenever the time is whole, and '' once a segment is cleared (the time is no
  // longer whole), as <input type="time"> does.
  onChange: (value: string) => void
  // Typed with `| undefined` like every field (see TextFieldProps), so a caller can pass a condition.
  description?: string | undefined
  // Shown under the field and linked to it; the field is invalid while it is set.
  errorMessage?: string | undefined
  isDisabled?: boolean | undefined
}

// The box of a TextField around the two segments, with its focus inside it (as in the DatePicker).
// A time is a number, so the row reads left to right even on the RTL page (dir="ltr" on the box);
// in an LTR row the end is the right edge, which is where the value of every other field starts.
const INPUT_CLASS = `${FIELD_BOX_CLASS} flex items-center justify-end px-3 ${FIELD_FOCUS_WITHIN_CLASS}`

// parseTime throws on anything that is not a time ('25:99', 'abc'); such a value is no time at all.
function toTime(value: string): Time | null {
  // Only hours and minutes: parseTime would also take '08:30:15', which this field cannot show.
  if (!/^\d{2}:\d{2}$/.test(value)) return null
  try {
    return parseTime(value)
  } catch {
    return null
  }
}

function toText(time: Time | null): string {
  if (time === null) return ''
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
}

// React Aria reports a change only when the time is whole, or when every segment is empty. After
// the user clears one segment of a whole time it reports nothing: the field would show 08:-- while
// the screen still holds 08:30, and a save would send a time the user no longer sees. This watches
// the segments from inside the field and reports that moment. It fires once: after it, the
// screen holds '' (or, if the screen chose to keep its last whole value, nothing changes again).
function ReportIncomplete({ hasValue, onIncomplete }: { hasValue: boolean; onIncomplete: () => void }) {
  const state = useContext(TimeFieldStateContext)
  const isIncomplete =
    state !== null && state.segments.some((segment) => segment.isEditable && segment.isPlaceholder)
  // An effect event: the report depends on the segments, not on the identity of the callback (a
  // new function on every render would report again and again while the screen keeps its value).
  const report = useEffectEvent(onIncomplete)
  useEffect(() => {
    if (hasValue && isIncomplete) report()
  }, [hasValue, isIncomplete])
  return null
}

// An hour of the day, typed in two segments (hours, minutes) or changed with the arrow keys.
// React Aria's TimeField and not <input type="time">: the same look, focus and error as the other
// fields in every browser, always 24 hours, and without the browser's own clock popup.
export function TimeField({ label, value, onChange, description, errorMessage, isDisabled }: TimeFieldProps) {
  const time = toTime(value)
  // The time React Aria still holds after one segment was cleared and '' was reported. Handing
  // React Aria the null of that '' would empty the other segment too (08:-- would become --:--,
  // and fixing the minutes would cost retyping the hour), so it keeps getting this time until it
  // reports again. `held` is only ever set while the screen's value is whole.
  const [held, setHeld] = useState<Time | null>(null)
  // The screen set a whole time of its own in the meantime: that one is shown.
  if (time !== null && held !== null) setHeld(null)
  return (
    <AriaTimeField
      value={time ?? held}
      onChange={(next) => {
        setHeld(null)
        onChange(toText(next))
      }}
      hourCycle={24}
      granularity="minute"
      // 08:30 and not 8:30, like the string the screen holds.
      shouldForceLeadingZeros
      isDisabled={isDisabled ?? false}
      isInvalid={errorMessage !== undefined}
      className={FIELD_CLASS}
    >
      <ReportIncomplete
        hasValue={time !== null}
        onIncomplete={() => {
          setHeld(time)
          onChange('')
        }}
      />
      <Label className={FIELD_LABEL_CLASS}>{label}</Label>
      <DateInput dir="ltr" className={INPUT_CLASS}>
        {(segment) => <DateSegment segment={segment} className={FIELD_SEGMENT_CLASS} />}
      </DateInput>
      {description === undefined ? null : (
        <Text slot="description" className={FIELD_DESCRIPTION_CLASS}>
          {description}
        </Text>
      )}
      <FieldError className={FIELD_ERROR_CLASS}>{errorMessage}</FieldError>
    </AriaTimeField>
  )
}
