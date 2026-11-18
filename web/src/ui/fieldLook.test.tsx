import { CalendarDate } from '@internationalized/date'
import { render, screen, within } from '@testing-library/react'
import { I18nProvider } from 'react-aria-components'
import { describe, expect, it } from 'vitest'
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
// a field a field, and the 12px corners of a control (decision 27).
const noop = () => undefined
const OPTIONS = [
  { value: 'a', label: 'אלף' },
  { value: 'b', label: 'בית' },
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
    render(<TextField label="שם" />)
    const input = screen.getByRole('textbox', { name: 'שם' })
    expectField(input)
    expect(classesOf(input)).toContain('rounded-control')
  })

  it('Select', () => {
    render(<Select label="קורס" value="a" options={OPTIONS} onChange={noop} />)
    expectField(screen.getByRole('button', { name: /קורס/ }))
  })

  it('DatePicker', () => {
    render(
      <I18nProvider locale="he-IL">
        <DatePicker label="תאריך המבחן" defaultValue={new CalendarDate(2027, 1, 12)} />
      </I18nProvider>,
    )
    expectField(screen.getByRole('group', { name: 'תאריך המבחן' }))
  })

  it('TimeField', () => {
    render(<TimeField label="שעה" value="08:30" onChange={noop} />)
    expectField(screen.getByRole('group', { name: 'שעה' }))
  })

  it('RadioCards: an option that is not chosen', () => {
    render(<RadioCards label="אורך" options={OPTIONS} value="a" onChange={noop} />)
    const other = screen.getByRole('radio', { name: 'בית' }).closest('label')
    expect(other).not.toBeNull()
    expectField(other as Element)
  })

  it('CheckboxCards: an option that is not chosen', () => {
    render(<CheckboxCards label="ימים" options={OPTIONS} value={[]} onChange={noop} />)
    const group = screen.getByRole('group', { name: 'ימים' })
    const option = within(group).getByRole('checkbox', { name: 'אלף' }).closest('label')
    expect(option).not.toBeNull()
    expectField(option as Element)
  })

  it('OptionGrid: an option that is not chosen', () => {
    render(<OptionGrid aria-label="שעות" options={[{ id: 'a', label: '10:00' }, { id: 'b', label: '11:00' }]} value="a" onChange={noop} />)
    expectField(screen.getByRole('option', { name: '11:00' }))
  })

  // A compact select is a button-like control with a label, so its border stays the quiet line.
  it('CompactSelect', () => {
    render(<CompactSelect aria-label="סוג" value="a" options={OPTIONS} onChange={noop} />)
    expectField(screen.getByRole('button', { name: /סוג/ }), 'line')
  })

  it('Switch: the track when off', () => {
    render(<Switch label="תזכורות" isSelected={false} onChange={noop} />)
    const track = screen.getByRole('switch', { name: 'תזכורות' }).closest('label')?.querySelector('[aria-hidden="true"]')
    expect(track).not.toBeNull()
    expectField(track as Element)
  })
})
