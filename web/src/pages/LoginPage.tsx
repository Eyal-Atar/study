import { useState } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { Archie } from '../archie/Archie'
import { en } from '../i18n/en'
import { InkButton } from '../ui/InkButton'
import { TextLink } from '../ui/TextLink'

const t = en.entry.login

// The first impression of the product (prototype s1, "Sign-in"; decisions 3, 14 and 20): Archi
// himself on the page, a line under him, the name in his handwriting, one sentence, and the dark
// Google button. On a phone it is one column; from lg, Archi is on one side and the rest on the
// other. The name is the h1, and nothing else here is a heading.
export function LoginPage() {
  const auth = useAuth()
  const [failed, setFailed] = useState(false)
  const [isPending, setIsPending] = useState(false)

  if (auth.status === 'signed_in') return <Navigate to="/" replace />

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-5xl content-center gap-8 px-page py-10 lg:grid-cols-2 lg:items-center lg:gap-16">
      <div className="border-b border-line pb-6 lg:border-b-0 lg:pb-0">
        <div className="mx-auto w-full max-w-xs lg:max-w-md">
          <Archie mood="joy" size="scene" eager />
        </div>
      </div>
      <div className="flex flex-col gap-6 text-center lg:text-start">
        <div>
          <h1 className="font-display text-[3.5rem] leading-none font-bold tracking-[0.01em] break-words text-ink">{en.appName}</h1>
          <p className="mx-auto mt-3 max-w-prose text-body text-ink-muted lg:mx-0">{en.tagline}</p>
        </div>
        <div className="flex flex-col gap-3">
          <InkButton
            isPending={isPending}
            className="w-full lg:w-auto lg:self-start"
            onPress={() => {
              setFailed(false)
              setIsPending(true)
              // On success the browser leaves for Google, and comes back to AUTH_CALLBACK_PATH.
              // The button is released then too: a page that the browser restores on "back" must
              // not come back with a button that is still waiting.
              auth
                .signInWithGoogle()
                .catch(() => {
                  setFailed(true)
                })
                .finally(() => {
                  setIsPending(false)
                })
            }}
          >
            <span
              aria-hidden="true"
              className="flex size-6 items-center justify-center rounded-full bg-surface text-small font-bold text-ink"
            >
              {t.googleLetter}
            </span>
            {en.login.google}
          </InkButton>
          {failed && (
            <p role="alert" className="text-small text-danger">
              {en.login.failed}
            </p>
          )}
          <p className="text-small text-ink-muted">
            {t.agreeBefore}
            <TextLink to="/terms">{t.terms}</TextLink>
            {t.agreeAnd}
            <TextLink to="/privacy">{t.privacy}</TextLink>
            {t.agreeAfter}
          </p>
        </div>
      </div>
    </main>
  )
}
