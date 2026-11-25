import { en } from '../i18n/en'
import { clockOf, DAY_STARTS_MIN, DUSK_STARTS_MIN, THEME_CHOICES, type ThemeChoice } from '../theme/theme'
import { useTheme } from '../theme/ThemeProvider'
import { Card } from '../ui/Card'
import { SegmentedControl } from '../ui/SegmentedControl'

const t = en.settingsScreen.appearance

const OPTIONS = THEME_CHOICES.map((id) => ({ id, label: t[id] }))

// What the chosen option means, under it: the hours of Auto come from the rule itself, so the text
// can never say a different hour than the one the theme switches at.
function noteOf(choice: ThemeChoice): string {
  if (choice === 'day') return t.dayNote
  if (choice === 'dusk') return t.duskNote
  return t.autoNote(clockOf(DUSK_STARTS_MIN), clockOf(DAY_STARTS_MIN))
}

// S43: Auto, Day or Dusk. A SegmentedControl, since a choice applies at once and is not part of the
// preferences' Save (decision 5); kept on this device, so it does not wait for GET /me.
export function AppearanceSection() {
  // Not destructured: ThemeState declares setChoice as a method (unbound-method).
  const theme = useTheme()
  const { choice } = theme
  return (
    <Card role="region" title={t.title}>
      <p className="mb-4 max-w-prose text-small text-ink-muted">{t.intro}</p>
      <SegmentedControl
        aria-label={t.label}
        options={OPTIONS}
        value={choice}
        onChange={(next) => {
          theme.setChoice(next)
        }}
      />
      <p className="mt-3 max-w-prose text-small text-ink-muted">{noteOf(choice)}</p>
      <p className="mt-1 max-w-prose text-small text-ink-muted">{t.device}</p>
    </Card>
  )
}
