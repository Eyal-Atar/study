import { CalendarDate } from '@internationalized/date'
import { useId, useState } from 'react'
import { CheckboxCards } from '../ui/CheckboxCards'
import { DatePicker } from '../ui/DatePicker'
import { RadioCards } from '../ui/RadioCards'
import { Select, type SelectProps } from '../ui/Select'
import { TextField, type TextFieldProps } from '../ui/TextField'
import { TimeField } from '../ui/TimeField'
import { devText } from './devText'
import { Example, FIELD_GRID, Section } from './Section'

const t = devText

// A TextField that owns its value, so typing works in every example. `errorWhenEmpty` shows the
// error only while the field is empty, the way a real form does.
function DemoTextField({
  initial = '',
  errorWhenEmpty,
  ...props
}: Omit<TextFieldProps, 'value' | 'onChange' | 'errorMessage'> & { initial?: string; errorWhenEmpty?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <TextField {...props} value={value} onChange={setValue} errorMessage={value.trim() === '' ? errorWhenEmpty : undefined} />
  )
}

export function TextFieldSection() {
  return (
    <Section id="text-field">
      <div className={FIELD_GRID}>
        <Example caption={t.textField.empty}>
          <DemoTextField label={t.textField.examName} placeholder={t.textField.examNamePlaceholder} />
        </Example>
        <Example caption={t.textField.filled}>
          <DemoTextField label={t.textField.examName} initial={t.textField.examNameValue} />
        </Example>
        <Example caption={t.textField.withDescription}>
          <DemoTextField label={t.textField.lecturer} description={t.textField.lecturerDescription} />
        </Example>
        <Example caption={t.textField.withError}>
          <DemoTextField label={t.textField.topic} errorWhenEmpty={t.textField.topicError} />
        </Example>
        <Example caption={t.textField.disabled}>
          <DemoTextField label={t.textField.email} initial={t.textField.emailValue} isDisabled />
        </Example>
      </div>
    </Section>
  )
}

// A Select that owns its value. `errorWhenEmpty` shows the error until something is chosen.
function DemoSelect({
  initial = '',
  errorWhenEmpty,
  ...props
}: Omit<SelectProps, 'value' | 'onChange' | 'errorMessage'> & { initial?: string; errorWhenEmpty?: string }) {
  const [value, setValue] = useState(initial)
  return <Select {...props} value={value} onChange={setValue} errorMessage={value === '' ? errorWhenEmpty : undefined} />
}

export function SelectSection() {
  return (
    <Section id="select">
      <div className={FIELD_GRID}>
        <Example caption={t.select.chosen}>
          <DemoSelect label={t.select.kind} options={t.select.kinds} initial="practice" />
        </Example>
        <Example caption={t.select.placeholder}>
          <DemoSelect label={t.select.kind} options={t.select.kinds} />
        </Example>
        <Example caption={t.select.withDescription}>
          <DemoSelect label={t.select.kind} options={t.select.kinds} initial="read" description={t.select.kindDescription} />
        </Example>
        <Example caption={t.select.withError}>
          <DemoSelect label={t.select.kind} options={t.select.kinds} errorWhenEmpty={t.select.kindError} />
        </Example>
        <Example caption={t.select.disabled}>
          <DemoSelect label={t.select.kind} options={t.select.kinds} initial="summary" isDisabled />
        </Example>
        <Example caption={t.select.long}>
          <DemoSelect label={t.select.topic} options={t.select.topics} initial="t6" />
        </Example>
      </div>
    </Section>
  )
}

// A fixed date, so the page looks the same every day.
const EXAM_DATE = new CalendarDate(2027, 1, 24)

export function DatePickerSection() {
  return (
    <Section id="date-picker">
      <div className={FIELD_GRID}>
        <Example caption={t.datePicker.empty}>
          <DatePicker label={t.datePicker.examDate} />
        </Example>
        <Example caption={t.datePicker.withValue}>
          <DatePicker label={t.datePicker.examDate} defaultValue={EXAM_DATE} />
        </Example>
        <Example caption={t.datePicker.withDescription}>
          <DatePicker label={t.datePicker.examDate} defaultValue={EXAM_DATE} description={t.datePicker.description} />
        </Example>
        <Example caption={t.datePicker.withError}>
          <DatePicker label={t.datePicker.examDate} defaultValue={new CalendarDate(2026, 1, 4)} errorMessage={t.datePicker.error} />
        </Example>
        <Example caption={t.datePicker.disabled}>
          <DatePicker label={t.datePicker.examDate} defaultValue={EXAM_DATE} isDisabled />
        </Example>
      </div>
    </Section>
  )
}

