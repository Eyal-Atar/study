import eureka450 from '../assets/archie/eureka-450.webp'
import eureka900 from '../assets/archie/eureka-900.webp'
import flow450 from '../assets/archie/flow-450.webp'
import flow900 from '../assets/archie/flow-900.webp'
import intentions450 from '../assets/archie/intentions-450.webp'
import intentions900 from '../assets/archie/intentions-900.webp'
import joy450 from '../assets/archie/joy-450.webp'
import joy900 from '../assets/archie/joy-900.webp'
import rest450 from '../assets/archie/rest-450.webp'
import rest900 from '../assets/archie/rest-900.webp'
import wisdom450 from '../assets/archie/wisdom-450.webp'
import wisdom900 from '../assets/archie/wisdom-900.webp'

export type ArchieMood = 'intentions' | 'eureka' | 'wisdom' | 'flow' | 'rest' | 'joy'

export interface MoodArt {
  // The cut-out in two widths (cwebp, with alpha): the full width of the cut, and 450px.
  small: string
  large: string
  // The size of the large file, for its srcset width and for the img's width and height (the
  // browser reserves the space before the file arrives). Every mood has its own proportions:
  // the cut-out is as big as the character and what he holds, with no sky around it.
  width: number
  height: number
  // The avatar: a square cut of the head and the top of the shoulders. x and size are fractions
  // of the width, y of the height; (x, y) is the top left corner of the square. The top and the
  // sides of the square lie in the transparent part of the cut-out beside the head; where a
  // shoulder reaches a side (he leans in intentions, wisdom and flow) and at the bottom, the
  // avatar fades out (archie.css), so no edge of the square shows.
  bust: { x: number; y: number; size: number }
}

// The six cut-outs (S39): the same illustrations as S31, with the sky and everything painted on
// it removed (eureka's halo and sparkles, rest's cherry branches, flow's branch, rocks and
// hills). intentions, eureka, wisdom and joy are cut flat at the bottom, where the old frame cut
// them: they stand on the lower edge of their box.
export const MOOD_ART: Record<ArchieMood, MoodArt> = {
  intentions: { small: intentions450, large: intentions900, width: 653, height: 645, bust: { x: 0.323, y: 0.022, size: 0.322 } },
  eureka: { small: eureka450, large: eureka900, width: 582, height: 543, bust: { x: 0.328, y: 0.022, size: 0.34 } },
  wisdom: { small: wisdom450, large: wisdom900, width: 892, height: 630, bust: { x: 0.374, y: 0.032, size: 0.248 } },
  flow: { small: flow450, large: flow900, width: 634, height: 506, bust: { x: 0.257, y: 0.028, size: 0.308 } },
  rest: { small: rest450, large: rest900, width: 900, height: 599, bust: { x: 0.412, y: 0.035, size: 0.211 } },
  joy: { small: joy450, large: joy900, width: 702, height: 654, bust: { x: 0.313, y: 0.02, size: 0.406 } },
}

export const ARCHIE_MOODS = Object.keys(MOOD_ART) as ArchieMood[]
