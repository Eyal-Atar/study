import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CheckboxCards } from './CheckboxCards'
import { OPTION_CLASS, RadioCards, type ChoiceOption } from './RadioCards'

const LEVELS: readonly ChoiceOption[] = [
  { value: 'easy', label: 'קל' },
  { value: 'medium', label: 'בינוני', description: '90 דקות' },
  { value: 'hard', label: 'קשה' },
]

function Radios({ onChange, isDisabled }: { onChange: (value: string) => void; isDisabled?: boolean }) {
  const [value, setValue] = useState('easy')
  return (
    <RadioCards
      label="רמת קושי"
      options={LEVELS}
      value={value}
      isDisabled={isDisabled}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

function Checks({ onChange, errorId }: { onChange: (value: string[]) => void; errorId?: string }) {
  const [value, setValue] = useState<string[]>(['easy'])
  return (
    <>
      <CheckboxCards
        label="ימי לימוד"
        description="לפחות יום אחד"
        options={LEVELS}
        value={value}
        errorId={errorId}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
      <p id="days-error" role="alert">
        צריך לבחור יום
      </p>
    </>
  )
}

describe('the look of an option', () => {
  it('uses only the tokens: touch height, control radius, the focus ring, and no opacity when disabled', () => {
    for (const part of [
      'min-h-touch',
      'rounded-control',
      'border-line-strong',
      'text-small',
      'data-[selected]:border-brand',
      'data-[selected]:bg-brand-soft',
      'data-[selected]:text-brand-strong',
      'data-[selected]:font-semibold',
      'data-[focus-visible]:ring-2',
      'data-[focus-visible]:ring-brand',
      'data-[disabled]:bg-surface-muted',
      'data-[disabled]:text-ink-muted',
    ]) {
      expect(OPTION_CLASS).toContain(part)
    }
    expect(OPTION_CLASS).not.toMatch(/opacity|min-h-11|rounded-lg|font-medium|text-sm\b/)
  })
})

describe('RadioCards', () => {
  it('is a radiogroup named by its label, with a radio for each option', () => {
    render(<Radios onChange={vi.fn()} />)

    const group = screen.getByRole('radiogroup', { name: 'רמת קושי' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(within(group).getByRole('radio', { name: /קל/ })).toBeChecked()
    expect(within(group).getByRole('radio', { name: /בינוני/ })).not.toBeChecked()
    expect(within(group).getByText('90 דקות').className).toContain('text-caption')
    expect(within(group).getByText('רמת קושי').className).toContain('text-small font-semibold')
  })

  it('the arrow keys move the choice and report it, with a visible focus', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Radios onChange={onChange} />)

    await user.tab()
    const easy = screen.getByRole('radio', { name: /קל/ })
    expect(easy).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    const medium = screen.getByRole('radio', { name: /בינוני/ })
    expect(medium).toHaveFocus()
    expect(medium).toBeChecked()
    expect(onChange.mock.calls).toEqual([['medium']])

    // The box that is drawn is the one that carries the state and the ring.
    const card = medium.closest('[data-focus-visible]')
    expect(card).not.toBeNull()
    expect(card).toHaveAttribute('data-selected', 'true')
    expect(card?.className).toContain('data-[focus-visible]:ring-2')

    await user.keyboard('{ArrowUp}')
    expect(onChange.mock.calls).toEqual([['medium'], ['easy']])
  })

  it('a click chooses', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Radios onChange={onChange} />)

    await user.click(screen.getByText('קשה'))
    expect(onChange.mock.calls).toEqual([['hard']])
    expect(screen.getByRole('radio', { name: /קשה/ })).toBeChecked()
  })

  it('does nothing when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Radios onChange={onChange} isDisabled />)

    await user.click(screen.getByText('קשה'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: /קשה/ })).toBeDisabled()
  })
})

describe('CheckboxCards', () => {
  it('is a group named by its label and described by its description', () => {
    render(<Checks onChange={vi.fn()} />)

    const group = screen.getByRole('group', { name: 'ימי לימוד' })
    expect(group).toHaveAccessibleDescription('לפחות יום אחד')
    expect(within(group).getAllByRole('checkbox')).toHaveLength(3)
    expect(within(group).getByRole('checkbox', { name: /קל/ })).toBeChecked()
  })

  it('Space toggles the focused option and reports the whole list, with a visible focus', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checks onChange={onChange} />)

    await user.tab()
    await user.tab()
    const medium = screen.getByRole('checkbox', { name: /בינוני/ })
    expect(medium).toHaveFocus()
    const card = medium.closest('[data-focus-visible]')
    expect(card).not.toBeNull()
    expect(card?.className).toContain('data-[focus-visible]:ring-2')

    await user.keyboard(' ')
    expect(onChange.mock.calls).toEqual([[['easy', 'medium']]])
    expect(medium).toBeChecked()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith(['easy'])
    expect(medium).not.toBeChecked()
  })

  it('errorId links an error shown elsewhere and makes the group invalid', () => {
    render(<Checks onChange={vi.fn()} errorId="days-error" />)

    const group = screen.getByRole('group', { name: 'ימי לימוד' })
    expect(group.getAttribute('aria-describedby')).toContain('days-error')
    expect(group).toHaveAccessibleDescription(/צריך לבחור יום/)
    expect(group).toHaveAttribute('data-invalid', 'true')
  })
})
