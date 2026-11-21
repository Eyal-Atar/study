import { useId } from 'react'
import { Button } from 'react-aria-components'
import { en } from '../i18n/en'
import { ChevronRight, type IconType } from './icons'
import { cx, FOCUS_RING, ICON_STROKE } from './styles'

export interface ActionCardProps {
  icon: IconType
  title: string
  description?: string | undefined
  onPress: () => void
  isDisabled?: boolean | undefined
  // The action is running: the card stays, does not react, and says so to a screen reader.
  isPending?: boolean | undefined
}

// One choice of a sheet, a row that starts an action (the .opt of the prototype): an icon tile, a
// semibold title, an optional line under it, and a chevron at the end. aria-labelledby (the title) overrides
// the content as the name, so while pending it also lists the sr-only loading span: that is what makes a
// screen reader say it is loading.
export function ActionCard({ icon: Icon, title, description, onPress, isDisabled, isPending }: ActionCardProps) {
  const titleId = useId()
  const descriptionId = useId()
  const loadingId = useId()
  return (
    <Button
      onPress={onPress}
      isDisabled={isDisabled ?? false}
      isPending={isPending ?? false}
      aria-labelledby={isPending ? `${titleId} ${loadingId}` : titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      className={cx(
        'flex min-h-touch w-full cursor-pointer items-center gap-3 rounded-control border border-line bg-field p-3 text-start',
        'data-[hovered]:bg-surface-muted data-[disabled]:cursor-not-allowed data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted data-[pending]:cursor-progress',
        FOCUS_RING,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-surface-muted">
        <Icon aria-hidden="true" size={20} strokeWidth={ICON_STROKE} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span id={titleId} className="font-semibold">{title}</span>
        {description === undefined ? null : (
          <span id={descriptionId} className="text-small text-ink-muted">
            {description}
          </span>
        )}
      </span>
      {isPending ? <span id={loadingId} className="sr-only">
          {en.common.loading}
        </span> : null}
      <ChevronRight aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="ms-auto shrink-0 text-ink-muted" />
    </Button>
  )
}
