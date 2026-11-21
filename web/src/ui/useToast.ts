import { createContext, useContext } from 'react'
import type { UNSTABLE_ToastQueue as ToastQueue } from 'react-aria-components'

// The toast API the app uses (toast.tsx renders it). See toast.tsx for why it is wrapped.

export interface ToastAction {
  label: string
  onAction: () => void
}

export interface ToastOptions {
  text: string
  tone?: 'info' | 'success' | 'error'
  action?: ToastAction
  // Without a timeout a toast stays until closed. A destructive action: UNDO_TIMEOUT_MS with "Undo".
  timeoutMs?: number
  // Called once when the toast goes away by itself, without its action (the time to commit a delete).
  onExpire?: () => void
}

// Spec 7.9: a destructive action gets "Undo" for 10 seconds.
export const UNDO_TIMEOUT_MS = 10000
export const DEFAULT_TIMEOUT_MS = 6000

export interface ToastApi {
  show(options: ToastOptions): string
  close(key: string): void
}

export interface Content {
  options: ToastOptions
  // Set when the action ran, so the close that follows is not an expiry.
  acted: { current: boolean }
}

export const ToastContext = createContext<{ api: ToastApi; queue: ToastQueue<Content> } | null>(null)

export function useToastContext() {
  const value = useContext(ToastContext)
  if (value === null) throw new Error('useToast() must be used inside <ToastProvider>')
  return value
}

export function useToast(): ToastApi {
  return useToastContext().api
}

