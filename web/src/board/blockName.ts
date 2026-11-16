import { he } from '../i18n/he'
import type { Block } from './types'

// The name every button and menu of a block uses (S18 decision 14c): the task's title, and for a
// split task also its part, so two parts of one task on one day never share a name. The part and
// not the hour: it is unique within the task on every screen and does not depend on the timezone.
export function blockName(block: Pick<Block, 'task_title' | 'part_index' | 'part_count'>): string {
  if (block.part_count <= 1) return block.task_title
  return he.board.partName(block.task_title, he.board.part(block.part_index, block.part_count))
}
