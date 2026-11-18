import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CheckButton } from './CheckButton'

const NAME = 'בוצע: תרגול תוחלת'

function circleOf(button: HTMLElement): HTMLElement {
  const circle = button.firstElementChild
  if (!(circle instanceof HTMLElement)) throw new Error('no circle')
  return circle
}

describe('CheckButton', () => {
  it('is a 44px button named by its aria-label, with the empty 22px box of the prototype while not done', () => {
    render(<CheckButton isDone={false} onChange={vi.fn()} aria-label={NAME} />)
    const button = screen.getByRole('button', { name: NAME })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveClass('size-touch', 'rounded-control', 'outline-none', 'data-[focus-visible]:ring-2', 'data-[focus-visible]:ring-brand')
    const circle = circleOf(button)
    expect(circle).toHaveClass('size-5.5', 'rounded-[7px]', 'border-2', 'border-line-strong', 'bg-surface')
    expect(circle).not.toHaveClass('rounded-full')
    expect(circle).not.toHaveClass('bg-success')
    expect(button.querySelector('svg')).toBeNull()
  })

  it('when done it is pressed, filled with success, and shows the check', () => {
    render(<CheckButton isDone onChange={vi.fn()} aria-label={NAME} />)
    const button = screen.getByRole('button', { name: NAME })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    const circle = circleOf(button)
    expect(circle).toHaveClass('size-5.5', 'rounded-[7px]', 'border-2', 'border-success', 'bg-success', 'text-on-brand')
    expect(circle).not.toHaveClass('border-line-strong', 'bg-surface')
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it.each([
    [false, true],
    [true, false],
  ])('a click, Space and Enter each ask for the other state (isDone %s -> %s)', async (isDone, asked) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CheckButton isDone={isDone} onChange={onChange} aria-label={NAME} />)
    const button = screen.getByRole('button', { name: NAME })

    await user.click(button)
    expect(onChange).toHaveBeenLastCalledWith(asked)
    await user.keyboard(' ')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(onChange.mock.calls).toEqual([[asked], [asked], [asked]])
    // Controlled: it shows what it is given, not what was asked.
    expect(button).toHaveAttribute('aria-pressed', String(isDone))
  })

  it('takes the keyboard focus with the ring state', async () => {
    const user = userEvent.setup()
    render(<CheckButton isDone={false} onChange={vi.fn()} aria-label={NAME} />)
    await user.tab()
    const button = screen.getByRole('button', { name: NAME })
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('data-focus-visible', 'true')
  })

  it('the circle takes the quiet fill under the pointer only while not done', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CheckButton isDone={false} onChange={vi.fn()} aria-label={NAME} />)
    const button = screen.getByRole('button', { name: NAME })
    await user.hover(button)
    expect(circleOf(button)).toHaveClass('bg-surface-muted', 'border-line-strong')
    expect(circleOf(button)).not.toHaveClass('bg-surface')

    rerender(<CheckButton isDone onChange={vi.fn()} aria-label={NAME} />)
    expect(circleOf(button)).toHaveClass('bg-success')
    expect(circleOf(button)).not.toHaveClass('bg-surface-muted')
  })

  it.each([
    [false, ['border-line', 'bg-surface-muted']],
    [true, ['border-line-strong', 'bg-line-strong', 'text-on-brand']],
  ] as const)('disabled (isDone %s): muted, never transparent, and it does not press', async (isDone, classes) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CheckButton isDone={isDone} isDisabled onChange={onChange} aria-label={NAME} />)
    const button = screen.getByRole('button', { name: NAME })
    expect(button).toBeDisabled()
    expect(button).toHaveClass('data-[disabled]:cursor-not-allowed')
    const circle = circleOf(button)
    expect(circle).toHaveClass(...classes)
    expect(circle).not.toHaveClass('bg-success', 'border-success')
    expect(circle.className).not.toMatch(/opacity/)
    expect(button.querySelector('svg') !== null).toBe(isDone)

    await user.click(button)
    expect(onChange).not.toHaveBeenCalled()
  })
})
