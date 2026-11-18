import { Archie } from '../archie/Archie'
import { he } from '../i18n/he'

// The logo of the all-screens mockup (.logo, S31 decision 29): Archie's joy as a 34px avatar and
// the name beside it in the display font, Amatic SC at 30px. Archie is decoration (alt=""): the
// name is the text. The name itself stays StudyFlow (decision 24). The same at both widths.
export function Logo() {
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-2">
      <Archie mood="joy" size="avatar" decorative className="size-[34px]" />
      <span className="truncate font-display text-[1.875rem] leading-none font-bold">{he.appName}</span>
    </span>
  )
}
