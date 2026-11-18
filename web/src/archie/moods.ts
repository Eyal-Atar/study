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
  // The illustration in two widths (cwebp -q 82: the full width of the cut, and 450px).
  small: string
  large: string
  // The size of the large file, for its srcset width and for the img's width and height (the
  // browser reserves the space before the file arrives).
  width: number
  height: number
  // The avatar: the point of the face (a fraction of the width and of the height of the
  // illustration) that sits in the middle of the circle, and how many circles fit across the
  // illustration. Found by looking at each cut: the head and the top of the beard fill the circle.
  face: { x: number; y: number; zoom: number }
}

// The six scenes: five moods cut from Eyal's sheet on the "שחר" sky, and the sixth, Archie
// smiling (joy). flow has its own sand garden and no sky variant.
export const MOOD_ART: Record<ArchieMood, MoodArt> = {
  intentions: { small: intentions450, large: intentions900, width: 897, height: 651, face: { x: 0.45, y: 0.24, zoom: 3 } },
  eureka: { small: eureka450, large: eureka900, width: 900, height: 651, face: { x: 0.5, y: 0.34, zoom: 3 } },
  wisdom: { small: wisdom450, large: wisdom900, width: 897, height: 651, face: { x: 0.52, y: 0.3, zoom: 3 } },
  flow: { small: flow450, large: flow900, width: 900, height: 660, face: { x: 0.51, y: 0.29, zoom: 3.5 } },
  rest: { small: rest450, large: rest900, width: 897, height: 660, face: { x: 0.51, y: 0.27, zoom: 3.2 } },
  joy: { small: joy450, large: joy900, width: 897, height: 660, face: { x: 0.49, y: 0.26, zoom: 2.6 } },
}

export const ARCHIE_MOODS = Object.keys(MOOD_ART) as ArchieMood[]
