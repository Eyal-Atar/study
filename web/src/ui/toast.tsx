import { CircleAlert, CircleCheck, X, type LucideIcon } from 'lucide-react'
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
import { IconButton } from './IconButton'
import { cx, FOCUS_RING, ICON_STROKE } from './styles'
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

// The text is ink on the soft background (a checked pair). The state is carried by the border and
// by an icon in the colour of the state, never by colour alone (design language 2).
const TONES: Record<NonNullable<Content['options']['tone']>, { box: string; icon: LucideIcon | null; iconColor: string }> = {
  info: { box: 'border-line bg-surface text-ink', icon: null, iconColor: '' },
  success: { box: 'border-success bg-success-soft text-ink', icon: CircleCheck, iconColor: 'text-success' },
  error: { box: 'border-danger bg-danger-soft text-ink', icon: CircleAlert, iconColor: 'text-danger' },
}

// Sits once in the app shell, at the bottom of the screen. On phones the bottom navigation bar and
// the onboarding action bar are fixed at the bottom, so below md the toasts sit above them (6rem
// plus the safe area the bars also add); from md up, where nothing is fixed there, 1rem.
// A toast floats, so it is one of the few things with the shadow. React Aria's toast (1.22) has no
// data-entering state, so it appears without an enter animation rather than with a hand-made one.
export function ToastRegion() {
  const { queue } = useToastContext()
  return (
    <AriaToastRegion
      queue={queue}
      aria-label={he.common.notifications}
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+6rem)] z-50 mx-auto flex max-w-md flex-col gap-2 outline-none md:bottom-4"
    >
      {({ toast }) => {
        const { options } = toast.content
        const tone = TONES[options.tone ?? 'info']
        const Icon = tone.icon
        return (
          <AriaToast
            toast={toast}
            className={cx('flex min-h-14 items-center gap-2 rounded-card border px-4 py-2 shadow-overlay', FOCUS_RING, tone.box)}
          >
            {Icon === null ? null : (
              <Icon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className={cx('shrink-0', tone.iconColor)} />
            )}
            <AriaToastContent className="min-w-0 flex-1">
              <Text slot="title" className="text-small font-semibold break-words">
                {options.text}
              </Text>
            </AriaToastContent>
            {options.action === undefined ? null : (
              <Button
                variant="quiet"
                onPress={() => {
                  toast.content.acted.current = true
                  options.action?.onAction()
                  queue.close(toast.key)
                }}
              >
                {options.action.label}
              </Button>
            )}
            {/* slot="close": React Aria's toast wires the press to closing this toast. The negative
                margin lets the 44px target sit in the padding of the toast. */}
            <IconButton slot="close" aria-label={he.common.close} className="-me-2">
              <X aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
            </IconButton>
          </AriaToast>
        )
      }}
    </AriaToastRegion>
  )
}
