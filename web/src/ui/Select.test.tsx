import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { Select, type SelectOption } from './Select'

const OPTIONS: readonly SelectOption[] = [
  { value: 'a', label: 'Reading' },
  { value: 'b', label: 'Practice' },
  { value: 'c', label: 'Review' },
]

function setup(props: Partial<Parameters<typeof Select>[0]> = {}) {
  const onChange = vi.fn()
  render(<Select label="Type" value="a" options={OPTIONS} onChange={onChange} {...props} />)
  return { onChange, trigger: screen.getByRole('button', { name: /Type/ }) }
}

describe('Select', () => {
  it('is closed by default, and its trigger is named by the label and shows the chosen option', () => {
    const { trigger } = setup()

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
    expect(trigger).toHaveAccessibleName('Reading Type')
    expect(trigger).toHaveTextContent('Reading')
  })

  it('opens with a click and lists the options, the chosen one marked selected', async () => {
    const user = userEvent.setup()
    const { trigger } = setup()

    await user.click(trigger)
    const listbox = screen.getByRole('listbox', { name: 'Type' })
    const options = within(listbox).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Reading', 'Practice', 'Review'])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
    // Chosen is not said by colour alone: only the chosen option carries the check icon.
    expect(options[0]?.querySelector('svg')).not.toBeNull()
    expect(options[1]?.querySelector('svg')).toBeNull()
  })

  it('opens with Enter, ArrowDown moves, and Enter picks: onChange gets the value of the option', async () => {
    const user = userEvent.setup()
    const { onChange, trigger } = setup()

    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(options[1]).toHaveFocus()
    expect(options[1]).toHaveAttribute('data-focused', 'true')
    await user.keyboard('{Enter}')

    expect(onChange.mock.calls).toEqual([['b']])
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('a click on an option picks it', async () => {
    const user = userEvent.setup()
    const { onChange, trigger } = setup()

    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Review' }))
    expect(onChange.mock.calls).toEqual([['c']])
  })

  it('Escape closes it without a change and gives the focus back to the trigger', async () => {
    const user = userEvent.setup()
    const { onChange, trigger } = setup()

    await user.click(trigger)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    // React Aria restores the focus on the next frame.
    await waitFor(() => {
      expect(trigger).toHaveFocus()
    })
  })

  it('shows its keyboard focus: data-focus-visible on the trigger carries the brand border and ring', async () => {
    const user = userEvent.setup()
    const { trigger } = setup()

    expect(trigger).not.toHaveAttribute('data-focus-visible')
    await user.tab()
    expect(trigger).toHaveAttribute('data-focus-visible', 'true')
    expect(trigger.className).toContain('data-[focus-visible]:border-brand')
    expect(trigger.className).toContain('data-[focus-visible]:ring-2')
    expect(trigger.className).toContain('data-[focus-visible]:ring-brand')
    expect(trigger.className).toContain('min-h-touch')
    expect(trigger.className).toContain('text-body')
  })

  it('a value that is not one of the options shows the placeholder, and nothing is selected', async () => {
    const user = userEvent.setup()
    const { trigger } = setup({ value: 'gone' })

    expect(trigger).toHaveTextContent(en.common.choose)
    await user.click(trigger)
    for (const option of screen.getAllByRole('option')) {
      expect(option).toHaveAttribute('aria-selected', 'false')
    }
  })

  it('an option whose value is the empty string can be shown and chosen', async () => {
    const user = userEvent.setup()
    const options = [{ value: '', label: 'No topic' }, ...OPTIONS]
    const { onChange, trigger } = setup({ options, value: '' })

    expect(trigger).toHaveTextContent('No topic')
    await user.click(trigger)
    expect(screen.getByRole('option', { name: 'No topic' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('option', { name: 'Practice' }))
    expect(onChange.mock.calls).toEqual([['b']])
  })

  it('choosing the empty-string option reports the empty string', async () => {
    const user = userEvent.setup()
    const options = [{ value: '', label: 'No topic' }, ...OPTIONS]
    const { onChange, trigger } = setup({ options, value: 'b' })

    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'No topic' }))
    expect(onChange.mock.calls).toEqual([['']])
  })

  it('takes its own placeholder', () => {
    const { trigger } = setup({ value: 'gone', placeholder: 'No topic' })

    expect(trigger).toHaveTextContent('No topic')
  })

  it('an empty list of options renders the placeholder and does not throw', async () => {
    const user = userEvent.setup()
    const { onChange, trigger } = setup({ options: [], value: 'a' })

    expect(trigger).toHaveTextContent(en.common.choose)
    await user.click(trigger)
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not open when disabled', async () => {
    const user = userEvent.setup()
    const { trigger } = setup({ isDisabled: true })

    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger.className).toContain('data-[disabled]:bg-surface-muted')
    expect(trigger.className).not.toContain('opacity')
  })

  it('links its description to the trigger', () => {
    const { trigger } = setup({ description: 'You can change this later' })

    expect(trigger).toHaveAccessibleDescription('You can change this later')
  })

  it('an error message makes it invalid and is linked to the trigger', () => {
    const { trigger } = setup({ errorMessage: 'Pick a type' })

    expect(trigger).toHaveAccessibleDescription('Pick a type')
    // React Aria marks the field, not the button: the border of the trigger hangs on the group.
    const field = trigger.closest('[data-invalid]')
    expect(field).not.toBeNull()
    expect(field?.className).toContain('group')
    expect(trigger.className).toContain('group-data-[invalid]:border-danger')
    expect(screen.getByText('Pick a type').className).toContain('text-danger')
  })

  it('the keyboard focus in the list is a brand ring, also on the chosen option', async () => {
    const user = userEvent.setup()
    setup()

    await user.tab()
    await user.keyboard('{Enter}')
    const options = screen.getAllByRole('option')
    // The chosen option gets the focus first: its fill is the chosen one, so only the ring says focus.
    expect(options[0]).toHaveFocus()
    expect(options[0]).toHaveAttribute('data-selected', 'true')
    expect(options[0]).toHaveAttribute('data-focus-visible', 'true')
    for (const part of [
      'data-[focus-visible]:ring-2',
      'data-[focus-visible]:ring-brand',
      'data-[focus-visible]:ring-inset',
      'data-[focused]:bg-surface-muted',
    ]) {
      expect(options[0]?.className).toContain(part)
    }
    await user.keyboard('{ArrowDown}')
    expect(options[1]).toHaveAttribute('data-focus-visible', 'true')
    expect(options[0]).not.toHaveAttribute('data-focus-visible')
  })

  it('a pointer does not draw the ring on an option', async () => {
    const user = userEvent.setup()
    const { trigger } = setup()

    await user.click(trigger)
    await user.hover(screen.getByRole('option', { name: 'Practice' }))
    expect(screen.getByRole('option', { name: 'Practice' })).not.toHaveAttribute('data-focus-visible')
  })

  it('invalid and focused keeps the danger border, like a TextField', async () => {
    const user = userEvent.setup()
    const { trigger } = setup({ errorMessage: 'Pick a type' })

    await user.tab()
    expect(trigger).toHaveAttribute('data-focus-visible', 'true')
    expect(trigger.closest('[data-invalid]')).not.toBeNull()
    // Stacked, so it is more specific than data-[focus-visible]:border-brand.
    expect(trigger.className).toContain('group-data-[invalid]:data-[focus-visible]:border-danger')
    expect(trigger.className).toContain('data-[focus-visible]:ring-brand')
  })

  it('shows an option marked userContent through UserText, and keeps the plain textValue', async () => {
    const user = userEvent.setup()
    const options: readonly SelectOption[] = [
      { value: 'a', label: 'הסתברות', userContent: true },
      { value: 'b', label: 'Plain' },
    ]
    setup({ options, value: 'b' })

    await user.click(screen.getByRole('button', { name: /Type/ }))
    const items = screen.getAllByRole('option')
    expect(within(items[0] as HTMLElement).getByText('הסתברות').closest('[dir="auto"]')).not.toBeNull()
    expect(items[1]?.querySelector('[dir]')).toBeNull()
  })

  it('a chosen user-content value is cut at the end of the text by UserText, not by a second truncate', () => {
    const options: readonly SelectOption[] = [{ value: 'a', label: 'הסתברות '.repeat(20), userContent: true }]
    setup({ options, value: 'a' })
    const trigger = screen.getByRole('button', { name: /Type/ })
    const text = trigger.querySelector('[data-user-text]')
    expect(text).toHaveAttribute('dir', 'auto')
    expect(text).toHaveClass('user-text-truncate')
    expect(text?.parentElement).not.toHaveClass('truncate')
  })
})
