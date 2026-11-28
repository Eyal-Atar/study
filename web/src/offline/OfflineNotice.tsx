import { useQueryClient } from '@tanstack/react-query'
import { todayKey, useBoardUserId } from '../board/api'
import { useProfileTimezone } from '../board/time'
import { en } from '../i18n/en'
import { OfflineIcon } from '../ui/icons'
import { cx } from '../ui/styles'
import { asOf } from './asOf'
import { useReadOnly } from './useReadOnly'

// The one notice of the read-only state (S38): what is shown, as of when, and when actions come back.
// It is the dark banner of the prototype's "Offline" screen, on inverse in both themes, like a toast
// that stays. The state is carried by the words and the crossed-out waves, not by the colour.
// Ordinary content, so no role: it is on the screen for as long as the app is read only, and a live
// region here would be read again on every screen it appears on. OfflineAnnouncer says it, once.
// The time is when "today" was last read: every screen of the calendar refreshes it, so it is the
// honest age of what the device holds. It is read from the cache as it is, without subscribing:
// nothing arrives while the app is read only.
// `className` is for the margins of the place it is put in.
export function OfflineNotice({ className }: { className?: string }) {
  const readOnly = useReadOnly()
  const userId = useBoardUserId()
  const tz = useProfileTimezone()
  const queryClient = useQueryClient()
  if (!readOnly) return null
  const when = asOf(queryClient.getQueryState(todayKey(userId))?.dataUpdatedAt, tz)
  return (
    <div
      data-offline-notice=""
      className={cx('flex items-start gap-2.5 rounded-[14px] bg-inverse px-3.5 py-2.5 text-[13.5px] text-on-inverse', className)}
    >
      {/* The 1px sets the 18px icon on the first line of the sentence, as in the prototype. */}
      <OfflineIcon aria-hidden="true" size={18} className="mt-px shrink-0 text-inverse-danger" />
      <span className="min-w-0">{when === null ? en.offline.noticeNoTime : en.offline.notice(when)}</span>
    </div>
  )
}
