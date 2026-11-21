import { act, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { ToastProvider, ToastRegion } from './toast'
import { useToast, type ToastApi } from './useToast'

function setup() {
  const holder: { api?: ToastApi } = {}
  function Grab() {
    holder.api = useToast()
    return null
  }
  render(
    <ToastProvider>
      <Grab />
      <ToastRegion />
    </ToastProvider>,
  )
  if (holder.api === undefined) throw new Error('no toast api')
  return holder.api
}

describe('toast', () => {
  it('shows the text in the notifications region', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'נשמר' })
    })
    expect(screen.getByRole('region', { name: en.common.notifications })).toHaveTextContent('נשמר')
  })

  it('the undo action runs once and closes the toast, without an expiry', async () => {
    const user = userEvent.setup()
    const toast = setup()
    const onAction = vi.fn()
    const onExpire = vi.fn()
    act(() => {
      toast.show({ text: 'המבחן נמחק', action: { label: en.common.undo, onAction }, onExpire })
    })
    await user.click(screen.getByRole('button', { name: en.common.undo }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onExpire).not.toHaveBeenCalled()
    expect(screen.queryByText('המבחן נמחק')).not.toBeInTheDocument()
  })

  it('an undo toast expires after 10 seconds and reports it', () => {
    vi.useFakeTimers()
    try {
      const toast = setup()
      const onExpire = vi.fn()
      act(() => {
        toast.show({ text: 'הקובץ יימחק', action: { label: en.common.undo, onAction: vi.fn() }, onExpire })
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
      toast.show({ text: 'המבחן נמחק', action: { label: en.common.undo, onAction }, onExpire })
    })
    const close = screen.getByRole('button', { name: en.common.close })
    // An icon, not the "×" character.
    expect(close).toHaveTextContent('')
    expect(close.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await user.click(close)
    expect(screen.queryByText('המבחן נמחק')).not.toBeInTheDocument()
    // Closing is not undoing: the pending action is committed, as when the time runs out.
    expect(onAction).not.toHaveBeenCalled()
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('an error toast says so with an icon, not with the colour of its text', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'השמירה נכשלה', tone: 'error' })
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
      toast.show({ text: 'נשמר', tone: 'success' })
    })
    const success = screen.getByRole('alertdialog')
    expect(success).toHaveClass('bg-inverse', 'text-on-inverse')
    expect(success.querySelector('svg.text-inverse-success')).toBeInTheDocument()
    act(() => {
      toast.show({ text: 'לידיעה' })
    })
    const info = screen.getAllByRole('alertdialog').find((item) => item.textContent.includes('לידיעה'))
    expect(info).toHaveClass('bg-inverse', 'text-on-inverse')
    // Only the icon of the close button.
    expect(info?.querySelectorAll('svg')).toHaveLength(1)
  })

  it('its undo and its close are the inverse buttons, readable on the dark', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'המבחן נמחק', action: { label: en.common.undo, onAction: vi.fn() } })
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
      toast.show({ text: 'נשמר' })
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
})
