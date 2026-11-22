import type { ReactNode } from 'react'
import { Archie, type ArchieMood } from '../archie/Archie'
import { MOOD_ART } from '../archie/moods'
import { cx } from '../ui/styles'

// How tall Archi stands, in px: 92 beside his opening line (the .lead of the prototype's side
// panel), 50 beside a line of a strip or a banner.
const HEIGHT = { md: 92, sm: 50 } as const

// Archi and, beside him, what he says. He stands straight on the surface he is on, with his feet
// on the lower edge of this row: no bubble, no frame and nothing painted behind him, so whatever
// comes right under the row is what he stands on. His picture is named by its mood, since the
// mood is part of what he says.
export function ArchiSays({ mood, children, size = 'md' }: { mood: ArchieMood; children: ReactNode; size?: 'sm' | 'md' }) {
  const art = MOOD_ART[mood]
  // Archie fills the width of its place, at the proportions of the art: the width that makes it
  // exactly this tall.
  const width = Math.round((HEIGHT[size] * art.width) / art.height)
  return (
    <div className={cx('flex items-end', size === 'md' ? 'gap-2.5 ps-1' : 'gap-2')}>
      <div data-archi-says="" className="shrink-0" style={{ width }}>
        <Archie mood={mood} />
      </div>
      <p className={cx('min-w-0', size === 'md' ? 'pb-2.5 text-[17px] leading-[1.3] font-semibold' : 'pb-2')}>{children}</p>
    </div>
  )
}
