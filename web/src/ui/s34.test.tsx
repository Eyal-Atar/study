import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Clock, Moon, Sun, Sunrise } from 'lucide-react'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { he } from '../i18n/he'
import { Button } from './Button'
import { examColor } from './examColor'
import { ExamChip, ExamInitial, ExamProgressBar } from './ExamMark'
import { IconChoiceCards } from './IconChoiceCards'
import { InkButton } from './InkButton'
import { Stepper } from './Stepper'
import { TileList, TileRow } from './TileList'

describe('TileList and TileRow', () => {
  it('is a named list of tiles on the surface, with a line and the corners of a card', () => {
    render(
      <TileList aria-label="המבחנים">
        <TileRow title="הסתברות" subtitle="10 בדצמבר, 42% מהתוכנית" />
        <TileRow title="אלגוריתמים" />
      </TileList>,
    )
    const list = screen.getByRole('list', { name: 'המבחנים' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveClass('rounded-card', 'border', 'border-line', 'bg-surface', 'p-3')
    expect(screen.getByText('10 בדצמבר, 42% מהתוכנית')).toHaveClass('text-ink-muted')
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
              <TileList aria-label="המבחנים">
                <TileRow
                  to="/exams/e1"
                  title="הסתברות"
                  leading={<ExamInitial name="הסתברות" colorIndex={1} />}
                  trailing={
                    <Button variant="secondary" onPress={onMenu}>
                      פעולות
                    </Button>
                  }
                  footer={<ExamProgressBar colorIndex={1} value={42} max={100} aria-label="התקדמות: הסתברות" valueText="42%" />}
                />
              </TileList>
            }
          />
          <Route path="/exams/e1" element={<p>מסך המבחן</p>} />
        </Routes>
      </MemoryRouter>,
    )
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName('הסתברות')
    await user.click(screen.getByRole('button', { name: 'פעולות' }))
    expect(onMenu).toHaveBeenCalledOnce()
    expect(screen.queryByText('מסך המבחן')).not.toBeInTheDocument()
    await user.click(links[0] as HTMLElement)
    expect(screen.getByText('מסך המבחן')).toBeInTheDocument()
  })

  it('with `onPress` is one button named by its title, reached and pressed with the keyboard', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(
      <TileList aria-label="לו״ז קבוע">
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
    { value: 60, label: 'שעה' },
    { value: 120, label: 'שעתיים' },
    { value: 180, label: '3 שעות' },
  ] as const

  function Demo({ initial, onChange }: { initial: number; onChange?: (value: number) => void }) {
    const [value, setValue] = useState(initial)
    return (
      <Stepper
        label="כמה שעות ביום אפשר ללמוד?"
        caption="ביום לימוד"
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
    const group = screen.getByRole('group', { name: 'כמה שעות ביום אפשר ללמוד?' })
    const output = within(group).getByRole('status')
    expect(output).toHaveTextContent('שעתיים')
    expect(output).toHaveAttribute('aria-live', 'polite')
    expect(within(group).getByText('שעתיים')).toHaveClass('text-display', 'font-bold', 'tabular-nums')
    expect(within(group).getByText('ביום לימוד')).toBeInTheDocument()
  })

  it('"more" comes first (on the right in RTL), and moves to the next value of the list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Demo initial={60} onChange={onChange} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveAccessibleName(he.s34ui.stepper.more)
    expect(buttons[1]).toHaveAccessibleName(he.s34ui.stepper.less)
    await user.click(screen.getByRole('button', { name: he.s34ui.stepper.more }))
    expect(onChange).toHaveBeenLastCalledWith(120)
    expect(screen.getByRole('status')).toHaveTextContent('שעתיים')
  })

  it('turns a button off at its end of the list', () => {
    const { unmount } = render(<Demo initial={180} />)
    expect(screen.getByRole('button', { name: he.s34ui.stepper.more })).toBeDisabled()
    expect(screen.getByRole('button', { name: he.s34ui.stepper.less })).toBeEnabled()
    unmount()
    render(<Demo initial={60} />)
    expect(screen.getByRole('button', { name: he.s34ui.stepper.less })).toBeDisabled()
  })

  it('keeps the keyboard focus inside when the pressed button turns off', async () => {
    const user = userEvent.setup()
    render(<Demo initial={120} />)
    await user.tab()
    expect(screen.getByRole('button', { name: he.s34ui.stepper.more })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: he.s34ui.stepper.more })).toBeDisabled()
    expect(screen.getByRole('button', { name: he.s34ui.stepper.less })).toHaveFocus()
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
      <Stepper label="שעות" value={60} options={OPTIONS} onChange={vi.fn()} moreLabel="עוד שעה" lessLabel="שעה פחות" />,
    )
    expect(screen.getByRole('button', { name: 'עוד שעה' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שעה פחות' })).toBeInTheDocument()
  })
})

