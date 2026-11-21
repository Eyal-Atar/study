import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Disclosure } from './Disclosure'

describe('Disclosure', () => {
  it('starts closed: a button named by the label, and content that is not visible', () => {
    render(<Disclosure label="Why this task">It appears in every past exam.</Disclosure>)
    const trigger = screen.getByRole('button', { name: 'Why this task' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('It appears in every past exam.')).not.toBeVisible()
    // The look of the design language: a 44px target in the green of text (brand-strong), never an underline.
    expect(trigger).toHaveClass('min-h-touch', 'text-small', 'font-medium', 'text-brand-strong')
    expect(trigger.className).not.toMatch(/underline/)
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('opens and closes with Enter and with Space, and the button points to its panel', async () => {
    const user = userEvent.setup()
    render(<Disclosure label="Why this task">It appears in every past exam.</Disclosure>)
    const trigger = screen.getByRole('button', { name: 'Why this task' })
    const content = screen.getByText('It appears in every past exam.')

    await user.tab()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('data-focus-visible')
    expect(trigger.className).toContain('data-[focus-visible]:ring-2')

    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(content).toBeVisible()
    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
    expect(panel).not.toBeNull()
    expect(panel).toContainElement(content)

    await user.keyboard(' ')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(content).not.toBeVisible()

    await user.keyboard(' ')
    expect(content).toBeVisible()
    await user.keyboard('{Enter}')
    expect(content).not.toBeVisible()
  })

  it('opens with a click', async () => {
    const user = userEvent.setup()
    render(<Disclosure label="Where is this from">Question 2 in every past exam</Disclosure>)
    await user.click(screen.getByRole('button', { name: 'Where is this from' }))
    expect(screen.getByText('Question 2 in every past exam')).toBeVisible()
    expect(screen.getByText('Question 2 in every past exam')).toHaveClass('rounded-control', 'bg-surface-muted', 'text-small', 'text-ink')
  })

  it('defaultExpanded starts open', () => {
    render(
      <Disclosure label="Why this task" defaultExpanded>
        It appears in every past exam.
      </Disclosure>,
    )
    expect(screen.getByRole('button', { name: 'Why this task' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('It appears in every past exam.')).toBeVisible()
  })
})
