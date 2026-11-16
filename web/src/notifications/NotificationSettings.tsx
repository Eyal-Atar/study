import { useEffect, useId, useState } from 'react'
import { ApiError, errorMessage } from '../api/client'
import { useMe, useUserId } from '../api/me'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { RadioCards } from '../ui/RadioCards'
import { useToast } from '../ui/useToast'
import { useDeleteSubscription, useRegisterSubscription, useSetLeadMinutes, type LeadMinutes } from './api'
import { currentSubscription, pushSupport, subscribe, toSubscriptionBody } from './push'
import { usePushState } from './pushContext'

type Device = 'checking' | 'off' | 'on' | 'blocked'

const SECTION = 'space-y-4 rounded-xl border border-line bg-surface p-4'

// The reminder settings (S16): whether this device gets reminders, and how long before a block.
// Self-contained, so S15's settings screen can render it as is (decision 18).
export function NotificationSettings() {
  return (
    <div className="space-y-4">
      <DeviceReminders />
      <LeadTime />
    </div>
  )
}

// Reminders on this device: a subscription per browser (decision 8), so "כיבוי" here leaves the
// other devices on.
function DeviceReminders() {
  const titleId = useId()
  const { vapidPublicKey } = usePushState()
  // Read once: support does not change while the page is open.
  const [support] = useState(pushSupport)

  let body
  if (vapidPublicKey === null) {
    body = <p className="text-ink-muted">{he.notifications.notConfigured}</p>
  } else if (support === 'ios_not_installed') {
    body = <IosSteps />
  } else if (support === 'unsupported') {
    body = <p className="text-ink-muted">{he.notifications.unsupported}</p>
  } else {
    body = <Toggle vapidPublicKey={vapidPublicKey} />
  }

  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className="text-lg font-bold">
        {he.notifications.deviceTitle}
      </h2>
      {body}
    </section>
  )
}

// Decision 17: on iOS, Push exists only in the app added from Safari to the home screen.
function IosSteps() {
  return (
    <div className="space-y-2">
      <p className="font-medium">{he.notifications.iosTitle}</p>
      <ol className="list-decimal space-y-1 ps-5 text-ink-muted">
        {he.notifications.iosSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  )
}

function Blocked() {
  return (
    <div className="space-y-2">
      <p className="font-medium">{he.notifications.blockedTitle}</p>
      <p className="text-sm text-ink-muted">{he.notifications.blockedBrowser}</p>
      <p className="text-sm text-ink-muted">{he.notifications.blockedApp}</p>
    </div>
  )
}

function failureText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? errorMessage(error) : fallback
}

function Toggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const userId = useUserId()
  const { known } = usePushState()
  const toast = useToast()
  const { mutateAsync: register } = useRegisterSubscription()
  const { mutateAsync: remove } = useDeleteSubscription()
  const [device, setDevice] = useState<Device>(() => (Notification.permission === 'denied' ? 'blocked' : 'checking'))
  const [busy, setBusy] = useState(false)

  // "On" means the browser holds a subscription and may show notifications. The server side is kept
  // in step by PushSync, so it is not asked here.
  useEffect(() => {
    if (device !== 'checking') return
    let live = true
    currentSubscription().then(
      (sub) => {
        if (live) setDevice(sub !== null && Notification.permission === 'granted' ? 'on' : 'off')
      },
      () => {
        if (live) setDevice('off')
      },
    )
    return () => {
      live = false
    }
  }, [device])

  function enable() {
    setBusy(true)
    // Called before any await: iOS shows the permission prompt only inside the user's gesture.
    const asked = Notification.requestPermission()
    void (async () => {
      try {
        const permission = await asked
        if (permission === 'denied') {
          setDevice('blocked')
          return
        }
        if (permission !== 'granted') {
          toast.show({ text: he.notifications.notAllowed, tone: 'error' })
          return
        }
        let sub: PushSubscription
        try {
          sub = await subscribe(vapidPublicKey)
        } catch {
          toast.show({ text: he.notifications.enableFailed, tone: 'error' })
          return
        }
        try {
          await register(toSubscriptionBody(sub))
        } catch (error) {
          // The server does not know this subscription, so the browser drops it too: "off" stays true
          // on the next load as well, instead of PushSync silently turning it on.
          await sub.unsubscribe().catch(() => false)
          toast.show({ text: failureText(error, he.notifications.enableFailed), tone: 'error' })
          return
        }
        setDevice('on')
        toast.show({ text: he.notifications.enabled, tone: 'success' })
      } finally {
        setBusy(false)
      }
    })()
  }

  function disable() {
    setBusy(true)
    void (async () => {
      try {
        const sub = await currentSubscription()
        if (sub === null) {
          setDevice('off')
          return
        }
        // The id from PushSync or the enable above; without one (the sync failed), the POST is an
        // upsert that answers with the existing row's id.
        const knownSub = userId === null ? undefined : known.get(userId)
        const id =
          knownSub !== undefined && knownSub.endpoint === sub.endpoint
            ? knownSub.id
            : (await register(toSubscriptionBody(sub))).id
        try {
          await remove(id)
        } catch (error) {
          // Already gone on the server (another device's sign-in took the endpoint): nothing to delete.
          if (!(error instanceof ApiError && error.status === 404)) throw error
        }
        await sub.unsubscribe()
        setDevice('off')
        toast.show({ text: he.notifications.disabled, tone: 'success' })
      } catch (error) {
        toast.show({ text: failureText(error, he.notifications.disableFailed), tone: 'error' })
      } finally {
        setBusy(false)
      }
    })()
  }

  if (device === 'blocked') return <Blocked />

  const on = device === 'on'
  const statusText = device === 'checking' ? he.notifications.checking : on ? he.notifications.on : he.notifications.off
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="flex items-center gap-2">
        <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${on ? 'bg-success' : 'bg-line-strong'}`} />
        <span className={on ? 'font-medium text-success' : 'text-ink-muted'}>{statusText}</span>
      </p>
      {device === 'checking' ? null : on ? (
        <Button variant="secondary" isDisabled={busy} onPress={disable}>
          {he.notifications.disable}
        </Button>
      ) : (
        <Button isDisabled={busy} onPress={enable}>
          {he.notifications.enable}
        </Button>
      )}
    </div>
  )
}

const LEAD_OPTIONS = [
  { value: '0', label: he.notifications.lead0 },
  { value: '5', label: he.notifications.lead5 },
  { value: '10', label: he.notifications.lead10 },
  { value: '15', label: he.notifications.lead15 },
] as const

function isLead(value: number): value is LeadMinutes {
  return value === 0 || value === 5 || value === 10 || value === 15
}

// A profile setting (decision 10), so it is shown even where this device cannot get reminders.
// Saved on change; while the PATCH runs the chosen option already shows as chosen.
function LeadTime() {
  const me = useMe()
  const toast = useToast()
  const save = useSetLeadMinutes()

  let body
  if (me.data !== undefined) {
    const value = save.isPending ? save.variables : me.data.notify_lead_minutes
    body = (
      <RadioCards
        label={he.notifications.leadLabel}
        options={LEAD_OPTIONS}
        value={String(value)}
        columns="grid-cols-2 sm:grid-cols-4"
        onChange={(next) => {
          const minutes = Number(next)
          if (!isLead(minutes)) return
          save.mutate(minutes, {
            onSuccess: () => toast.show({ text: he.notifications.leadSaved, tone: 'success' }),
            onError: (error) => toast.show({ text: errorMessage(error), tone: 'error' }),
          })
        }}
      />
    )
  } else if (me.isError) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-danger">{errorMessage(me.error)}</p>
        <Button variant="secondary" onPress={() => void me.refetch()}>
          {he.common.retry}
        </Button>
      </div>
    )
  } else {
    body = <p className="text-ink-muted">{he.common.loading}</p>
  }

  return (
    <section className={SECTION}>
      {body}
      <p className="text-sm text-ink-muted">{he.notifications.leadHint}</p>
    </section>
  )
}
