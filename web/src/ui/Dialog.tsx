import { X } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { he } from '../i18n/he'
import { IconButton } from './IconButton'
import { cx, ICON_STROKE } from './styles'

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
  // Blocks Escape too: while a save or a delete is on its way, so the dialog cannot close under it.
  isKeyboardDismissDisabled?: boolean | undefined
  // Makes the dialog a form: the children and the footer sit in a <form>, so Enter in a field
  // submits, and the primary button of the footer is <Button type="submit">. The page is never
  // reloaded. Without it there is no form, and the buttons act through onPress.
  onSubmit?: (() => void) | undefined
  children?: ReactNode
  // The actions row: the primary Button first (it sits at the start side and grows, with
  // className="flex-1"), then the others.
  footer?: ReactNode
}

// The gap between the parts of the dialog. The form (when there is one) repeats it, so the layout
// is the same with and without onSubmit.
const COLUMN = 'flex flex-col gap-4'

// The scrim: ink at 40%, the one sanctioned opacity modifier. It only fades (design language 7).
// Its height is the visual viewport, which React Aria writes on this element as
// --visual-viewport-height, and not the whole screen (inset-0): when the on-screen keyboard of a
// phone is open, the bottom of the scrim is the top of the keyboard, so the sheet sits above it.
const OVERLAY =
  'fixed inset-x-0 top-0 z-50 flex h-(--visual-viewport-height) items-end justify-center bg-ink/35 md:items-center md:p-4 transition-opacity duration-(--duration-slow) data-[entering]:opacity-0 data-[exiting]:opacity-0'

// One component, two shapes. Below md it is a sheet attached to the bottom, like the sheet of the
// prototype: the larger corners of a sheet on top only, no border, the upward shadow of a sheet, a
// small grab handle, and the safe area of the phone under it. From md it is a centred window that
// floats like a menu: the corners of a card, a line and the shadow of what floats. It enters with a
// fade and 8px of movement; Tailwind 4 writes translate-y-* to the `translate` property, which is
// why that is the property in transition.
// The height limit is 85% of the same visual viewport (the variable is inherited from the overlay):
// 85dvh ignores the keyboard, and would push the top of a long sheet off the screen.
const MODAL =
  'max-h-[calc(var(--visual-viewport-height)*0.85)] w-full overflow-y-auto rounded-t-sheet bg-surface pb-[env(safe-area-inset-bottom)] shadow-sheet md:max-w-md md:rounded-card md:border md:border-line md:shadow-overlay transition-[translate,opacity] duration-(--duration-slow) data-[entering]:translate-y-2 data-[entering]:opacity-0 data-[exiting]:translate-y-2 data-[exiting]:opacity-0'

// The handle at the top of the sheet (38x5, the .grab of the prototype). It only draws: the sheet
// is not dragged, it closes with its close button, Escape or a press on the scrim, so the handle is
// hidden from assistive technology, and it is not there on the window of md.
const GRAB = 'mx-auto mt-2.5 h-[5px] w-[38px] rounded-full bg-line md:hidden'

// React Aria's ModalOverlay gives the modal behaviour: the focus moves in, is held inside, and
// returns to what opened the dialog; the page behind is hidden from assistive technology; Escape
// closes. The name is the title (Heading slot="title").
export function Dialog({
  title,
  description,
  isOpen,
  onOpenChange,
  role = 'dialog',
  isDismissable,
  isKeyboardDismissDisabled = false,
  onSubmit,
  children,
  footer,
}: DialogProps) {
  const dismissable = isDismissable ?? role === 'dialog'
  // React Aria links a description by itself only for an alertdialog, so it is linked here for both.
  const descriptionId = useId()
  const body = (
    <>
      {children}
      {footer === undefined || footer === null ? null : <div className="flex flex-wrap gap-2">{footer}</div>}
    </>
  )
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={dismissable}
      isKeyboardDismissDisabled={isKeyboardDismissDisabled}
      className={OVERLAY}
    >
      <Modal className={MODAL}>
        <div aria-hidden="true" data-grab="" className={GRAB} />
        <AriaDialog
          role={role}
          aria-describedby={description === undefined ? undefined : descriptionId}
          // The dialog itself takes the focus when it opens. It is not a control and Tab cannot
          // reach it, so it has no ring; every control inside has its own.
          className={cx(COLUMN, 'p-card outline-none')}
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
          {onSubmit === undefined ? (
            body
          ) : (
            <form
              className={COLUMN}
              onSubmit={(event) => {
                // The submit is handled here: the browser must not load a page.
                event.preventDefault()
                onSubmit()
              }}
            >
              {body}
            </form>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}
