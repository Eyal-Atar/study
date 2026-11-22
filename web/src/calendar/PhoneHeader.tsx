import { ProfileMenu } from '../app/ProfileMenu'
import { ProgressChip } from '../app/ProgressChip'
import { en } from '../i18n/en'
import { shortDate, weekdayLong } from './days'

// The header of the calendar on a phone (the .ph-top of the prototype): the day in words with its
// short date under it, and at the end the streak and level chip and the profile. The shell folds
// its own bar below lg for this screen (S32 decision 2), so the safe area of the notch is padded here.
export function PhoneHeader({ date, today }: { date: string; today: string }) {
  return (
    <header className="flex items-center gap-3 bg-surface px-page pt-[env(safe-area-inset-top)]">
      <div className="min-w-0 flex-1 py-2">
        <h1 className="truncate text-title font-semibold">{date === today ? en.board.today : weekdayLong(date)}</h1>
        <p className="text-small text-ink-muted tabular-nums">{shortDate(date)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ProgressChip />
        <ProfileMenu />
      </div>
    </header>
  )
}
