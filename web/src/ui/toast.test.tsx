import { act, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { he } from '../i18n/he'
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
    expect(screen.getByRole('region', { name: he.common.notifications })).toHaveTextContent('נשמר')
  })

  it('the undo action runs once and closes the toast, without an expiry', async () => {
    const user = userEvent.setup()
    const toast = setup()
    const onAction = vi.fn()
    const onExpire = vi.fn()
    act(() => {
      toast.show({ text: 'המבחן נמחק', action: { label: he.common.undo, onAction }, onExpire })
    })
    await user.click(screen.getByRole('button', { name: he.common.undo }))
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
        toast.show({ text: 'הקובץ יימחק', action: { label: he.common.undo, onAction: vi.fn() }, onExpire })
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
      toast.show({ text: 'המבחן נמחק', action: { label: he.common.undo, onAction }, onExpire })
    })
    const close = screen.getByRole('button', { name: he.common.close })
    // An icon, not the "×" character.
    expect(close).toHaveTextContent('')
    expect(close.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await user.click(close)
    expect(screen.queryByText('המבחן נמחק')).not.toBeInTheDocument()
    // Closing is not undoing: the pending action is committed, as when the time runs out.
    expect(onAction).not.toHaveBeenCalled()
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('an error toast says so with an icon and a border, not with the colour of its text', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'השמירה נכשלה', tone: 'error' })
    })
    const item = screen.getByRole('alertdialog')
    expect(item).toHaveClass('border-danger', 'bg-danger-soft', 'text-ink')
    const icon = item.querySelector('svg.text-danger')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('a success toast has its own icon, and an info toast has none', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'נשמר', tone: 'success' })
    })
    const success = screen.getByRole('alertdialog')
    expect(success).toHaveClass('border-success', 'bg-success-soft', 'text-ink')
    expect(success.querySelector('svg.text-success')).toBeInTheDocument()
    act(() => {
      toast.show({ text: 'לידיעה' })
    })
    const info = screen.getAllByRole('alertdialog').find((item) => item.textContent.includes('לידיעה'))
    expect(info).toHaveClass('border-line', 'bg-surface', 'text-ink')
    // Only the icon of the close button.
    expect(info?.querySelectorAll('svg')).toHaveLength(1)
  })

  it('floats with the one shadow and card corners, above the bottom bar of the phone', () => {
    const toast = setup()
    act(() => {
      toast.show({ text: 'נשמר' })
    })
    const region = screen.getByRole('region', { name: he.common.notifications })
    const item = screen.getByRole('alertdialog')
    expect(item).toHaveClass('rounded-card', 'shadow-overlay', 'min-h-14')
    // Above the scrim of a dialog (z-50): an undo toast must stay pressable when a dialog opens.
    expect(region).toHaveClass('fixed', 'z-[60]', 'bottom-[calc(env(safe-area-inset-bottom)+6rem)]', 'md:bottom-4')
    // Nothing is left of the look from before the design language.
    expect(region.outerHTML).not.toMatch(/\b(shadow-lg|rounded-lg|text-sm|font-medium)\b/)
  })
})
