import { ARCHI_ICONS } from '../ui/icons'
import { devText } from './devText'
import { Section } from './Section'

const t = devText

// The sizes the icons are used at: inline with small text, the default, and a large one.
const SIZES = [16, 20, 24] as const

// Every icon drawn for Archi, by name, at three sizes. An icon is decoration here (no label), and
// the name next to it is what a screen reader reads.
export function IconsSection() {
  return (
    <Section id="icons">
      <p className="text-small text-ink-muted">{t.icons.caption}</p>
      <ul role="list" className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {Object.entries(ARCHI_ICONS).map(([name, Icon]) => (
          <li key={name} data-icon={name} className="flex min-w-0 items-center gap-3 rounded-control border border-line px-3 py-2">
            <span className="flex shrink-0 items-center gap-3 text-ink">
              {SIZES.map((size) => (
                <span key={size} data-size={size} className="inline-flex">
                  <Icon size={size} />
                </span>
              ))}
            </span>
            <span dir="ltr" className="truncate text-small">
              {name}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
