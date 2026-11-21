import { Minus, Plus, type LucideIcon } from 'lucide-react'
import { useId, useRef, type KeyboardEvent, type RefObject } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { he } from '../i18n/he'
import { cx, FOCUS_RING, ICON_STROKE } from './styles'
import { FIELD_DESCRIPTION_CLASS, FIELD_LABEL_CLASS } from './TextField'

export interface StepperOption {
  value: number
  label: string
}

export interface StepperProps {
  // The question above it, and the name of the group.
  label: string
  value: number
  // The values it steps through, from the smallest up, each with its words ("4 שעות").
  options: readonly StepperOption[]
  onChange: (value: number) => void
  // Under the label, linked to the group.
  description?: string | undefined
  // Under the value, in small muted text: "ביום לימוד".
  caption?: string | undefined
  // The names of the two buttons; "יותר" and "פחות" by default.
  moreLabel?: string | undefined
  lessLabel?: string | undefined
}

// The round soft buttons of the mockup's hours question (onboarding step 3): a 44px circle in
// surface-muted, the icon in ink. Turned off at its end: the icon goes muted (the fill is muted
// already), and the cursor says it.
const STEP_BUTTON = cx(
  'inline-flex size-touch shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface-muted text-ink transition-colors duration-(--duration-fast)',
  FOCUS_RING,
  'data-[hovered]:bg-brand-soft data-[hovered]:text-brand-strong data-[pressed]:bg-brand-soft data-[pressed]:text-brand-strong',
  'data-[disabled]:cursor-not-allowed data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted',
)

function StepButton({
  icon: Icon,
  name,
  isDisabled,
  onPress,
  buttonRef,
}: {
  icon: LucideIcon
  name: string
  isDisabled: boolean
  onPress: () => void
  buttonRef: RefObject<HTMLButtonElement | null>
}) {
  return (
    <AriaButton ref={buttonRef} aria-label={name} isDisabled={isDisabled} onPress={onPress} className={STEP_BUTTON}>
      <Icon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
    </AriaButton>
  )
}

// A number from a short list, one step at a time (the hours a day of the onboarding): "יותר" and
// "פחות" around the value in large type. In the DOM "יותר" comes first, so in RTL it is on the
// right, as in the mockup. The up and down arrows on the group step too. The value is an <output>
// that is announced politely after each step.
export function Stepper({ label, value, options, onChange, description, caption, moreLabel, lessLabel }: StepperProps) {
  const labelId = useId()
  const descriptionId = useId()
  const moreRef = useRef<HTMLButtonElement>(null)
  const lessRef = useRef<HTMLButtonElement>(null)

  // The next value up and down. Not by index: a value that is not in the list (an old profile)
  // still steps to its neighbours.
  const next = options.find((option) => option.value > value)
  const previous = options.findLast((option) => option.value < value)
  const current = options.find((option) => option.value === value)

  // A button that turns off under the keyboard focus would drop it to the page, so the focus moves
  // to the other button first when this step reaches the end.
  function step(to: StepperOption | undefined, isLast: boolean, other: RefObject<HTMLButtonElement | null>) {
    if (to === undefined) return
    if (isLast) other.current?.focus()
    onChange(to.value)
  }
  function more() {
    step(next, next !== undefined && !options.some((option) => option.value > next.value), lessRef)
  }
  function less() {
    step(previous, previous !== undefined && !options.some((option) => option.value < previous.value), moreRef)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      more()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      less()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className={FIELD_LABEL_CLASS}>
        {label}
      </span>
      {description === undefined ? null : (
        <span id={descriptionId} className={FIELD_DESCRIPTION_CLASS}>
          {description}
        </span>
      )}
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        onKeyDown={onKeyDown}
        className="flex items-center justify-center gap-5 py-2"
      >
        <StepButton
          icon={Plus}
          name={moreLabel ?? he.s34ui.stepper.more}
          isDisabled={next === undefined}
          onPress={more}
          buttonRef={moreRef}
        />
        <div className="flex min-w-0 flex-col items-center text-center">
          <output aria-live="polite" className="block">
            <span className="text-display font-bold text-ink tabular-nums">{current?.label ?? String(value)}</span>
          </output>
          {caption === undefined ? null : <span className="text-caption text-ink-muted">{caption}</span>}
        </div>
        <StepButton
          icon={Minus}
          name={lessLabel ?? he.s34ui.stepper.less}
          isDisabled={previous === undefined}
          onPress={less}
          buttonRef={lessRef}
        />
      </div>
    </div>
  )
}
