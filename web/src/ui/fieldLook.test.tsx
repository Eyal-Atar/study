import { CalendarDate } from '@internationalized/date'
import { render, screen, within } from '@testing-library/react'
import { I18nProvider } from 'react-aria-components'
import { describe, expect, it } from 'vitest'
import { LOCALE } from '../i18n/locale'
import { CheckboxCards } from './CheckboxCards'
import { CompactSelect } from './CompactSelect'
import { DatePicker } from './DatePicker'
import { OptionGrid } from './OptionGrid'
import { RadioCards } from './RadioCards'
import { Select } from './Select'
import { Switch } from './Switch'
import { TextField } from './TextField'
import { TimeField } from './TimeField'

// The all-screens mockup draws a place to type or to choose in white (.field, .opt), so it stands
// out of the surface around it (S31 decision 26): bg-field, with the line-strong border that makes
// a field a field, and the 12px corners of a control (decision 27). A choice card carries its own
// text, so its border is the quiet line, like .opt (the screenshots of S31: line-strong was heavy).
const noop = () => undefined
const OPTIONS = [
  { value: 'a', label: 'One' },
  { value: 'b', label: 'Home' },
]

function classesOf(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/)
}

function expectField(element: Element, border: 'line-strong' | 'line' = 'line-strong') {
  const classes = classesOf(element)
  expect(classes).toContain('bg-field')
  expect(classes).not.toContain('bg-surface')
  expect(classes).toContain(`border-${border}`)
}

describe('the white of fields and choice cards', () => {
  it('TextField', () => {
    render(<TextField label="Name" />)
    const input = screen.getByRole('textbox', { name: 'Name' })
    expectField(input)
    expect(classesOf(input)).toContain('rounded-control')
  })

  it('Select', () => {
    render(<Select label="Course" value="a" options={OPTIONS} onChange={noop} />)
    expectField(screen.getByRole('button', { name: /Course/ }))
  })

  it('DatePicker', () => {
    render(
      <I18nProvider locale={LOCALE}>
        <DatePicker label="Exam date" defaultValue={new CalendarDate(2027, 1, 12)} />
      </I18nProvider>,
    )
    expectField(screen.getByRole('group', { name: 'Exam date' }))
  })

  it('TimeField', () => {
    render(<TimeField label="Time" value="08:30" onChange={noop} />)
    expectField(screen.getByRole('group', { name: 'Time' }))
  })

  it('RadioCards: an option that is not chosen', () => {
    render(<RadioCards label="Length" options={OPTIONS} value="a" onChange={noop} />)
    const other = screen.getByRole('radio', { name: 'Home' }).closest('label')
    expect(other).not.toBeNull()
    expectField(other as Element, 'line')
  })

  it('CheckboxCards: an option that is not chosen', () => {
    render(<CheckboxCards label="Days" options={OPTIONS} value={[]} onChange={noop} />)
    const group = screen.getByRole('group', { name: 'Days' })
    const option = within(group).getByRole('checkbox', { name: 'One' }).closest('label')
    expect(option).not.toBeNull()
    expectField(option as Element, 'line')
  })

  it('OptionGrid: an option that is not chosen', () => {
    render(<OptionGrid aria-label="Hours" options={[{ id: 'a', label: '10:00' }, { id: 'b', label: '11:00' }]} value="a" onChange={noop} />)
    expectField(screen.getByRole('option', { name: '11:00' }), 'line')
  })

  // A compact select is a button-like control with a label, so its border stays the quiet line.
  it('CompactSelect', () => {
    render(<CompactSelect aria-label="Type" value="a" options={OPTIONS} onChange={noop} />)
    expectField(screen.getByRole('button', { name: /Type/ }), 'line')
  })

  it('Switch: the track when off', () => {
    render(<Switch label="Reminders" isSelected={false} onChange={noop} />)
    const track = screen.getByRole('switch', { name: 'Reminders' }).closest('label')?.querySelector('[aria-hidden="true"]')
    expect(track).not.toBeNull()
    expectField(track as Element)
  })
})
