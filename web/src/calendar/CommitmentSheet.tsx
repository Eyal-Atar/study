import type { BusyItem } from '../availability/types'
import { formatRange } from '../board/time'
import { en } from '../i18n/en'
import { ButtonLink } from '../ui/ButtonLink'
import { Dialog } from '../ui/Dialog'
import { UserText } from '../ui/UserText'

export interface CommitmentSheetProps {
  item: BusyItem | null
  tz: string
  onClose: () => void
}

// A weekly commitment on the calendar: what it is, and the way to change it (the settings).
export function CommitmentSheet({ item, tz, onClose }: CommitmentSheetProps) {
  const c = en.calendar.sheets.commitment
  const kind = c.kinds[item?.kind ?? 'other']
  const title =
    item === null ? null : item.title === null || item.title === '' ? kind : <UserText>{item.title}</UserText>
  return (
    <Dialog
      title={title}
      isOpen={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {item === null ? null : (
        <>
          <div className="flex flex-col">
            <span className="font-semibold">{kind}</span>
            <span className="text-small text-ink-muted tabular-nums">{formatRange(item, tz)}</span>
          </div>
          <p>{c.lead}</p>
          <ButtonLink to="/settings">{c.edit}</ButtonLink>
        </>
      )}
    </Dialog>
  )
}
