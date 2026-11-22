import type { Block, TaskKind } from '../board/types'
import { localMinutes } from './geometry'

// A preview of where a block would go (or leave, or fail to fit) while a gesture or a sheet is open.
export interface Ghost {
  id: string
  date: string
  startMin: number
  endMin: number
  // null = busy time
  colorIndex: number | null
  title: string
  kind?: TaskKind
  tone: 'target' | 'leaving' | 'problem'
  label?: string
  // A ghost drawn above a block that is leaving: a split's part lands on the block it replaces.
  front?: true
}

export function ghostOf(
  block: Block,
  startsAt: string,
  endsAt: string,
  date: string,
  tz: string,
  tone: Ghost['tone'],
  label?: string,
): Ghost {
  return {
    id: block.id,
    date,
    startMin: localMinutes(startsAt, date, tz),
    endMin: localMinutes(endsAt, date, tz),
    colorIndex: block.exam_color_index,
    title: block.task_title,
    kind: block.task_kind,
    tone,
    ...(label === undefined ? {} : { label }),
  }
}
