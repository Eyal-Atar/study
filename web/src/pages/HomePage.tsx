import { useAuth } from '../auth/AuthContext'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'

// A placeholder until Task 5 shows the user from GET /me.
export function HomePage() {
  const { signOut } = useAuth()
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold">{he.appName}</h1>
      <Button
        variant="secondary"
        className="mt-8"
        onPress={() => {
          void signOut()
        }}
      >
        {he.home.signOut}
      </Button>
    </main>
  )
}
