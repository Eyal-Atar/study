import { useMemo, useState, type ReactNode } from 'react'
import {
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
  Text,
} from 'react-aria-components'
import { he } from '../i18n/he'
import { Button } from './Button'
import { DEFAULT_TIMEOUT_MS, ToastContext, UNDO_TIMEOUT_MS, useToastContext, type Content, type ToastApi } from './useToast'

// The one wrapper of React Aria's toast (still UNSTABLE_ in 1.22): the rest of the app uses
// useToast() and <ToastRegion />, so an API change there touches this file only.

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue] = useState(() => new ToastQueue<Content>({ maxVisibleToasts: 3 }))
  const value = useMemo(() => {
    const api: ToastApi = {
      show: (options) => {
        const content: Content = { options, acted: { current: false } }
        const timeout = options.timeoutMs ?? (options.action === undefined ? DEFAULT_TIMEOUT_MS : UNDO_TIMEOUT_MS)
        return queue.add(content, {
          timeout,
          onClose: () => {
            if (!content.acted.current) options.onExpire?.()
          },
        })
      },
      close: (key) => {
        queue.close(key)
      },
    }
    return { api, queue }
  }, [queue])
  return <ToastContext value={value}>{children}</ToastContext>
}

const TONES = {
  info: 'border-line bg-surface text-ink',
  success: 'border-success bg-success-soft text-success',
  error: 'border-danger bg-danger-soft text-danger',
} as const

// Sits once in the app shell, at the bottom of the screen.
export function ToastRegion() {
  const { queue } = useToastContext()
  return (
    <AriaToastRegion
      queue={queue}
      aria-label={he.common.notifications}
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-col gap-2 outline-none"
    >
      {({ toast }) => (
        <AriaToast
          toast={toast}
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand ${TONES[toast.content.options.tone ?? 'info']}`}
        >
          <AriaToastContent className="flex-1">
            <Text slot="title" className="text-sm font-medium">
              {toast.content.options.text}
            </Text>
          </AriaToastContent>
          {toast.content.options.action === undefined ? null : (
            <Button
              variant="quiet"
              onPress={() => {
                toast.content.acted.current = true
                toast.content.options.action?.onAction()
                queue.close(toast.key)
              }}
            >
              {toast.content.options.action.label}
            </Button>
          )}
          <Button variant="quiet" slot="close" aria-label={he.common.close} className="px-2">
            ×
          </Button>
        </AriaToast>
      )}
    </AriaToastRegion>
  )
}
