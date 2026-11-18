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

// Every toast is dark, like the toast of the prototype: on-inverse text on inverse, whatever its
// tone. The state is carried by an icon in a light colour of the state (inverse-success,
// inverse-danger, both checked pairs on inverse), never by colour alone (design language 2); an
// info toast has no icon.
const TONES: Record<NonNullable<Content['options']['tone']>, { icon: LucideIcon | null; iconColor: string }> = {
  info: { icon: null, iconColor: '' },
  success: { icon: CircleCheck, iconColor: 'text-inverse-success' },
  error: { icon: CircleAlert, iconColor: 'text-inverse-danger' },
}

// Sits once in the app shell, at the bottom of the screen. Below lg the bottom navigation bar of
// the shell (and, on a phone, the onboarding action bar) is fixed at the bottom, so there the
// toasts sit above it (6rem plus the safe area the bars also add); from lg up, where the navigation
// is in the top bar and nothing is fixed at the bottom, 1rem.
// z-[60], one layer above the scrim of a Dialog (z-50): an undo toast that is on the screen when a
// dialog opens stays visible and pressable instead of ending under the scrim. The scale has no
// step for it, hence the arbitrary value.
// A toast floats, so it is one of the few things with the shadow. It has no border: the dark is
// its edge on any background. React Aria's toast (1.22) has no
// data-entering state, so it appears without an enter animation rather than with a hand-made one.
export function ToastRegion() {
  const { queue } = useToastContext()
  return (
    <AriaToastRegion
      queue={queue}
      aria-label={he.common.notifications}
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+6rem)] z-[60] mx-auto flex max-w-md flex-col gap-2 outline-none lg:bottom-4"
    >
      {({ toast }) => {
        const { options } = toast.content
        const tone = TONES[options.tone ?? 'info']
        const Icon = tone.icon
        return (
          <AriaToast
            toast={toast}
            className={cx('flex min-h-14 items-center gap-2 rounded-button bg-inverse px-4 py-2 text-on-inverse shadow-overlay', FOCUS_RING)}
          >
            {Icon === null ? null : (
              <Icon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className={cx('shrink-0', tone.iconColor)} />
            )}
            <AriaToastContent className="min-w-0 flex-1">
              <Text slot="title" className="text-small break-words">
                {options.text}
              </Text>
            </AriaToastContent>
            {options.action === undefined ? null : (
              <Button
                variant="inverse"
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
            <IconButton slot="close" variant="inverse" aria-label={he.common.close} className="-me-2">
              <X aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
            </IconButton>
          </AriaToast>
        )
      }}
    </AriaToastRegion>
  )
}
