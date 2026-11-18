import { createContext, use, type ReactNode, type ReactPortal } from 'react'
import { createPortal } from 'react-dom'

// The element of the empty place in the header, between the navigation and the progress chip.
// null outside the shell, and in the shell's first render, before the element exists.
const ToolbarSlot = createContext<HTMLElement | null>(null)

// AppShell gives the element of its place to every screen below it.
export function ShellToolbarSlot({ element, children }: { element: HTMLElement | null; children: ReactNode }) {
  return <ToolbarSlot value={element}>{children}</ToolbarSlot>
}

// A screen's controls in the header of the shell (S32: the date controls of the calendar). They are
// still the screen's own: rendered with it, through a portal, with its state and its context, and
// gone when it unmounts. The place is shown from lg only; below lg a screen keeps such controls in
// its own content.
export function ShellToolbar({ children }: { children: ReactNode }): ReactPortal | null {
  const slot = use(ToolbarSlot)
  return slot === null ? null : createPortal(children, slot)
}
