import type { CommitmentKind } from '../availability/types'
import { CalendarClock, ClassIcon, WorkIcon, type IconType } from '../ui/icons'

const ICONS: Record<CommitmentKind, IconType> = {
  work: WorkIcon,
  class: ClassIcon,
  other: CalendarClock,
}

export function kindIcon(kind: CommitmentKind): IconType {
  return ICONS[kind]
}
