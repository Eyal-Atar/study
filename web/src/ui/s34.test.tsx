import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { Button } from './Button'
import { examColor } from './examColor'
import { ExamChip, ExamInitial, ExamProgressBar } from './ExamMark'
import { EveningIcon, MorningIcon, NightIcon, NoonIcon } from './icons'
import { IconChoiceCards } from './IconChoiceCards'
import { InkButton } from './InkButton'
import { Stepper } from './Stepper'
import { TileList, TileRow } from './TileList'

describe('TileList and TileRow', () => {
  it('is a named list of tiles on the surface, with a line and the corners of a card', () => {
    render(
      <TileList aria-label="Exams">
        <TileRow title="הסתברות" subtitle="10 December, 42% of the plan" />
        <TileRow title="אלגוריתמים" />
      </TileList>,
    )
    const list = screen.getByRole('list', { name: 'Exams' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveClass('rounded-card', 'border', 'border-line', 'bg-surface', 'p-3')
    expect(screen.getByText('10 December, 42% of the plan')).toHaveClass('text-ink-muted')
  })

  it('with `to` is one link named by its title, and a control in `trailing` is pressed separately', async () => {
    const user = userEvent.setup()
    const onMenu = vi.fn()
    render(
      <MemoryRouter initialEntries={['/exams']}>
        <Routes>
          <Route
            path="/exams"
            element={
              <TileList aria-label="Exams">
                <TileRow
                  to="/exams/e1"
                  title="הסתברות"
                  leading={<ExamInitial name="הסתברות" colorIndex={1} />}
                  trailing={
                    <Button variant="secondary" onPress={onMenu}>
                      Actions
                    </Button>
                  }
                  footer={<ExamProgressBar colorIndex={1} value={42} max={100} aria-label="Progress: הסתברות" valueText="42%" />}
                />
              </TileList>
            }
          />
          <Route path="/exams/e1" element={<p>The exam screen</p>} />
        </Routes>
      </MemoryRouter>,
    )
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName('הסתברות')
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    expect(onMenu).toHaveBeenCalledOnce()
    expect(screen.queryByText('The exam screen')).not.toBeInTheDocument()
    await user.click(links[0] as HTMLElement)
    expect(screen.getByText('The exam screen')).toBeInTheDocument()
  })

  it('with `onPress` is one button named by its title, reached and pressed with the keyboard', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(
      <TileList aria-label="Fixed hours">
        <TileRow title="עבודה" onPress={onPress} />
      </TileList>,
    )
    await user.tab()
    const button = screen.getByRole('button', { name: 'עבודה' })
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onPress).toHaveBeenCalledOnce()
  })
})

describe('Stepper', () => {
  const OPTIONS = [
    { value: 60, label: '1 hour' },
    { value: 120, label: '2 hours' },
    { value: 180, label: '3 hours' },
  ] as const

  function Demo({ initial, onChange }: { initial: number; onChange?: (value: number) => void }) {
    const [value, setValue] = useState(initial)
    return (
      <Stepper
        label="How many hours a day can you study?"
        caption="on a study day"
        value={value}
        options={OPTIONS}
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
      />
    )
  }

  it('is a group named by its label, with the value announced and the caption under it', () => {
    render(<Demo initial={120} />)
    const group = screen.getByRole('group', { name: 'How many hours a day can you study?' })
    const output = within(group).getByRole('status')
    expect(output).toHaveTextContent('2 hours')
    expect(output).toHaveAttribute('aria-live', 'polite')
    expect(within(group).getByText('2 hours')).toHaveClass('text-display', 'font-bold', 'tabular-nums')
    expect(within(group).getByText('on a study day')).toBeInTheDocument()
  })

  it('"less" comes first and "more" last (left to right), and "more" moves to the next value of the list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Demo initial={60} onChange={onChange} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveAccessibleName(en.controls.stepper.less)
    expect(buttons[1]).toHaveAccessibleName(en.controls.stepper.more)
    await user.click(screen.getByRole('button', { name: en.controls.stepper.more }))
    expect(onChange).toHaveBeenLastCalledWith(120)
    expect(screen.getByRole('status')).toHaveTextContent('2 hours')
  })

  it('turns a button off at its end of the list', () => {
    const { unmount } = render(<Demo initial={180} />)
    expect(screen.getByRole('button', { name: en.controls.stepper.more })).toBeDisabled()
    expect(screen.getByRole('button', { name: en.controls.stepper.less })).toBeEnabled()
    unmount()
    render(<Demo initial={60} />)
    expect(screen.getByRole('button', { name: en.controls.stepper.less })).toBeDisabled()
  })

  it('keeps the keyboard focus inside when the pressed button turns off', async () => {
    const user = userEvent.setup()
    render(<Demo initial={120} />)
    // Less comes first in the tab order, More second.
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: en.controls.stepper.more })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: en.controls.stepper.more })).toBeDisabled()
    expect(screen.getByRole('button', { name: en.controls.stepper.less })).toHaveFocus()
  })

  it('changes with the up and down arrows on the group', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Demo initial={120} onChange={onChange} />)
    await user.tab()
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(180)
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith(60)
    // At the end the arrow does nothing.
    onChange.mockClear()
    await user.keyboard('{ArrowDown}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('takes the names of its buttons from props', () => {
    render(
      <Stepper label="Hours" value={60} options={OPTIONS} onChange={vi.fn()} moreLabel="One more hour" lessLabel="One hour less" />,
    )
    expect(screen.getByRole('button', { name: 'One more hour' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'One hour less' })).toBeInTheDocument()
  })
})

