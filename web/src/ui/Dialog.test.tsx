import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { he } from '../i18n/he'
import { Button } from './Button'
import { Dialog, type DialogProps } from './Dialog'

function setup({ children = <p>תוכן</p>, ...props }: Partial<DialogProps> = {}) {
  const onOpenChange = vi.fn()
  render(
    <>
      <Button variant="secondary">מחוץ לדיאלוג</Button>
      <Dialog
        title="מחיקת המבחן"
        description="אי אפשר לבטל את המחיקה."
        isOpen
        onOpenChange={onOpenChange}
        footer={
          <>
            <Button className="flex-1">אישור</Button>
            <Button variant="secondary">לא עכשיו</Button>
          </>
        }
        {...props}
      >
        {children}
      </Dialog>
    </>,
  )
  return { onOpenChange }
}

// The overlay (the scrim) is the grandparent of the dialog: overlay > modal > dialog.
function overlayOf(dialog: HTMLElement): HTMLElement {
  const overlay = dialog.parentElement?.parentElement
  if (!overlay) throw new Error('no overlay')
  return overlay
}

// A dialog that owns its open state, with the button that opens it.
function Harness() {
  const [isOpen, setOpen] = useState(false)
  return (
    <>
      <Button
        onPress={() => {
          setOpen(true)
        }}
      >
        פתיחה
      </Button>
      <Dialog title="כותרת" isOpen={isOpen} onOpenChange={setOpen} footer={<Button>אישור</Button>} />
    </>
  )
}

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    setup({ isOpen: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('תוכן')).not.toBeInTheDocument()
  })

  it('is a dialog named by its title and described by its description', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'מחיקת המבחן' })
    expect(dialog).toHaveAccessibleDescription('אי אפשר לבטל את המחיקה.')
    expect(screen.getByRole('heading', { name: 'מחיקת המבחן' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('תוכן')
  })

  it('has no description link when there is no description', () => {
    setup({ description: undefined })
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby')
  })

  it('takes the focus when it opens and keeps Tab inside it', async () => {
    const user = userEvent.setup()
    setup()
    const dialog = screen.getByRole('dialog')
    await waitFor(() => {
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    })
    // The page behind is hidden from assistive technology, and Tab never reaches it.
    const outside = screen.getByRole('button', { name: 'מחוץ לדיאלוג', hidden: true })
    const visited = new Set<Element | null>()
    // Three buttons inside (close, confirm, not now): five tabs go around more than once.
    for (let i = 0; i < 5; i++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
      expect(outside).not.toHaveFocus()
      visited.add(document.activeElement)
    }
    expect(visited).toContain(screen.getByRole('button', { name: 'אישור' }))
    expect(visited).toContain(screen.getByRole('button', { name: 'לא עכשיו' }))
    expect(visited).toContain(screen.getByRole('button', { name: he.common.close }))
  })

  it('Escape asks to close', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = setup()
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('the close button asks to close', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = setup()
    await user.click(screen.getByRole('button', { name: he.common.close }))
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('a press outside asks to close a dismissable dialog', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = setup()
    await user.click(overlayOf(screen.getByRole('dialog')))
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('a press inside does not ask to close', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = setup()
    await user.click(screen.getByText('תוכן'))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('an alertdialog has no close button and ignores a press outside, but Escape still closes it', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = setup({ role: 'alertdialog' })
    const dialog = screen.getByRole('alertdialog', { name: 'מחיקת המבחן' })
    expect(dialog).toHaveAccessibleDescription('אי אפשר לבטל את המחיקה.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: he.common.close })).not.toBeInTheDocument()

    await user.click(overlayOf(dialog))
    expect(onOpenChange).not.toHaveBeenCalled()
    // The press landed on the scrim, which cannot hold the focus: React Aria brings it back into
    // the dialog on the next frame, so the keyboard still works.
    await waitFor(() => {
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    })

    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('isDismissable overrides the default of the role', () => {
    setup({ isDismissable: false })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: he.common.close })).not.toBeInTheDocument()
  })

  it('gives the focus back to the button that opened it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'פתיחה' })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'כותרת' })
    await waitFor(() => {
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    })

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    // React Aria restores the focus on the next frame.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'פתיחה' })).toHaveFocus()
    })
  })

  it('a sheet below md (sheet corners and shadow, a grab handle), a floating window from md', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    const modal = dialog.parentElement as HTMLElement
    expect(modal).toHaveClass('bg-surface', 'rounded-t-sheet', 'shadow-sheet')
    expect(modal).toHaveClass('md:rounded-card', 'md:border', 'md:border-line', 'md:shadow-overlay', 'md:max-w-md')
    expect(modal).not.toHaveClass('rounded-t-card', 'shadow-overlay')
    // The handle only draws: hidden from assistive technology, and gone on the window of md.
    const grab = modal.querySelector('[data-grab]')
    expect(grab).toHaveAttribute('aria-hidden', 'true')
    expect(grab).toHaveClass('h-[5px]', 'w-[38px]', 'rounded-full', 'bg-line', 'md:hidden')
    expect(grab?.nextElementSibling).toBe(dialog)
    expect(overlayOf(dialog)).toHaveClass('items-end', 'md:items-center', 'bg-ink/35')
  })

  it('the scrim is as high as the visible viewport, so the sheet sits above the on-screen keyboard', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    const overlay = overlayOf(dialog)
    // React Aria writes the height of the visual viewport on the overlay element itself.
    expect(overlay.style.getPropertyValue('--visual-viewport-height')).toMatch(/^\d+(\.\d+)?px$/)
    expect(overlay).toHaveClass('fixed', 'inset-x-0', 'top-0', 'h-(--visual-viewport-height)')
    expect(overlay).not.toHaveClass('inset-0')
    // The sheet is limited by the same height, not by the full screen behind the keyboard.
    expect(dialog.parentElement).toHaveClass('max-h-[calc(var(--visual-viewport-height)*0.85)]')
  })

  it('isKeyboardDismissDisabled blocks Escape', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = setup({ isKeyboardDismissDisabled: true })
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    })
    await user.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('without onSubmit there is no form', () => {
    setup()
    expect(screen.getByRole('dialog').querySelector('form')).toBeNull()
  })

  it('with onSubmit, Enter in a field and the submit button of the footer both submit, without a page load', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    // Whether each native submit was cancelled before it could load a page.
    const prevented: boolean[] = []
    const onNativeSubmit = (event: Event) => {
      prevented.push(event.defaultPrevented)
    }
    document.addEventListener('submit', onNativeSubmit)
    try {
      setup({
        onSubmit,
        children: <input aria-label="שם המבחן" />,
        footer: (
          <>
            <Button type="submit" className="flex-1">
              שמירה
            </Button>
            <Button variant="secondary">לא עכשיו</Button>
          </>
        ),
      })
      const dialog = screen.getByRole('dialog')
      const form = dialog.querySelector('form') as HTMLFormElement
      // The form carries the same column as the dialog, so the layout is the same with and without it.
      expect(form).toHaveClass('flex', 'flex-col', 'gap-4')
      expect(form).toContainElement(screen.getByRole('textbox', { name: 'שם המבחן' }))
      expect(form).toContainElement(screen.getByRole('button', { name: 'שמירה' }))
      // The title and the close button stay outside the form.
      expect(form).not.toContainElement(screen.getByRole('heading', { name: 'מחיקת המבחן' }))

      await user.type(screen.getByRole('textbox', { name: 'שם המבחן' }), 'אלגוריתמים{Enter}')
      expect(onSubmit).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'שמירה' }))
      expect(onSubmit).toHaveBeenCalledTimes(2)

      // A button that is not a submit does not submit.
      await user.click(screen.getByRole('button', { name: 'לא עכשיו' }))
      expect(onSubmit).toHaveBeenCalledTimes(2)

      expect(prevented).toEqual([true, true])
    } finally {
      document.removeEventListener('submit', onNativeSubmit)
    }
  })

  it('a long unbroken title wraps instead of widening the sheet', () => {
    const title = 'א'.repeat(60)
    setup({ title })
    expect(screen.getByRole('heading', { name: title })).toHaveClass('break-words', 'min-w-0')
  })
})
