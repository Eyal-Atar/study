import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { GOODBYE_PATH, SETTINGS_PATH } from '../app/routes'
import { useAuth } from '../auth/AuthContext'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { TextField } from '../ui/TextField'
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
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-ink">{t.title}</h1>
        <p className="text-ink">{t.intro}</p>
      </div>

      <section aria-labelledby="delete-what" className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
        <h2 id="delete-what" className="text-base font-semibold text-ink">
          {t.whatTitle}
        </h2>
        <ul className="list-disc ps-5 text-sm text-ink">
          {t.what.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-ink-muted">
        {t.exportFirst}{' '}
        <Link
          to={`${SETTINGS_PATH}#${EXPORT_SECTION_ID}`}
          className="font-medium text-brand-strong underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {t.exportLink}
        </Link>
      </p>

      <form
        noValidate
        className="flex flex-col gap-4 rounded-xl border border-line bg-danger-soft p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void remove()
        }}
      >
        <TextField label={t.confirmLabel} value={word} onChange={setWord} autoComplete="off" isDisabled={pending} />
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Link
            to={SETTINGS_PATH}
            className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-brand-strong outline-none hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand"
          >
            {t.back}
          </Link>
          <Button type="submit" variant="danger" isDisabled={!confirmed || pending}>
            {pending ? t.deleting : t.submit}
          </Button>
        </div>
      </form>
    </div>
  )
}
