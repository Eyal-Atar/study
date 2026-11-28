import { ProfileMenu } from '../app/ProfileMenu'
import { ProgressChip } from '../app/ProgressChip'
import { en } from '../i18n/en'
import { ChevronLeft, ChevronRight } from '../ui/icons'
import { IconButton } from '../ui/IconButton'
import { cx, ICON_STROKE } from '../ui/styles'
import { shortDate, weekdayLong } from './days'

// The header of the calendar on a phone (the .ph-top of the prototype): the day in words with its
// short date under it, and at the end the streak and level chip and the profile. The shell folds
// its own bar below lg for this screen (S32 decision 2), so the safe area of the notch is padded here,
// unless something sits above the header in the sticky block (the offline notice, S38: `padNotch`).
//
// Between the date and the chip, the previous and next week: the swipe on the grid has a visible
// button (S32 final review, I2). The prototype has no such buttons; a recorded deviation.
export function PhoneHeader({
  date,
  today,
  onWeek,
  padNotch = true,
}: {
  date: string
  today: string
  onWeek: (step: 1 | -1) => void
  padNotch?: boolean
}) {
  const p = en.calendar.page
  return (
    <header className={cx('flex items-center gap-3 bg-surface px-page', padNotch && 'pt-[env(safe-area-inset-top)]')}>
      <div className="min-w-0 flex-1 py-2">
        <h1 className="truncate text-title font-semibold">{date === today ? en.board.today : weekdayLong(date)}</h1>
        <p className="text-small text-ink-muted tabular-nums">{shortDate(date)}</p>
      </div>
      <div role="group" aria-label={p.dateNav} className="flex shrink-0 items-center">
        <IconButton
          aria-label={p.previousWeek}
          onPress={() => {
            onWeek(-1)
          }}
        >
          <ChevronLeft aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        </IconButton>
        <IconButton
          aria-label={p.nextWeek}
          onPress={() => {
            onWeek(1)
          }}
        >
          <ChevronRight aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ProgressChip />
        <ProfileMenu />
      </div>
    </header>
  )
}
