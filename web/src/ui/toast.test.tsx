import { act, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useEffect, useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { Dialog } from './Dialog'
import { ToastProvider, ToastRegion } from './toast'
import { useToast, type ToastApi } from './useToast'

function setup(withSheet: ReactNode = null) {
  const holder: { api?: ToastApi } = {}
  function Grab() {
    const api = useToast()
    useEffect(() => {
      holder.api = api
    }, [api])
    return null
  }
  render(
    <ToastProvider>
      <Grab />
      {withSheet}
      <ToastRegion />
    </ToastProvider>,
  )
  if (holder.api === undefined) throw new Error('no toast api')
  return holder.api
}

const BOTTOM = ['bottom-[calc(env(safe-area-inset-bottom)+6rem)]', 'lg:bottom-4']
const TOP = 'top-[calc(env(safe-area-inset-top)+1rem)]'

const sheet: { close?: () => void } = {}
function Sheet() {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    sheet.close = () => {
      setOpen(false)
    }
  }, [])
  return (
    <Dialog title="Your garden is a sprout now" isOpen={open} onOpenChange={setOpen}>
      <p>Body</p>
    </Dialog>
  )
}

describe('toast', () => {
  it('shows the text in the notifications region', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'Saved' })
    })
    expect(screen.getByRole('region', { name: en.common.notifications })).toHaveTextContent('Saved')
  })

  it('the undo action runs once and closes the toast, without an expiry', async () => {
    const user = userEvent.setup()
    const toast = setup()
    const onAction = vi.fn()
    const onExpire = vi.fn()
    act(() => {
      toast.show({ text: 'The exam was deleted', action: { label: en.common.undo, onAction }, onExpire })
    })
    await user.click(screen.getByRole('button', { name: en.common.undo }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onExpire).not.toHaveBeenCalled()
    expect(screen.queryByText('The exam was deleted')).not.toBeInTheDocument()
  })

  it('an undo toast expires after 10 seconds and reports it', () => {
    vi.useFakeTimers()
    try {
      const toast = setup()
      const onExpire = vi.fn()
      act(() => {
        toast.show({ text: 'The file will be deleted', action: { label: en.common.undo, onAction: vi.fn() }, onExpire })
      })
      act(() => {
        vi.advanceTimersByTime(9999)
      })
      expect(onExpire).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(onExpire).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the close button is named, removes the toast, and counts as an expiry', async () => {
    const user = userEvent.setup()
    const toast = setup()
    const onAction = vi.fn()
    const onExpire = vi.fn()
    act(() => {
      toast.show({ text: 'The exam was deleted', action: { label: en.common.undo, onAction }, onExpire })
    })
    const close = screen.getByRole('button', { name: en.common.close })
    // An icon, not the "×" character.
    expect(close).toHaveTextContent('')
    expect(close.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await user.click(close)
    expect(screen.queryByText('The exam was deleted')).not.toBeInTheDocument()
    // Closing is not undoing: the pending action is committed, as when the time runs out.
    expect(onAction).not.toHaveBeenCalled()
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('an error toast says so with an icon, not with the colour of its text', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'Saving failed', tone: 'error' })
    })
    const item = screen.getByRole('alertdialog')
    // Dark, like every toast of the prototype: the tone is the icon alone.
    expect(item).toHaveClass('bg-inverse', 'text-on-inverse')
    const icon = item.querySelector('svg.text-inverse-danger')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('a success toast has its own icon, and an info toast has none', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'Saved', tone: 'success' })
    })
    const success = screen.getByRole('alertdialog')
    expect(success).toHaveClass('bg-inverse', 'text-on-inverse')
    expect(success.querySelector('svg.text-inverse-success')).toBeInTheDocument()
    act(() => {
      toast.show({ text: 'For your information' })
    })
    const info = screen.getAllByRole('alertdialog').find((item) => item.textContent.includes('For your information'))
    expect(info).toHaveClass('bg-inverse', 'text-on-inverse')
    // Only the icon of the close button.
    expect(info?.querySelectorAll('svg')).toHaveLength(1)
  })

  it('its undo and its close are the inverse buttons, readable on the dark', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'The exam was deleted', action: { label: en.common.undo, onAction: vi.fn() } })
    })
    const undo = screen.getByRole('button', { name: en.common.undo })
    expect(undo).toHaveClass('text-inverse-action')
    expect(undo).not.toHaveClass('text-brand')
    const close = screen.getByRole('button', { name: en.common.close })
    expect(close).toHaveClass('text-on-inverse')
    expect(close).not.toHaveClass('text-ink-muted')
  })

  it('floats with the one shadow and card corners, above the bottom bar of the phone', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'Saved' })
    })
    const region = screen.getByRole('region', { name: en.common.notifications })
    const item = screen.getByRole('alertdialog')
    expect(item).toHaveClass('bg-inverse', 'text-on-inverse', 'rounded-button', 'shadow-overlay', 'min-h-14')
    // Above the scrim of a dialog (z-50): an undo toast must stay pressable when a dialog opens.
    // Above the bottom bar of the shell, which is there below lg.
    expect(region).toHaveClass('fixed', 'z-[60]', 'bottom-[calc(env(safe-area-inset-bottom)+6rem)]', 'lg:bottom-4')
    expect(region).not.toHaveClass('md:bottom-4')
    // Nothing is left of the light toast, nor of the look from before the design language.
    // A class ends at a space or a quote: bg-surface must not be taken for bg-surface-muted.
    expect(region.outerHTML).not.toMatch(/\b(shadow-lg|rounded-lg|text-sm|bg-success-soft|bg-danger-soft)\b/)
    for (const element of region.querySelectorAll('[class]')) {
      expect(element.getAttribute('class')).not.toMatch(/(^|\s)bg-surface(\s|$)/)
    }
  })

  // Fix wave 4 of S33: on a phone the toast of Done sat over the celebration sheet's body. While a
  // modal sheet is open the stack moves to the top of the viewport, inside the safe area; Undo stays.
  it('without a sheet the stack sits at the bottom', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'Marked as done.', action: { label: 'Undo', onAction: () => undefined } })
    })
    const region = screen.getByRole('region', { name: en.common.notifications })
    expect(region).toHaveAttribute('data-placement', 'bottom')
    expect(region).toHaveClass(...BOTTOM)
    expect(region).not.toHaveClass(TOP)
  })

  it('while a sheet is open the stack sits at the top, with Undo, and goes back down after it', async () => {
    const onAction = vi.fn()
    const toast = setup(<Sheet />)
    act(() => {
      toast.show({ text: 'Saved', timeoutMs: 60_000 })
      toast.show({ text: 'Marked as done.', action: { label: 'Undo', onAction } })
    })
    const region = screen.getByRole('region', { name: en.common.notifications, hidden: true })
    expect(region).toHaveAttribute('data-placement', 'top')
    expect(region).toHaveClass('fixed', 'z-[60]', TOP)
    for (const c of BOTTOM) expect(region).not.toHaveClass(c)

    await userEvent.setup().click(within(region).getByRole('button', { name: 'Undo', hidden: true }))
    expect(onAction).toHaveBeenCalledOnce()

    act(() => {
      sheet.close?.()
    })
    expect(region).toHaveAttribute('data-placement', 'bottom')
    expect(region).toHaveClass(...BOTTOM)
  })
})