describe('IconChoiceCards', () => {
  const WINDOWS = [
    { value: 'morning', label: 'בוקר', description: '06:00–12:00', icon: Sunrise },
    { value: 'noon', label: 'צהריים', description: '12:00–17:00', icon: Sun },
    { value: 'evening', label: 'ערב', description: '17:00–21:00', icon: Clock },
    { value: 'night', label: 'לילה', description: '21:00–02:00', icon: Moon },
  ] as const

  function Demo({ onChange, errorMessage }: { onChange: (value: string[]) => void; errorMessage?: string }) {
    const [value, setValue] = useState<string[]>([])
    return (
      <IconChoiceCards
        label="מתי נוח לכם ללמוד?"
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
    expect(screen.getByRole('group', { name: 'מתי נוח לכם ללמוד?' })).toBeInTheDocument()
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(4)
    expect(screen.getByRole('checkbox', { name: /בוקר/ })).not.toBeChecked()
  })

  it('choosing two returns both, and a chosen tile shows a ✓, not only a colour', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(<Demo onChange={onChange} />)
    await user.click(screen.getByRole('checkbox', { name: /בוקר/ }))
    await user.click(screen.getByRole('checkbox', { name: /ערב/ }))
    expect(onChange).toHaveBeenLastCalledWith(['morning', 'evening'])
    expect(screen.getByRole('checkbox', { name: /בוקר/ })).toBeChecked()
    expect(container.querySelectorAll('[data-check]')).toHaveLength(2)
  })

  it('toggles with Space from the keyboard, and the range reads left to right', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Demo onChange={onChange} />)
    await user.tab()
    expect(screen.getByRole('checkbox', { name: /בוקר/ })).toHaveFocus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith(['morning'])
    expect(screen.getByText('06:00–12:00')).toHaveAttribute('dir', 'ltr')
  })

  it('an error is shown and links to the group', () => {
    render(<Demo onChange={vi.fn()} errorMessage="בחרו לפחות חלון אחד" />)
    expect(screen.getByText('בחרו לפחות חלון אחד')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'מתי נוח לכם ללמוד?' })).toHaveAccessibleDescription('בחרו לפחות חלון אחד')
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
      <ExamProgressBar colorIndex={3} value={30} max={120} aria-label="התקדמות: הסתברות" valueText="25% מהתוכנית" />,
    )
    const bar = screen.getByRole('progressbar', { name: 'התקדמות: הסתברות' })
    expect(bar).toHaveAttribute('aria-valuetext', '25% מהתוכנית')
    const fill = container.querySelector('[data-fill]')
    expect(fill).toHaveClass(examColor(3).solid)
    expect(fill).toHaveStyle({ width: '25%' })
  })

  it('ExamProgressBar with nothing to do is empty, without a division by zero', () => {
    const { container } = render(
      <ExamProgressBar colorIndex={0} value={0} max={0} aria-label="התקדמות: הסתברות" valueText="עוד אין משימות" />,
    )
    expect(container.querySelector('[data-fill]')).toHaveStyle({ width: '0%' })
  })

  it('ExamChip is a pill in the soft colour of the exam with its line, and ink text', () => {
    render(<ExamChip colorIndex={1}>22 ימים</ExamChip>)
    expect(screen.getByText('22 ימים')).toHaveClass(examColor(1).soft, examColor(1).line, 'text-ink', 'rounded-full', 'tabular-nums')
  })
})

describe('InkButton', () => {
  it('is a dark button named by its text, with the inverse colours', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(<InkButton onPress={onPress}>המשך עם Google</InkButton>)
    const button = screen.getByRole('button', { name: 'המשך עם Google' })
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
        המשך עם Google
      </InkButton>,
    )
    const button = screen.getByRole('button', { name: /המשך עם Google/ })
    await user.click(button)
    expect(onPress).not.toHaveBeenCalled()
  })
})
