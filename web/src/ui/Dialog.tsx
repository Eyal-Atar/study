import { X } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { he } from '../i18n/he'
import { IconButton } from './IconButton'
import { ICON_STROKE } from './styles'

export interface DialogProps {
  title: string
  description?: string | undefined
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  // alertdialog: something the user must answer; it does not close on an outside press.
  role?: 'dialog' | 'alertdialog'
  // Whether an outside press closes it, and whether it has a close button.
  // Default: true for 'dialog', false for 'alertdialog'. Escape closes it either way.
  isDismissable?: boolean | undefined
  children?: ReactNode
  // The actions row: the primary Button first (it sits at the start side and grows, with
  // className="flex-1"), then the others.
  footer?: ReactNode
}

// The scrim: ink at 40%, the one sanctioned opacity modifier. It only fades (design language 7).
const OVERLAY =
  'fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center md:p-4 transition-opacity duration-(--duration-slow) data-[entering]:opacity-0 data-[exiting]:opacity-0'

// One component, two shapes. Below md it is a sheet attached to the bottom (top corners only, and
// the safe area of the phone under it); from md it is a centred window. It floats, so it is one of
// the few things with the shadow. It enters with a fade and 8px of movement; Tailwind 4 writes
// translate-y-* to the `translate` property, which is why that is the property in transition.
const MODAL =
  'max-h-[85dvh] w-full overflow-y-auto rounded-t-card border border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-overlay md:max-w-md md:rounded-card transition-[translate,opacity] duration-(--duration-slow) data-[entering]:translate-y-2 data-[entering]:opacity-0 data-[exiting]:translate-y-2 data-[exiting]:opacity-0'

// React Aria's ModalOverlay gives the modal behaviour: the focus moves in, is held inside, and
// returns to what opened the dialog; the page behind is hidden from assistive technology; Escape
// closes. The name is the title (Heading slot="title").
export function Dialog({ title, description, isOpen, onOpenChange, role = 'dialog', isDismissable, children, footer }: DialogProps) {
  const dismissable = isDismissable ?? role === 'dialog'
  // React Aria links a description by itself only for an alertdialog, so it is linked here for both.
  const descriptionId = useId()
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={dismissable} className={OVERLAY}>
      <Modal className={MODAL}>
        <AriaDialog
          role={role}
          aria-describedby={description === undefined ? undefined : descriptionId}
          // The dialog itself takes the focus when it opens. It is not a control and Tab cannot
          // reach it, so it has no ring; every control inside has its own.
          className="flex flex-col gap-4 p-card outline-none"
        >
          <div className="flex items-start justify-between gap-2">
            <Heading slot="title" className="min-w-0 break-words text-title font-semibold text-ink">
              {title}
            </Heading>
            {dismissable ? (
              // slot="close": React Aria's Dialog wires the press to onOpenChange(false).
              // The negative margins keep the 44px target from pushing the title down and in.
              <IconButton slot="close" aria-label={he.common.close} className="-me-2 -mt-2">
                <X aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
              </IconButton>
            ) : null}
          </div>
          {description === undefined ? null : (
            <p id={descriptionId} className="text-small text-ink-muted">
              {description}
            </p>
          )}
          {children}
          {footer === undefined || footer === null ? null : <div className="flex flex-wrap gap-2">{footer}</div>}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}
