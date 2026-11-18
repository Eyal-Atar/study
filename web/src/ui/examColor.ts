// The colour of an exam (S31). The API gives every exam an index 0-7 (color_index) and every block
// the index of its exam (exam_color_index); this turns an index into the classes of the matching
// --color-exam-N tokens of index.css. Tailwind finds only classes that are written in full in the
// source, so the table below is written out and never built from a template string.
export const EXAM_COLOR_COUNT = 8

export interface ExamColorClasses {
  /** The strong colour as a fill: a stripe, a dot, the card of the next task. */
  solid: string
  /** The strong colour as text (only on its own soft fill, or on surface and canvas). */
  text: string
  /** The soft fill of a block. */
  soft: string
  /** The border of a block. */
  line: string
  /** The strong colour as a border. */
  borderStrong: string
  /** The strong colour as an SVG fill. */
  fill: string
}

const TABLE: readonly ExamColorClasses[] = [
  {
    solid: 'bg-exam-0',
    text: 'text-exam-0',
    soft: 'bg-exam-0-soft',
    line: 'border-exam-0-line',
    borderStrong: 'border-exam-0',
    fill: 'fill-exam-0',
  },
  {
    solid: 'bg-exam-1',
    text: 'text-exam-1',
    soft: 'bg-exam-1-soft',
    line: 'border-exam-1-line',
    borderStrong: 'border-exam-1',
    fill: 'fill-exam-1',
  },
  {
    solid: 'bg-exam-2',
    text: 'text-exam-2',
    soft: 'bg-exam-2-soft',
    line: 'border-exam-2-line',
    borderStrong: 'border-exam-2',
    fill: 'fill-exam-2',
  },
  {
    solid: 'bg-exam-3',
    text: 'text-exam-3',
    soft: 'bg-exam-3-soft',
    line: 'border-exam-3-line',
    borderStrong: 'border-exam-3',
    fill: 'fill-exam-3',
  },
  {
    solid: 'bg-exam-4',
    text: 'text-exam-4',
    soft: 'bg-exam-4-soft',
    line: 'border-exam-4-line',
    borderStrong: 'border-exam-4',
    fill: 'fill-exam-4',
  },
  {
    solid: 'bg-exam-5',
    text: 'text-exam-5',
    soft: 'bg-exam-5-soft',
    line: 'border-exam-5-line',
    borderStrong: 'border-exam-5',
    fill: 'fill-exam-5',
  },
  {
    solid: 'bg-exam-6',
    text: 'text-exam-6',
    soft: 'bg-exam-6-soft',
    line: 'border-exam-6-line',
    borderStrong: 'border-exam-6',
    fill: 'fill-exam-6',
  },
  {
    solid: 'bg-exam-7',
    text: 'text-exam-7',
    soft: 'bg-exam-7-soft',
    line: 'border-exam-7-line',
    borderStrong: 'border-exam-7',
    fill: 'fill-exam-7',
  },
]

/** The index as 0-7: a fraction rounds down, a number outside the range wraps, and a missing
 *  one (an old answer in the cache) is 7, slate, so no screen fails on it. */
export function examColorIndex(index: number | null | undefined): number {
  if (index === null || index === undefined || !Number.isFinite(index)) return EXAM_COLOR_COUNT - 1
  return ((Math.floor(index) % EXAM_COLOR_COUNT) + EXAM_COLOR_COUNT) % EXAM_COLOR_COUNT
}

export function examColor(index: number | null | undefined): ExamColorClasses {
  return TABLE[examColorIndex(index)] as ExamColorClasses
}
