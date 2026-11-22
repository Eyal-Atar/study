import { blockMinutes, durationText, formatRange } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { examColor } from '../ui/examColor'
import { KIND_ICON } from '../ui/icons'
import { ICON_STROKE } from '../ui/styles'
import { UserText } from '../ui/UserText'

// The block at the top of every sheet that is about one block: its kind, its name and when it is.
export function BlockCard({ block, tz }: { block: Block; tz: string }) {
  const KindIcon = KIND_ICON[block.task_kind]
  return (
    <div className="flex items-start gap-2">
      <KindIcon
        aria-hidden="true"
        size={16}
        strokeWidth={ICON_STROKE}
        className={`mt-1 shrink-0 ${examColor(block.exam_color_index).text}`}
      />
      <div className="flex min-w-0 flex-col">
        <UserText truncate className="font-semibold">
          {block.task_title}
        </UserText>
        <span className="text-small text-ink-muted tabular-nums">
          {formatRange(block, tz)}
          {en.board.nextMeta(durationText(blockMinutes(block)), block.exam_name, en.board.kinds[block.task_kind])}
        </span>
      </div>
    </div>
  )
}
