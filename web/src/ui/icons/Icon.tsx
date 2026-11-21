import type { JSX, ReactNode } from 'react'

/*
  The base of Archi's own icons. One line for the whole set: a 24 grid, a 1.75 stroke with round
  caps and joins, about 2px of air around the drawing, and a "paper" layer: the main shape of each
  icon is also filled with the current colour at a low opacity, so it reads as a piece of cut paper
  under the line. Nothing has a colour of its own: an icon takes the text colour of where it sits.
*/

export interface IconProps {
  /** Width and height in px. */
  size?: number
  /** The accessible name. With it the icon is an image; without it the icon is decoration. */
  label?: string
  className?: string
}

export type IconComponent = (props: IconProps) => JSX.Element

/** The paper layer: spread onto the main shape of an icon. */
export const PAPER = { fill: 'currentColor', fillOpacity: 0.14 } as const

/** A paper layer with no line of its own, for a shape whose outline is drawn separately. */
export const PAPER_ONLY = { ...PAPER, stroke: 'none' } as const

/** A small solid detail (a dot, a tiny spark). */
export const SOLID = { fill: 'currentColor' } as const

export function createIcon(displayName: string, children: ReactNode): IconComponent {
  function Icon({ size = 20, label, className }: IconProps): JSX.Element {
    const a11y =
      label === undefined
        ? ({ 'aria-hidden': true } as const)
        : ({ role: 'img', 'aria-label': label } as const)
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        className={className}
        {...a11y}
      >
        {children}
      </svg>
    )
  }
  Icon.displayName = displayName
  return Icon
}
