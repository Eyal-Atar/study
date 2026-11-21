import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { I18nProvider } from 'react-aria-components'
import { describe, expect, it, vi } from 'vitest'
import { LOCALE } from '../i18n/locale'
import { TimeField, type TimeFieldProps } from './TimeField'

// A screen keeps the time as an 'HH:MM' string, so the test holds it the same way. The app renders
// everything under LOCALE (AppProviders).
function Field({ initial = '', onChange, ...props }: Partial<TimeFieldProps> & { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <I18nProvider locale={LOCALE}>
      <TimeField
        label="Study start"
        {...props}
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
      />
    </I18nProvider>
  )
}

function setup(props: Partial<TimeFieldProps> & { initial?: string } = {}) {
  const onChange = vi.fn()
  render(<Field onChange={onChange} {...props} />)
  const group = screen.getByRole('group', { name: 'Study start' })
  const [hour, minute] = within(group).getAllByRole('spinbutton') as [HTMLElement, HTMLElement]
  return { onChange, group, hour, minute }
}

describe('TimeField', () => {
  it('is a group named by its label, with an hour and a minute segment, 24-hour with leading zeros', () => {
    const { group, hour, minute } = setup({ initial: '08:30' })

    expect(within(group).getAllByRole('spinbutton')).toHaveLength(2)
    expect(hour).toHaveAccessibleName(/Study start/)
    expect(minute).toHaveAccessibleName(/Study start/)
    expect(hour).toHaveTextContent('08')
    expect(minute).toHaveTextContent('30')
    expect(group).toHaveTextContent('08:30')
    // 24-hour: the hour goes up to 23 and there is no AM/PM segment.
    expect(hour).toHaveAttribute('aria-valuemax', '23')
  })

  it('looks like the box of the other fields, reads left to right, and starts at the start of the box', () => {
    const { group, hour } = setup({ initial: '08:30' })

    for (const part of [
      'min-h-touch',
      'rounded-control',
      'border-line-strong',
      'text-body',
      'data-[focus-within]:border-brand',
      'data-[focus-within]:ring-2',
      'data-[focus-within]:ring-brand',
      'data-[invalid]:border-danger',
      // The value starts at the left edge, where the value of every other field starts.
      'justify-start',
    ]) {
      expect(group.className).toContain(part)
    }
    expect(group.className).not.toContain('justify-end')
    expect(group).toHaveAttribute('dir', 'ltr')
    expect(hour.className).toContain('data-[focused]:bg-brand')
    expect(hour.className).toContain('data-[focused]:data-[placeholder]:text-on-brand')
    expect(group.className).not.toMatch(/opacity|text-sm\b|rounded-lg/)
  })

  it('typing sets the time and reports it as HH:MM', async () => {
    const user = userEvent.setup()
    const { onChange, group, hour, minute } = setup()

    await user.tab()
    expect(hour).toHaveFocus()
    expect(group).toHaveAttribute('data-focus-within', 'true')
    expect(hour).toHaveAttribute('data-placeholder', 'true')
    // The hour alone is not a time yet: nothing is reported.
    await user.keyboard('08')
    expect(onChange).not.toHaveBeenCalled()
    expect(minute).toHaveFocus()
    await user.keyboard('30')
    expect(onChange).toHaveBeenLastCalledWith('08:30')
    expect(hour).toHaveTextContent('08')
    expect(minute).toHaveTextContent('30')
  })

  it('the arrow keys change the focused segment', async () => {
    const user = userEvent.setup()
    const { onChange, hour, minute } = setup({ initial: '08:30' })

    await user.click(hour)
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith('09:30')
    await user.click(minute)
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith('09:29')
    expect(hour).toHaveTextContent('09')
    expect(minute).toHaveTextContent('29')
  })

  it('clearing one segment reports the empty string and keeps the other segment', async () => {
    const user = userEvent.setup()
    const { onChange, group, hour, minute } = setup({ initial: '08:30' })

    await user.click(minute)
    await user.keyboard('{Backspace}{Backspace}')
    // The time is not whole any more, so the screen must not keep 08:30.
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(minute).toHaveAttribute('data-placeholder', 'true')
    // The hour is still there: fixing the minutes does not cost retyping it.
    expect(hour).toHaveTextContent('08')
    expect(hour).not.toHaveAttribute('data-placeholder')

    await user.keyboard('45')
    expect(onChange).toHaveBeenLastCalledWith('08:45')
    expect(group).toHaveTextContent('08:45')
  })

  it('clearing both segments leaves an empty field', async () => {
    const user = userEvent.setup()
    const { onChange, hour, minute } = setup({ initial: '08:30' })

    await user.click(minute)
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}')
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(hour).toHaveAttribute('data-placeholder', 'true')
    expect(minute).toHaveAttribute('data-placeholder', 'true')
  })

  it('a screen that keeps its last whole value on an empty report gets one report, not a loop', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    // What PreferencesForm does with its native input today: '' is ignored.
    function Keeps() {
      const [value, setValue] = useState('08:30')
      return (
        <I18nProvider locale={LOCALE}>
          <TimeField
            label="Time"
            value={value}
            onChange={(next) => {
              onChange(next)
              if (next !== '') setValue(next)
            }}
          />
        </I18nProvider>
      )
    }
    render(<Keeps />)
    const [, minute] = within(screen.getByRole('group', { name: 'Time' })).getAllByRole('spinbutton')

    await user.click(minute as HTMLElement)
    await user.keyboard('{Backspace}{Backspace}')
    expect(onChange.mock.calls.filter(([value]) => value === '')).toHaveLength(1)
    await user.keyboard('45')
    expect(onChange).toHaveBeenLastCalledWith('08:45')
    expect(screen.getByRole('group', { name: 'Time' })).toHaveTextContent('08:45')
  })

  it('a value that changes from outside is shown', () => {
    const { rerender } = render(
      <I18nProvider locale={LOCALE}>
        <TimeField label="Time" value="08:30" onChange={vi.fn()} />
      </I18nProvider>,
    )
    rerender(
      <I18nProvider locale={LOCALE}>
        <TimeField label="Time" value="21:05" onChange={vi.fn()} />
      </I18nProvider>,
    )

    expect(screen.getByRole('group', { name: 'Time' })).toHaveTextContent('21:05')
  })

  it('an error message makes the field invalid, and is shown and linked', () => {
    const { group, hour } = setup({ initial: '08:30', errorMessage: 'The end must be after the start' })

    expect(screen.getByText('The end must be after the start').className).toContain('text-small text-danger')
    expect(group).toHaveAttribute('data-invalid', 'true')
    expect(hour).toHaveAttribute('aria-invalid', 'true')
    expect(hour).toHaveAccessibleDescription(/The end must be after the start/)
  })

  it('without an error the field is not invalid', () => {
    const { group, hour } = setup({ initial: '08:30' })

    expect(group).not.toHaveAttribute('data-invalid')
    expect(hour).not.toHaveAttribute('aria-invalid')
  })

  it('links its description to the field', () => {
    const { hour } = setup({ description: 'In local time' })

    expect(screen.getByText('In local time').className).toContain('text-small text-ink-muted')
    expect(hour).toHaveAccessibleDescription(/In local time/)
  })

  it('disabled: muted and not transparent, and the keyboard does not reach or change it', async () => {
    const user = userEvent.setup()
    const { onChange, group, hour } = setup({ initial: '08:30', isDisabled: true })

    expect(group).toHaveAttribute('data-disabled', 'true')
    expect(group.className).toContain('data-[disabled]:bg-surface-muted')
    expect(group.className).toContain('data-[disabled]:text-ink-muted')
    expect(hour).toHaveAttribute('aria-disabled', 'true')
    await user.tab()
    expect(hour).not.toHaveFocus()
    await user.click(hour)
    await user.keyboard('{ArrowUp}')
    expect(onChange).not.toHaveBeenCalled()
    expect(group).toHaveTextContent('08:30')
  })

  it.each(['25:99', 'abc', '8', '08:3x', ':'])('the invalid value %j renders as empty and does not throw', (bad) => {
    const { hour, minute } = setup({ initial: bad })

    expect(hour).toHaveAttribute('data-placeholder', 'true')
    expect(minute).toHaveAttribute('data-placeholder', 'true')
  })
})