describe('IconChoiceCards', () => {
  const WINDOWS = [
    { value: 'morning', label: 'Morning', description: '06:00–12:00', icon: MorningIcon },
    { value: 'noon', label: 'Noon', description: '12:00–17:00', icon: NoonIcon },
    { value: 'evening', label: 'Evening', description: '17:00–21:00', icon: EveningIcon },
    { value: 'night', label: 'Night', description: '21:00–02:00', icon: NightIcon },
  ] as const

  function Demo({ onChange, errorMessage }: { onChange: (value: string[]) => void; errorMessage?: string }) {
    const [value, setValue] = useState<string[]>([])
    return (
      <IconChoiceCards
        label='When do you like to study?'
        options={WINDOWS}
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
        errorMessage={errorMessage}
      />
    )
  }

  it('is a group of checkboxes, each named by its label', () => {
    render(<Demo onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'When do you like to study?' })).toBeInTheDocument()
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(4)
    expect(screen.getByRole('checkbox', { name: /Morning/ })).not.toBeChecked()
  })

  it('choosing two returns both, and a chosen tile shows a check mark, not only a colour', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(<Demo onChange={onChange} />)
    await user.click(screen.getByRole('checkbox', { name: /Morning/ }))
    await user.click(screen.getByRole('checkbox', { name: /Evening/ }))
    expect(onChange).toHaveBeenLastCalledWith(['morning', 'evening'])
    expect(screen.getByRole('checkbox', { name: /Morning/ })).toBeChecked()
    const marks = container.querySelectorAll('[data-check]')
    expect(marks).toHaveLength(2)
    // The mark is the CheckMarkIcon: an svg, hidden from a screen reader.
    expect(marks[0]?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('toggles with Space from the keyboard, and the range reads left to right', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Demo onChange={onChange} />)
    await user.tab()
    expect(screen.getByRole('checkbox', { name: /Morning/ })).toHaveFocus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith(['morning'])
    expect(screen.getByText('06:00–12:00')).toHaveAttribute('dir', 'ltr')
  })

  it('an error is shown and links to the group', () => {
    render(<Demo onChange={vi.fn()} errorMessage='Choose at least one window' />)
    expect(screen.getByText('Choose at least one window')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'When do you like to study?' })).toHaveAccessibleDescription('Choose at least one window')
  })
})

describe('ExamMark', () => {
  it('ExamInitial is the first letter on the soft colour of the exam, hidden from a screen reader', () => {
    const { container } = render(<ExamInitial name="הסתברות" colorIndex={1} />)
    const mark = container.firstElementChild
    expect(mark).toHaveTextContent('ה')
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark).toHaveClass(examColor(1).soft, examColor(1).text, 'size-[42px]', 'rounded-[13px]', 'text-title', 'font-bold')
  })

  it('ExamInitial lg is 44px, and a name in quotes or spaces starts at its first letter', () => {
    const { container } = render(<ExamInitial name={'  "שפת C"'} colorIndex={2} size="lg" />)
    expect(container.firstElementChild).toHaveTextContent(/^ש$/)
    expect(container.firstElementChild).toHaveClass('size-[44px]')
  })

  it('ExamProgressBar is a progressbar with its value in words, filled in the colour of the exam', () => {
    const { container } = render(
      <ExamProgressBar colorIndex={3} value={30} max={120} aria-label="Progress: הסתברות" valueText="25% of the plan" />,
    )
    const bar = screen.getByRole('progressbar', { name: 'Progress: הסתברות' })
    expect(bar).toHaveAttribute('aria-valuetext', '25% of the plan')
    const fill = container.querySelector('[data-fill]')
    expect(fill).toHaveClass(examColor(3).solid)
    expect(fill).toHaveStyle({ width: '25%' })
  })

  it('ExamProgressBar with nothing to do is empty, without a division by zero', () => {
    const { container } = render(
      <ExamProgressBar colorIndex={0} value={0} max={0} aria-label="Progress: הסתברות" valueText="No tasks yet" />,
    )
    expect(container.querySelector('[data-fill]')).toHaveStyle({ width: '0%' })
  })

  it('ExamChip is a pill in the soft colour of the exam with its line, and ink text', () => {
    render(<ExamChip colorIndex={1}>22 days</ExamChip>)
    expect(screen.getByText('22 days')).toHaveClass(examColor(1).soft, examColor(1).line, 'text-ink', 'rounded-full', 'tabular-nums')
  })
})

describe('InkButton', () => {
  it('is a dark button named by its text, with the inverse colours', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(<InkButton onPress={onPress}>Continue with Google</InkButton>)
    const button = screen.getByRole('button', { name: 'Continue with Google' })
    expect(button).toHaveClass('bg-inverse', 'text-on-inverse', 'min-h-touch')
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('while pending it keeps its name and ignores presses', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(
      <InkButton isPending onPress={onPress}>
        Continue with Google
      </InkButton>,
    )
    const button = screen.getByRole('button', { name: /Continue with Google/ })
    await user.click(button)
    expect(onPress).not.toHaveBeenCalled()
  })
})
