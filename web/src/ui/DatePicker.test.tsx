import { CalendarDate } from '@internationalized/date'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { I18nProvider } from 'react-aria-components'
import { describe, expect, it, vi } from 'vitest'
import { DatePicker, type DatePickerProps } from './DatePicker'

// The app renders everything under he-IL (AppProviders), which gives the Hebrew labels and day, month, year.
function setup(props: Partial<DatePickerProps> = {}) {
  const onChange = vi.fn()
  render(
    <I18nProvider locale="he-IL">
      <DatePicker label="תאריך המבחן" defaultValue={new CalendarDate(2027, 1, 12)} onChange={onChange} {...props} />
    </I18nProvider>,
  )
  const group = screen.getByRole('group', { name: 'תאריך המבחן' })
  return { onChange, group, button: within(group).getByRole('button') }
}

describe('DatePicker', () => {
  it('is a group named by its label, with a segment for the day, the month and the year', () => {
    const { group } = setup()

    const segments = within(group).getAllByRole('spinbutton')
    expect(segments.map((segment) => segment.textContent)).toEqual(['12', '1', '2027'])
    expect(group.className).toContain('min-h-touch')
    expect(group.className).toContain('data-[focus-within]:ring-2')
    expect(group.className).toContain('data-[focus-within]:border-brand')
  })

  it('typing in the segments reports the date', async () => {
    const user = userEvent.setup()
    const { onChange, group } = setup()

    const [day] = within(group).getAllByRole('spinbutton')
    await user.click(day as HTMLElement)
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(new CalendarDate(2027, 1, 13))
  })

  it('the calendar button has a name and a lucide icon, and shows its keyboard focus', async () => {
    const user = userEvent.setup()
    const { group, button } = setup()

    expect(button).toHaveAccessibleName()
    expect(button.querySelector('svg.lucide')).toHaveAttribute('aria-hidden', 'true')
    expect(button.className).toContain('size-touch')
    expect(button.className).toContain('data-[focus-visible]:ring-2')
    expect(button.className).toContain('data-[focus-visible]:ring-brand')

    // Three segments, then the button.
    await user.tab()
    expect(group).toHaveAttribute('data-focus-within', 'true')
    await user.tab()
    await user.tab()
    await user.tab()
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('data-focus-visible', 'true')
  })

  it('the button opens a dialog with the month grid, and picking a day reports it and closes', async () => {
    const user = userEvent.setup()
    const { onChange, button } = setup()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(button)
    const dialog = screen.getByRole('dialog')
    const grid = within(dialog).getByRole('grid')
    expect(grid).toHaveAccessibleName(/2027/)
    expect(within(grid).getByRole('gridcell', { selected: true })).toHaveTextContent('12')

    await user.click(within(grid).getByRole('button', { name: /, 20 / }))
    expect(onChange).toHaveBeenLastCalledWith(new CalendarDate(2027, 1, 20))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('the calendar works from the keyboard: Enter opens it, the arrows move, Enter picks', async () => {
    const user = userEvent.setup()
    const { onChange, button } = setup()

    button.focus()
    await user.keyboard('{Enter}')
    const grid = within(screen.getByRole('dialog')).getByRole('grid')
    await waitFor(() => {
      expect(within(grid).getByRole('button', { name: /, 12 / })).toHaveFocus()
    })
    // A week forward.
    await user.keyboard('{ArrowDown}')
    const focused = document.activeElement as HTMLElement
    expect(focused).toHaveTextContent('19')
    expect(focused.className).toContain('data-[focus-visible]:ring-2')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(new CalendarDate(2027, 1, 19))
  })

  it('the month arrows are named buttons with lucide icons, and move the month', async () => {
    const user = userEvent.setup()
    const { button } = setup()

    await user.click(button)
    const dialog = screen.getByRole('dialog')
    const heading = within(dialog).getByRole('heading')
    const before = heading.textContent
    // The two arrows are the only buttons outside the grid; React Aria names them in Hebrew.
    const grid = within(dialog).getByRole('grid')
    const arrows = within(dialog)
      .getAllByRole('button')
      .filter((candidate) => !grid.contains(candidate) && candidate.querySelector('svg.lucide') !== null)
    expect(arrows).toHaveLength(2)
    for (const arrow of arrows) {
      expect(arrow).toHaveAccessibleName()
      expect(arrow.className).toContain('size-touch')
    }
    await user.click(arrows[1] as HTMLElement)
    expect(heading.textContent).not.toBe(before)
  })

  it('an error message makes the field invalid, and is shown and linked', () => {
    const { group } = setup({ errorMessage: 'התאריך כבר עבר' })

    expect(screen.getByText('התאריך כבר עבר').className).toContain('text-danger')
    expect(group).toHaveAttribute('data-invalid', 'true')
    expect(group).toHaveAccessibleDescription(/התאריך כבר עבר/)
    const [day] = within(group).getAllByRole('spinbutton')
    expect(day).toHaveAttribute('aria-invalid', 'true')
    expect(day).toHaveAccessibleDescription(/התאריך כבר עבר/)
  })
})
