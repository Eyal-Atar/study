import { Archie } from '../archie/Archie'
import { ARCHIE_MOODS } from '../archie/moods'
import { cx } from '../ui/styles'
import { archieText } from './archieText'
import { Example, ROW, Section } from './Section'

const t = archieText

// The two things Archie stands on in the app. He has no background of his own (S39), so the same
// three sizes are shown on each: what shows around him is the surface, and nothing else.
const SURFACES = [
  { id: 'canvas', className: 'bg-canvas' },
  { id: 'surface', className: 'bg-surface' },
] as const

// Archie (S31, Task 8; S39): on each surface, the six moods as cards, as scenes and as avatars,
// and the avatar beside a line of his. The cards are decorative here, since the caption above
// each one already names it; so are the avatars beside a line.
export function ArchieSection() {
  return (
    <Section id="archie">
      <p className="text-small text-ink-muted">{t.caption}</p>
      {SURFACES.map((surface) => (
        <Example key={surface.id} caption={t.surfaces[surface.id]}>
          <div data-surface={surface.id} className={cx('space-y-8 rounded-card border border-line p-4 md:p-6', surface.className)}>
            <Example caption={t.cards}>
              <div className="grid items-end gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {ARCHIE_MOODS.map((mood) => (
                  <Example key={mood} caption={t.moods[mood]}>
                    <Archie mood={mood} size="card" decorative />
                  </Example>
                ))}
              </div>
            </Example>
            <Example caption={t.scene}>
              <div className="grid items-end gap-6 lg:grid-cols-2">
                {ARCHIE_MOODS.map((mood) => (
                  <Archie key={mood} mood={mood} size="scene" />
                ))}
              </div>
            </Example>
            <Example caption={t.avatars}>
              <div className={ROW}>
                {ARCHIE_MOODS.map((mood) => (
                  <Archie key={mood} mood={mood} size="avatar" />
                ))}
                <Archie mood="joy" size="avatar" className="size-16" />
                <Archie mood="joy" size="avatar" className="size-[34px]" />
              </div>
            </Example>
            <Example caption={t.says}>
              <ul className="grid gap-3 md:grid-cols-2">
                {ARCHIE_MOODS.map((mood) => (
                  <li key={mood} className="flex items-center gap-3">
                    <Archie mood={mood} size="avatar" decorative className="size-12" />
                    <p className="text-body">{t.lines[mood]}</p>
                  </li>
                ))}
              </ul>
            </Example>
          </div>
        </Example>
      ))}
    </Section>
  )
}
