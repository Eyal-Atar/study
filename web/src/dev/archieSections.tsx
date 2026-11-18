import { Archie } from '../archie/Archie'
import { ARCHIE_MOODS } from '../archie/moods'
import { archieText } from './archieText'
import { Example, ROW, Section } from './Section'

const t = archieText

// Archie (S31, Task 8): the six moods as cards, one as a scene, and the six avatars. The cards
// are decorative here, since the caption above each one already names it.
export function ArchieSection() {
  return (
    <Section id="archie">
      <p className="text-small text-ink-muted">{t.caption}</p>
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
        <Archie mood="flow" size="scene" />
      </Example>
      <Example caption={t.avatars}>
        <div className={ROW}>
          {ARCHIE_MOODS.map((mood) => (
            <Archie key={mood} mood={mood} size="avatar" />
          ))}
          <Archie mood="joy" size="avatar" className="size-16" />
        </div>
      </Example>
    </Section>
  )
}
