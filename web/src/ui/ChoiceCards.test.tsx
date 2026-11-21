import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CheckboxCards } from './CheckboxCards'
import { OPTION_CLASS, RadioCards, type ChoiceOption } from './RadioCards'

const LEVELS: readonly ChoiceOption[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium', description: '90 minutes' },
  { value: 'hard', label: 'Hard' },
]

function Radios({
  onChange,
  isDisabled,
  description,
  errorMessage,
}: {
  onChange: (value: string) => void
  isDisabled?: boolean
  description?: string
  errorMessage?: string
}) {
  const [value, setValue] = useState('easy')
  return (
    <RadioCards
      label="Difficulty"
      options={LEVELS}
      value={value}
      isDisabled={isDisabled}
      description={description}
      errorMessage={errorMessage}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

function Checks({
  onChange,
  errorId,
  errorMessage,
}: {
  onChange: (value: string[]) => void
  errorId?: string
  errorMessage?: string
}) {
  const [value, setValue] = useState<string[]>(['easy'])
  return (
    <>
      <CheckboxCards
        label="Study days"
        description="At least one day"
        options={LEVELS}
        value={value}
        errorId={errorId}
        errorMessage={errorMessage}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
      <p id="days-error" role="alert">
        Pick a day
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

    const group = screen.getByRole('radiogroup', { name: 'Difficulty' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(within(group).getByRole('radio', { name: /Easy/ })).toBeChecked()
    expect(within(group).getByRole('radio', { name: /Medium/ })).not.toBeChecked()
    expect(within(group).getByText('90 minutes').className).toContain('text-caption')
    expect(within(group).getByText('Difficulty').className).toContain('text-small font-medium')
  })

  it('the arrow keys move the choice and report it, with a visible focus', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Radios onChange={onChange} />)

    await user.tab()
    const easy = screen.getByRole('radio', { name: /Easy/ })
    expect(easy).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    const medium = screen.getByRole('radio', { name: /Medium/ })
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

    await user.click(screen.getByText('Hard'))
    expect(onChange.mock.calls).toEqual([['hard']])
    expect(screen.getByRole('radio', { name: /Hard/ })).toBeChecked()
  })

  it('does nothing when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Radios onChange={onChange} isDisabled />)

    await user.click(screen.getByText('Hard'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: /Hard/ })).toBeDisabled()
  })

  it('without a description or an error the group is neither described nor invalid', () => {
    render(<Radios onChange={vi.fn()} />)

    const group = screen.getByRole('radiogroup', { name: 'Difficulty' })
    expect(group).not.toHaveAttribute('aria-describedby')
    expect(group).not.toHaveAttribute('aria-invalid')
  })

  it('links its description to the group', () => {
    render(<Radios onChange={vi.fn()} description="You can change this later" />)

    const group = screen.getByRole('radiogroup', { name: 'Difficulty' })
    expect(group).toHaveAccessibleDescription('You can change this later')
    expect(screen.getByText('You can change this later').className).toContain('text-small text-ink-muted')
  })

  it('an error message is shown under the options, linked to the group, and makes it invalid', () => {
    render(<Radios onChange={vi.fn()} description="You can change this later" errorMessage="Pick a level" />)

    const group = screen.getByRole('radiogroup', { name: 'Difficulty' })
    const error = screen.getByText('Pick a level')
    expect(error.className).toContain('text-small text-danger')
    expect(group).toHaveAttribute('aria-invalid', 'true')
    expect(group).toHaveAttribute('aria-describedby')
    expect(group).toHaveAccessibleDescription(/Pick a level/)
    expect(group).toHaveAccessibleDescription(/You can change this later/)
    // Under the options: the error comes after the last radio in the document.
    const radios = within(group).getAllByRole('radio')
    const last = radios[radios.length - 1] as HTMLElement
    expect(last.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('CheckboxCards', () => {
  it('is a group named by its label and described by its description', () => {
    render(<Checks onChange={vi.fn()} />)

    const group = screen.getByRole('group', { name: 'Study days' })
    expect(group).toHaveAccessibleDescription('At least one day')
    expect(within(group).getAllByRole('checkbox')).toHaveLength(3)
    expect(within(group).getByRole('checkbox', { name: /Easy/ })).toBeChecked()
  })

  it('Space toggles the focused option and reports the whole list, with a visible focus', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checks onChange={onChange} />)

    await user.tab()
    await user.tab()
    const medium = screen.getByRole('checkbox', { name: /Medium/ })
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

    const group = screen.getByRole('group', { name: 'Study days' })
    expect(group.getAttribute('aria-describedby')).toContain('days-error')
    expect(group).toHaveAccessibleDescription(/Pick a day/)
    expect(group).toHaveAttribute('data-invalid', 'true')
  })

  it('an error message is shown under the options, linked to the group, and makes it invalid', () => {
    render(<Checks onChange={vi.fn()} errorMessage="Pick at least one day" />)

    const group = screen.getByRole('group', { name: 'Study days' })
    const error = within(group).getByText('Pick at least one day')
    expect(error.className).toContain('text-small text-danger')
    expect(group).toHaveAttribute('data-invalid', 'true')
    expect(group).toHaveAccessibleDescription(/Pick at least one day/)
    // The description stays linked too, and the error shown elsewhere is not.
    expect(group).toHaveAccessibleDescription(/At least one day/)
    expect(group.getAttribute('aria-describedby')).not.toContain('days-error')
  })

  it('errorMessage and errorId together: both are linked', () => {
    render(<Checks onChange={vi.fn()} errorId="days-error" errorMessage="Pick at least one day" />)

    const group = screen.getByRole('group', { name: 'Study days' })
    const own = within(group).getByText('Pick at least one day')
    const ids = (group.getAttribute('aria-describedby') ?? '').split(' ')
    expect(ids).toContain('days-error')
    expect(ids).toContain(own.id)
    expect(group).toHaveAttribute('data-invalid', 'true')
  })

  it('without an error the group is not invalid', () => {
    render(<Checks onChange={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Study days' })).not.toHaveAttribute('data-invalid')
  })
})

describe('an option with an icon', () => {
  it('shows the icon before the label, as decoration, in both kinds of cards', () => {
    const options = [
      { value: 'morning', label: 'Morning', icon: <svg data-testid="sun" aria-hidden="true" /> },
      { value: 'night', label: 'Night' },
    ]
    const { unmount } = render(<CheckboxCards label="When" options={options} value={[]} onChange={() => undefined} />)
    const sun = screen.getByTestId('sun')
    expect(sun.compareDocumentPosition(screen.getByText('Morning')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Morning' })).toBeInTheDocument()
    unmount()
    render(<RadioCards label="When" options={options} value="night" onChange={() => undefined} />)
    expect(screen.getByTestId('sun')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Morning' })).toBeInTheDocument()
  })
})
