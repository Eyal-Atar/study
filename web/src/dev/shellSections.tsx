import { CircleCheck } from 'lucide-react'
import { Logo } from '../app/Logo'
import { ProgressChipView, type ChipProgress } from '../app/ProgressChip'
import { Button } from '../ui/Button'
import { ICON_STROKE } from '../ui/styles'
import { devText } from './devText'
import { Example, FIELD_GRID, Section } from './Section'

const t = devText

// Fixed numbers for the chip: this page has no API and no signed-in user, so it gives the chip's
// view the data that the shell reads from GET /progress. 240 of the 1000 XP to the next level.
const PROGRESS: ChipProgress = {
  streak: { current: t.shell.streak },
  level: t.shell.level,
  total_xp: 1240,
  level_start_xp: 1000,
  next_level_xp: 2000,
}

// The pieces of the shell (S31): the logo of the top bar, the progress chip, and the dark toast
// with the inverse button. The toast here is its look alone; the toast section opens real ones.
export function ShellSection() {
  return (
    <Section id="shell">
      <div className={FIELD_GRID}>
        <Example caption={t.shell.logo}>
          <Logo />
        </Example>
        <Example caption={t.shell.chip}>
          <ProgressChipView progress={PROGRESS} />
        </Example>
        <Example caption={t.shell.toast} className="md:col-span-2">
          <div className="flex min-h-14 max-w-sm items-center gap-2 rounded-card bg-inverse px-4 py-2 text-on-inverse shadow-overlay">
            <CircleCheck aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="shrink-0 text-inverse-success" />
            <p className="min-w-0 flex-1 text-small">{t.shell.toastText}</p>
            <Button variant="inverse">{t.shell.undo}</Button>
          </div>
        </Example>
      </div>
    </Section>
  )
}