// The start of the example with the error: an end that is not after it is wrong.
const START = '08:00'

export function TimeFieldSection() {
  const [empty, setEmpty] = useState('')
  const [start, setStart] = useState(START)
  const [described, setDescribed] = useState('16:30')
  const [end, setEnd] = useState('07:15')
  const [disabledValue, setDisabledValue] = useState('21:45')
  return (
    <Section id="time-field">
      <div className={FIELD_GRID}>
        <Example caption={t.timeField.empty}>
          <TimeField label={t.timeField.start} value={empty} onChange={setEmpty} />
        </Example>
        <Example caption={t.timeField.withValue}>
          <TimeField label={t.timeField.start} value={start} onChange={setStart} />
        </Example>
        <Example caption={t.timeField.withDescription}>
          <TimeField label={t.timeField.start} value={described} onChange={setDescribed} description={t.timeField.description} />
        </Example>
        <Example caption={t.timeField.withError}>
          {/* 'HH:MM' strings of 24 hours compare like the times themselves. */}
          <TimeField
            label={t.timeField.end}
            value={end}
            onChange={setEnd}
            errorMessage={end <= START ? t.timeField.error : undefined}
          />
        </Example>
        <Example caption={t.timeField.disabled}>
          <TimeField label={t.timeField.start} value={disabledValue} onChange={setDisabledValue} isDisabled />
        </Example>
      </div>
    </Section>
  )
}

export function RadioCardsSection() {
  const [value, setValue] = useState('medium')
  const [described, setDescribed] = useState('light')
  // Nothing is chosen at first, so the error shows until a choice is made.
  const [required, setRequired] = useState('')
  const [disabledValue, setDisabledValue] = useState('light')
  return (
    <Section id="radio-cards">
      <Example caption={t.radioCards.caption}>
        <RadioCards label={t.radioCards.label} options={t.radioCards.options} value={value} onChange={setValue} />
      </Example>
      <Example caption={t.radioCards.withDescription}>
        <RadioCards
          label={t.radioCards.label}
          description={t.radioCards.description}
          options={t.radioCards.options}
          value={described}
          onChange={setDescribed}
        />
      </Example>
      <Example caption={t.radioCards.withError}>
        <RadioCards
          label={t.radioCards.label}
          options={t.radioCards.options}
          value={required}
          onChange={setRequired}
          errorMessage={required === '' ? t.radioCards.error : undefined}
        />
      </Example>
      <Example caption={t.radioCards.disabled}>
        <RadioCards
          label={t.radioCards.label}
          options={t.radioCards.options}
          value={disabledValue}
          onChange={setDisabledValue}
          isDisabled
        />
      </Example>
    </Section>
  )
}

export function CheckboxCardsSection() {
  const [value, setValue] = useState<string[]>(['sun', 'tue'])
  const [required, setRequired] = useState<string[]>([])
  const [elsewhere, setElsewhere] = useState<string[]>([])
  const [disabledValue, setDisabledValue] = useState<string[]>(['mon'])
  const errorId = useId()
  const hasError = elsewhere.length === 0
  return (
    <Section id="checkbox-cards">
      <Example caption={t.checkboxCards.caption}>
        <CheckboxCards
          label={t.checkboxCards.label}
          description={t.checkboxCards.description}
          options={t.checkboxCards.options}
          value={value}
          onChange={setValue}
        />
      </Example>
      <Example caption={t.checkboxCards.withError}>
        <CheckboxCards
          label={t.checkboxCards.label}
          options={t.checkboxCards.options}
          value={required}
          onChange={setRequired}
          errorMessage={required.length === 0 ? t.checkboxCards.error : undefined}
        />
      </Example>
      <Example caption={t.checkboxCards.withErrorElsewhere} className="flex flex-col gap-1.5">
        <CheckboxCards
          label={t.checkboxCards.label}
          options={t.checkboxCards.options}
          value={elsewhere}
          onChange={setElsewhere}
          errorId={hasError ? errorId : undefined}
        />
        {/* With errorId the component links the error and does not draw it: the caller renders it,
            in the look of a field error. */}
        {hasError ? (
          <p id={errorId} className="text-small text-danger">
            {t.checkboxCards.error}
          </p>
        ) : null}
      </Example>
      <Example caption={t.checkboxCards.disabled}>
        <CheckboxCards
          label={t.checkboxCards.label}
          options={t.checkboxCards.options}
          value={disabledValue}
          onChange={setDisabledValue}
          isDisabled
        />
      </Example>
    </Section>
  )
}
