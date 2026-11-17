import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { GOODBYE_PATH, SETTINGS_PATH } from '../app/routes'
import { useAuth } from '../auth/AuthContext'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { ButtonLink } from '../ui/ButtonLink'
import { Card } from '../ui/Card'
import { PageHeader } from '../ui/PageHeader'
import { SectionHeading } from '../ui/SectionHeading'
import { TextField } from '../ui/TextField'
import { TextLink } from '../ui/TextLink'
import { useToast } from '../ui/useToast'
import { useDeleteAccount } from './api'
import { EXPORT_SECTION_ID } from './SettingsPage'

const t = he.settings.deleteAccount

// /settings/delete-account. No 10-second "בטל" toast here, unlike other destructive actions
// (spec 7.9): S15 decision 9 — the owner chose an immediate delete with no grace period, and an
// undo would mean keeping the data for 10 seconds after the user confirmed. Typing the word on
// this screen replaces it: it stops a press by mistake, which is what "בטל" is for.
export function DeleteAccountPage() {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const toast = useToast()
  const deleteAccount = useDeleteAccount()
  const whatId = useId()
  const [word, setWord] = useState('')
  // A second press before the re-render that disables the button must not send a second DELETE.
  const sending = useRef(false)

  const confirmed = word.trim() === t.confirmWord

  async function remove() {
    if (!confirmed || sending.current) return
    sending.current = true
    try {
      await deleteAccount.mutateAsync(undefined)
    } catch (error) {
      sending.current = false
      toast.show({ text: errorMessage(error), tone: 'error' })
      return
    }
    // Leave the signed-in routes first, and render /goodbye before signing out: the router commits
    // a navigation in a transition, so a sign-out right after it would render this page signed out
    // first, and RequireAuth would send the user to /login. flushSync commits the new page at once.
    await navigate(GOODBYE_PATH, { replace: true, flushSync: true })
    await signOut()
  }

  const pending = deleteAccount.isPending || deleteAccount.isSuccess

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.title} />
      <p className="max-w-prose text-body text-ink">{t.intro}</p>

      <section aria-labelledby={whatId} className="flex flex-col gap-2">
        <SectionHeading id={whatId}>{t.whatTitle}</SectionHeading>
        <ul className="list-disc ps-5 text-body text-ink">
          {t.what.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <p className="max-w-prose text-small text-ink-muted">
        {t.exportFirst} <TextLink to={`${SETTINGS_PATH}#${EXPORT_SECTION_ID}`}>{t.exportLink}</TextLink>
      </p>

      {/* The only card of the screen, and its only red: the step that cannot be undone. */}
      <Card tone="danger" className="max-w-xl">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void remove()
          }}
        >
          <TextField label={t.confirmLabel} value={word} onChange={setWord} autoComplete="off" isDisabled={pending} />
          {/* The delete button first in reading order; stacked and full width on a phone. */}
          <div className="flex flex-col gap-3 md:flex-row">
            <Button type="submit" variant="danger" isDisabled={!confirmed} isPending={pending}>
              {t.submit}
            </Button>
            <ButtonLink to={SETTINGS_PATH} variant="secondary">
              {t.back}
            </ButtonLink>
          </div>
        </form>
      </Card>
    </div>
  )
}
