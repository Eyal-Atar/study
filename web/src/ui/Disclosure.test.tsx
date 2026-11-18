import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Disclosure } from './Disclosure'

describe('Disclosure', () => {
  it('starts closed: a button named by the label, and content that is not visible', () => {
    render(<Disclosure label="למה המשימה הזאת">מופיע בכל מבחן עבר.</Disclosure>)
    const trigger = screen.getByRole('button', { name: 'למה המשימה הזאת' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('מופיע בכל מבחן עבר.')).not.toBeVisible()
    // The look of the design language: a 44px target in the brand colour, never an underline.
    expect(trigger).toHaveClass('min-h-touch', 'text-small', 'font-medium', 'text-brand')
    expect(trigger.className).not.toMatch(/underline/)
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('opens and closes with Enter and with Space, and the button points to its panel', async () => {
    const user = userEvent.setup()
    render(<Disclosure label="למה המשימה הזאת">מופיע בכל מבחן עבר.</Disclosure>)
    const trigger = screen.getByRole('button', { name: 'למה המשימה הזאת' })
    const content = screen.getByText('מופיע בכל מבחן עבר.')

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
    render(<Disclosure label="מאיפה זה">שאלה 2 בכל מבחן עבר</Disclosure>)
    await user.click(screen.getByRole('button', { name: 'מאיפה זה' }))
    expect(screen.getByText('שאלה 2 בכל מבחן עבר')).toBeVisible()
    expect(screen.getByText('שאלה 2 בכל מבחן עבר')).toHaveClass('rounded-control', 'bg-surface-muted', 'text-small', 'text-ink')
  })

  it('defaultExpanded starts open', () => {
    render(
      <Disclosure label="למה המשימה הזאת" defaultExpanded>
        מופיע בכל מבחן עבר.
      </Disclosure>,
    )
    expect(screen.getByRole('button', { name: 'למה המשימה הזאת' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('מופיע בכל מבחן עבר.')).toBeVisible()
  })
})
