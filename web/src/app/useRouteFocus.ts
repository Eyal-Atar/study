import { useEffect, useRef, type RefObject } from 'react'
import { NavigationType, useLocation, useNavigationType } from 'react-router'

// In a single-page app a move between screens loads no page: a screen reader announces nothing,
// and the focus stays on the link that was pressed, in the navigation. After a navigation the user
// started, this moves the focus to the h1 of the new screen (to <main> while the screen has none
// yet), so the title is read and the next Tab starts in the content.
//
// The focus does not move:
// - on the first render, where nothing was pressed;
// - on a redirect (REPLACE, like / to /today or the onboarding gate), which the user did not ask for,
//   unless it carries state { focusTitle: true }: a replace the user's own action caused, away from a
//   screen that is gone with the pressed button (S45b: the screen of a deleted exam);
// - when only the search params changed (?from= of the week): it is the same screen.
export function useRouteFocus(main: RefObject<HTMLElement | null>): void {
  const location = useLocation()
  const { pathname } = location
  const state: unknown = location.state
  const focusTitle = isRecord(state) && state.focusTitle === true
  const navigationType = useNavigationType()
  // The pathname the focus was last decided for. It starts as the first one, so the first render
  // (and the second run of the effect under StrictMode) does nothing.
  const handled = useRef(pathname)

  useEffect(() => {
    if (handled.current === pathname) return
    handled.current = pathname
    if (navigationType === NavigationType.Replace && !focusTitle) return
    const container = main.current
    if (container === null) return
    const heading = container.querySelector('h1')
    // Back and forward (POP): the browser restores the scroll position of the screen, and a focus
    // that scrolls to the title would throw it away.
    const options = { preventScroll: navigationType === NavigationType.Pop }
    if (heading === null) {
      container.focus(options)
      return
    }
    // An h1 is not a control: focusable from code, never a Tab stop.
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
    heading.focus(options)
    // focusTitle changes only with a navigation, and the effect decides once per pathname anyway.
  }, [pathname, navigationType, focusTitle, main])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
