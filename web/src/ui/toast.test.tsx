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
})
