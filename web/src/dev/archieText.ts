import type { ArchieMood } from '../archie/moods'

// The texts of the Archie section of the components page (S31, Task 8; S39: English, and the
// character with no background). Its own file, beside devText.ts, and its own entry of the table
// of contents, joined to SECTIONS in ComponentsPage. Captions are for the developer; `lines` are
// product text in Archi's voice (docs/design/archi-voice.md): first person, calm.
export const ARCHIE_SECTIONS = [{ id: 'archie', title: 'Archi, the character (Archie)' }] as const

export type ArchieSectionId = (typeof ARCHIE_SECTIONS)[number]['id']

export const archieText = {
  caption:
    'The cut-paper character in six moods. The cut-outs are transparent: no sky, no frame and no circle, so each one is shown twice here, on the canvas and on a surface. The art is never redrawn: the motion is a layer over it, runs only while it is on screen, and stops completely for anyone who asked the system for less motion.',
  surfaces: {
    canvas: 'On the canvas (bg-canvas, the page itself)',
    surface: 'On a surface (bg-surface, a card)',
  },
  cards: 'card: the whole cut-out at the width of its place, with the motion layer of its mood. The ones cut flat at the bottom stand on the lower edge.',
  scene: 'scene: the same, centred, and never wider than the pixels of the art',
  avatars: 'avatar: head and shoulders, fading out below, no motion. 40px by default; the last two are joy at 64px (size-16) and at the 34px of the logo',
  says: 'Beside a line of text, as in a message from Archi (the avatar is decorative here)',
  moods: {
    intentions: 'intentions: drops, sprouts, a page and autumn leaves',
    eureka: 'eureka: a halo behind his head, sparks and gold flecks',
    wisdom: 'wisdom: an ink line and incense smoke',
    flow: 'flow: ripples in the sand and a falling leaf',
    rest: 'rest: steam from both cups and petals',
    joy: 'joy: a glowing stone, sparks and a leaf',
  } satisfies Record<ArchieMood, string>,
  lines: {
    intentions: 'Share your materials, and I’ll build tasks from them.',
    eureka: 'That’s every block for today.',
    wisdom: 'I’m reading your materials…',
    flow: 'One block at a time. The next one starts at 16:00.',
    rest: 'Nothing more for today. Rest well.',
    joy: 'Hi, I’m Archi. What exams are we preparing for?',
  } satisfies Record<ArchieMood, string>,
}
