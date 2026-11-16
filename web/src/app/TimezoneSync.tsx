import { useEffect, useRef } from 'react'
import { useMe, useUserId } from '../api/me'
import { he } from '../i18n/he'
import { useUpdateMe } from '../onboarding/api'
import { useReplanOffer } from '../plan/replanOfferContext'
import { useToast } from '../ui/useToast'

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

// Spec 7.3: the browser reports its timezone, and the profile follows it. Renders nothing.
// One PATCH /me per user and zone while the app is open (a failed one is not retried, so a server that
// rejects the zone never loops). A changed zone moves the study windows, so a user with a plan gets
// the offer to replan; during the onboarding there is no plan yet, so no offer.
export function TimezoneSync() {
  const me = useMe()
  const userId = useUserId()
  const { mutate: updateMe } = useUpdateMe()
  const toast = useToast()
  const { offer } = useReplanOffer()
  const sent = useRef<string | null>(null)

  const profileZone = me.data?.timezone
  const completed = me.data?.onboarding_completed_at
  useEffect(() => {
    if (userId === null || profileZone === undefined) return
    const zone = browserTimeZone()
    if (zone === undefined || zone === '' || zone === profileZone) return
    const key = `${userId}:${zone}`
    if (sent.current === key) return
    sent.current = key
    updateMe(
      { timezone: zone },
      {
        onSuccess: (answer) => {
          if (!answer.plan_affected || completed === null || completed === undefined) return
          toast.show({
            text: he.replan.timezoneChanged,
            action: {
              label: he.replan.showChange,
              onAction: () => {
                offer(he.replan.timezoneReason)
              },
            },
          })
        },
      },
    )
  }, [userId, profileZone, completed, updateMe, toast, offer])

  return null
}
