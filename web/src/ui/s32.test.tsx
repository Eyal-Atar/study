import { fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { ActionCard } from './ActionCard'
import { BlockCheck } from './BlockCheck'
import { CheckMarkIcon } from './icons'
import { ProgressRing } from './ProgressRing'

describe('BlockCheck', () => {
  it('is a toggle button with the given name and the state of the block', () => {
    const { rerender } = render(<BlockCheck isDone={false} onChange={vi.fn()} aria-label="Done: Expectation practice" />)
    const button = screen.getByRole('button', { name: 'Done: Expectation practice' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    rerender(<BlockCheck isDone onChange={vi.fn()} aria-label="Done: Expectation practice" />)
    expect(screen.getByRole('button', { name: 'Done: Expectation practice' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('asks for the opposite value with Space and with Enter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BlockCheck isDone={false} onChange={onChange} aria-label="Done" />)
    screen.getByRole('button', { name: 'Done' }).focus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith(true)
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('asks for false when it is done', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BlockCheck isDone onChange={onChange} aria-label="Done" />)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('does nothing when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BlockCheck isDone={false} onChange={onChange} aria-label="Done" isDisabled />)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('writes dataId as data-check, for the XP burst to find', () => {
    render(<BlockCheck isDone={false} onChange={vi.fn()} aria-label="Done" dataId="b1" />)
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('data-check', 'b1')
  })

  it('keeps the pointer-down from its parent, so a press does not start a drag', () => {
    const onParent = vi.fn()
    render(
      <div onPointerDown={onParent}>
        <BlockCheck isDone={false} onChange={vi.fn()} aria-label="Done" />
      </div>,
    )
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Done' }))
    expect(onParent).not.toHaveBeenCalled()
  })
})

describe('ProgressRing', () => {
  it('is a meter with the value, the maximum and the words', () => {
    render(<ProgressRing value={90} max={285} aria-label="Study this week" valueText="90 of 285 minutes" />)
    const meter = screen.getByRole('meter', { name: 'Study this week' })
    expect(meter).toHaveAttribute('aria-valuenow', '90')
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '285')
    expect(meter).toHaveAttribute('aria-valuetext', '90 of 285 minutes')
    expect(screen.getByText('32%')).toBeInTheDocument()
  })

  it('clips a value above the maximum', () => {
    render(<ProgressRing value={400} max={285} aria-label="Study" valueText="all" />)
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '285')
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('shows 0% and does not throw with a maximum of 0', () => {
    render(<ProgressRing value={5} max={0} aria-label="Study" valueText="none" />)
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('shows its children in the centre instead of the percentage', () => {
    render(
      <ProgressRing value={1} max={2} aria-label="Study" valueText="1 of 2">
        <span>Centre</span>
      </ProgressRing>,
    )
    expect(screen.getByText('Centre')).toBeInTheDocument()
    expect(screen.queryByText('50%')).not.toBeInTheDocument()
  })
})

describe('ActionCard', () => {
  it('is a button named by its title and described by its description', () => {
    render(<ActionCard icon={CheckMarkIcon} title="Find a time" description="I look for free hours." onPress={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Find a time' })
    expect(button).toHaveAccessibleDescription('I look for free hours.')
  })

  it('calls onPress', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(<ActionCard icon={CheckMarkIcon} title="Find a time" onPress={onPress} />)
    await user.click(screen.getByRole('button', { name: 'Find a time' }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does not call onPress when disabled or pending, and says it is loading', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    const { rerender } = render(<ActionCard icon={CheckMarkIcon} title="Find a time" onPress={onPress} isDisabled />)
    await user.click(screen.getByRole('button', { name: 'Find a time' }))
    rerender(<ActionCard icon={CheckMarkIcon} title="Find a time" onPress={onPress} isPending />)
    const button = screen.getByRole('button')
    await user.click(button)
    expect(onPress).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(en.common.loading)).toHaveClass('sr-only')
    expect(button).toHaveAccessibleName(`Find a time ${en.common.loading}`)
  })
})
