import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

const NAME = 'Day view'
const OPTIONS = [
  { id: 'list', label: 'List' },
  { id: 'timeline', label: 'Timeline' },
] as const
type View = (typeof OPTIONS)[number]['id']

// The control is controlled, so the keyboard tests need an owner of the value.
function Owner({ onChange }: { onChange: (value: View) => void }) {
  const [value, setValue] = useState<View>('list')
  return (
    <SegmentedControl
      aria-label={NAME}
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

describe('SegmentedControl', () => {
  it('is a named radiogroup with a radio for each option, and the chosen one is checked', () => {
    render(<SegmentedControl aria-label={NAME} options={OPTIONS} value="timeline" onChange={vi.fn()} />)
    const group = screen.getByRole('radiogroup', { name: NAME })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.textContent)).toEqual(['List', 'Timeline'])
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Timeline' })).toHaveAttribute('aria-checked', 'true')
  })

  it('the track is a quiet fill, and only the chosen option is a raised, lined surface', () => {
    render(<SegmentedControl aria-label={NAME} options={OPTIONS} value="list" onChange={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: NAME })).toHaveClass('bg-surface-muted', 'rounded-control', 'p-0.75', 'auto-cols-fr')

    const chosen = screen.getByRole('radio', { name: 'List' })
    expect(chosen).toHaveClass('min-h-touch', 'px-3', 'text-small', 'font-medium', 'border', 'rounded-[8px]')
    // The .seg of the prototype: raised by a shadow, and set apart by a 3:1 line as well, since a
    // shadow alone is too faint to carry the choice.
    expect(chosen).toHaveClass('bg-surface', 'shadow-raised', 'text-ink', 'border-line-strong')
    expect(chosen).toHaveClass('outline-none', 'data-[focus-visible]:ring-2', 'data-[focus-visible]:ring-brand')
    expect(chosen.className).not.toMatch(/opacity/)

    const other = screen.getByRole('radio', { name: 'Timeline' })
    expect(other).toHaveClass('min-h-touch', 'border', 'border-transparent', 'text-ink-muted')
    expect(other).not.toHaveClass('bg-surface', 'border-line-strong', 'shadow-raised')
  })

  it('a click on another option asks for its id, and shows only what it is given', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SegmentedControl aria-label={NAME} options={OPTIONS} value="list" onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: 'Timeline' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('timeline')
    // Controlled: the owner has not changed the value.
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Timeline' })).toHaveAttribute('aria-checked', 'false')
  })

  it('a click on the chosen option does not clear the choice', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SegmentedControl aria-label={NAME} options={OPTIONS} value="list" onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: 'List' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true')
  })

  it('is one Tab stop; the arrows move between the options, and Space chooses', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <Owner onChange={onChange} />
        <button type="button">After</button>
      </>,
    )
    const list = screen.getByRole('radio', { name: 'List' })
    const timeline = screen.getByRole('radio', { name: 'Timeline' })

    await user.tab()
    expect(list).toHaveFocus()
    expect(list).toHaveAttribute('data-focus-visible', 'true')

    // The test renders without a locale, so the direction is LTR and "next" is the right arrow.
    await user.keyboard('{ArrowRight}')
    expect(timeline).toHaveFocus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith('timeline')
    expect(timeline).toHaveAttribute('aria-checked', 'true')
    expect(list).toHaveAttribute('aria-checked', 'false')

    await user.keyboard('{ArrowLeft}')
    expect(list).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
  })

  it('the option under the pointer darkens its text only while it is not the chosen one', async () => {
    const user = userEvent.setup()
    render(<SegmentedControl aria-label={NAME} options={OPTIONS} value="list" onChange={vi.fn()} />)
    const other = screen.getByRole('radio', { name: 'Timeline' })

    await user.hover(other)

    expect(other).toHaveClass('text-ink', 'border-transparent')
    expect(other).not.toHaveClass('text-ink-muted', 'bg-surface')
  })
})
