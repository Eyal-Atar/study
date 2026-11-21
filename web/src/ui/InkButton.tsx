import { LoaderCircle } from 'lucide-react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps, composeRenderProps } from 'react-aria-components'
import { BUTTON_BASE, cx, FOCUS_RING, ICON_STROKE } from './styles'

export type InkButtonProps = AriaButtonProps

// The dark button of the all-screens mockup (S34 decision 11): "המשך עם Google" on the login
// screen and "+ הוספת מבחן" in the onboarding form. on-inverse on inverse is a checked text pair
// (11.45:1). It is not a second primary: a screen still has at most one green button. Under the
// pointer it lifts (shadow-raised), since no darker fill reads on the dark. The ring is the brand
// one, with its 2px gap of the light page around the dark. Disabled is muted, never transparent,
// like a Button. isPending: the spinner before the text, and presses are ignored.
const CLASS = cx(
  BUTTON_BASE,
  FOCUS_RING,
  'border-inverse bg-inverse text-on-inverse',
  'data-[hovered]:shadow-raised data-[pressed]:shadow-raised',
  'data-[disabled]:cursor-not-allowed data-[disabled]:border-line data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted',
  'data-[pending]:cursor-progress',
)

export function InkButton({ className, children, ...props }: InkButtonProps) {
  return (
    <AriaButton {...props} className={composeRenderProps(className, (custom) => cx(CLASS, custom))}>
      {composeRenderProps(children, (content, { isPending }) => (
        <>
          {isPending ? <LoaderCircle aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="animate-spin" /> : null}
          {content}
        </>
      ))}
    </AriaButton>
  )
}
