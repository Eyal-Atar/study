import { Archie } from '../archie/Archie'
import { en } from '../i18n/en'

// The logo (S31 decision 29; S39): Archi's joy as a 34px avatar, a bust with no circle behind it,
// and the name beside it in the display font, Amatic SC bold at 30px. Amatic SC draws Latin as
// tall capitals, so the name stands as high as his head and the two share a centre line. Archi
// is decoration here (alt=""): the name is the text. The same at both widths.
export function Logo() {
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-2">
      <Archie mood="joy" size="avatar" decorative eager className="size-[34px]" />
      <span className="truncate font-display text-[1.875rem] leading-none font-bold">{en.appName}</span>
    </span>
  )
}
