import { en } from '../i18n/en'
import type { Block } from './types'

// What the cards of a block share that is not a component (the old row and "next" card that also
// used this file are gone since S32; the calendar's NextCard still adds the part).

// ". Part 1 of 2" after the details of a split task, else nothing.
export function partSuffix(block: Pick<Block, 'part_index' | 'part_count'>): string {
  return block.part_count > 1 ? en.board.metaPart(en.board.part(block.part_index, block.part_count)) : ''
}
