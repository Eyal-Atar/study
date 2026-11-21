import { CalendarDate } from '@internationalized/date'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { I18nProvider } from 'react-aria-components'
import { describe, expect, it, vi } from 'vitest'
import { LOCALE } from '../i18n/locale'
import { DatePicker, type DatePickerProps } from './DatePicker'
import { ICON_BUTTON_CLASS } from './styles'

// The app renders everything under LOCALE (en-IL, AppProviders): English labels, day, month, year, and weeks from Sunday.
function setup(props: Partial<DatePickerProps> = {}) {
  const onChange = vi.fn()
  render(
    <I18nProvider locale={LOCALE}>
      <DatePicker label="Exam date" defaultValue={new CalendarDate(2027, 1, 12)} onChange={onChange} {...props} />
    </I18nProvider>,
  )
  const group = screen.getByRole('group', { name: 'Exam date' })
  return { onChange, group, button: within(group).getByRole('button') }
}

describe('DatePicker', () => {
  it('is a group named by its label, with a segment for the day, the month and the year', () => {
    const { group } = setup()

    const segments = within(group).getAllByRole('spinbutton')
    expect(segments.map((segment) => segment.textContent)).toEqual(['12', '01', '2027'])
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
    // The two arrows are the only buttons outside the grid; React Aria names them in English.
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

  it('in LTR the previous month points left and the next month points right, with no flip', async () => {
    const user = userEvent.setup()
    const { button } = setup()

    await user.click(button)
    const dialog = screen.getByRole('dialog')
    const grid = within(dialog).getByRole('grid')
    const [previous, next] = within(dialog)
      .getAllByRole('button')
      .filter((candidate) => !grid.contains(candidate) && candidate.querySelector('svg.lucide') !== null)
    if (previous === undefined || next === undefined) throw new Error('no month arrows')
    expect(previous).toHaveAccessibleName('Previous')
    expect(next).toHaveAccessibleName('Next')
    const previousIcon = previous.querySelector('svg')
    const nextIcon = next.querySelector('svg')
    expect(previousIcon).toHaveClass('lucide-chevron-left')
    expect(nextIcon).toHaveClass('lucide-chevron-right')
    expect(previousIcon?.getAttribute('class')).not.toMatch(/scale-x/)
    expect(nextIcon?.getAttribute('class')).not.toMatch(/scale-x/)
    // Previous comes first in the row (the left in LTR).
    expect(previous.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the month grid starts its week on Sunday', async () => {
    const user = userEvent.setup()
    const { button } = setup()

    await user.click(button)
    const grid = within(screen.getByRole('dialog')).getByRole('grid')
    // The grid's first row starts on a Sunday: 1 January 2027 is a Friday, so the row opens on 27 December.
    const firstRow = within(grid).getAllByRole('row').find((row) => within(row).queryAllByRole('gridcell').length > 0)
    if (firstRow === undefined) throw new Error('no week rows')
    const days = within(firstRow).getAllByRole('button')
    expect(days).toHaveLength(7)
    expect(days[0]).toHaveAccessibleName('Sunday, 27 December 2026')
    expect(days[5]).toHaveAccessibleName('Friday, 1 January 2027')
    expect(days[6]).toHaveAccessibleName('Saturday, 2 January 2027')
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

  it('a description is shown under the field and linked to it', () => {
    const { group } = setup({ description: 'אפשר לשנות אחר כך' })

    expect(screen.getByText('אפשר לשנות אחר כך').className).toContain('text-ink-muted')
    expect(group).toHaveAccessibleDescription(/אפשר לשנות אחר כך/)
  })

  it('a focused placeholder segment stays readable: on-brand on the brand fill, by a stacked variant', async () => {
    const user = userEvent.setup()
    // No value: every segment is a placeholder.
    const { group } = setup({ defaultValue: null })

    await user.tab()
    const [day] = within(group).getAllByRole('spinbutton')
    expect(day).toHaveFocus()
    expect(day).toHaveAttribute('data-focused', 'true')
    expect(day).toHaveAttribute('data-placeholder', 'true')
    // data-[placeholder] is emitted after data-[focused], so alone it would leave muted text on brand.
    expect(day?.className).toContain('data-[placeholder]:text-ink-muted')
    expect(day?.className).toContain('data-[focused]:bg-brand')
    expect(day?.className).toContain('data-[focused]:data-[placeholder]:text-on-brand')
  })

  it('a chosen day that is unavailable keeps on-brand text on its brand fill', async () => {
    const user = userEvent.setup()
    const { button } = setup({ isDateUnavailable: () => true })

    await user.click(button)
    const grid = within(screen.getByRole('dialog')).getByRole('grid')
    const chosen = within(grid).getByText('12')
    expect(chosen).toHaveAttribute('data-selected', 'true')
    expect(chosen).toHaveAttribute('data-unavailable', 'true')
    // data-[unavailable] is emitted after data-[selected]: the stacked variants win by specificity.
    expect(chosen.className).toContain('data-[selected]:data-[unavailable]:text-on-brand')
    expect(chosen.className).toContain('data-[selected]:data-[disabled]:text-on-brand')
  })

  it('the calendar button and the month arrows wear the shared look of an icon button', async () => {
    const user = userEvent.setup()
    const { button } = setup()

    expect(button.className).toBe(ICON_BUTTON_CLASS)
    await user.click(button)
    const dialog = screen.getByRole('dialog')
    const grid = within(dialog).getByRole('grid')
    const arrows = within(dialog)
      .getAllByRole('button')
      .filter((candidate) => !grid.contains(candidate) && candidate.querySelector('svg.lucide') !== null)
    for (const arrow of arrows) {
      expect(arrow.className).toBe(ICON_BUTTON_CLASS)
    }
  })
})
