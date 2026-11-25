import type { ClosureItem } from '../closure/types'
import { en } from '../i18n/en'
import { Row } from './BannerRow'

// The closure row of the banner (S45): while an exam waits for the student's decision, Archi asks
// how it felt, and "Tell me" opens the closure sheet of the first one (the server sorts them by
// date). It opens a sheet, not a panel in place, so it is never "open" among the banner's rows.
export function ClosureRow({ pending, onOpen }: { pending: readonly [ClosureItem, ...ClosureItem[]]; onOpen: (examId: string) => void }) {
  const [first] = pending
  return (
    <Row
      name="closure"
      mood="eureka"
      opensDialog
      label={en.closure.row.open}
      onToggle={() => {
        onOpen(first.exam_id)
      }}
    >
      {pending.length === 1 ? en.closure.row.say(first.exam_name) : en.closure.row.sayMany(pending.length)}
    </Row>
  )
}
