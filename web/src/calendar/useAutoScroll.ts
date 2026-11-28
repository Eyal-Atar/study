import { useLayoutEffect, useRef, type RefObject } from 'react'

// The space kept above the first block when today is not on screen.
const FIRST_MARGIN_PX = 16
// The phone's header and day strip stay at the top of the window while the page scrolls under them.
export const STICKY_ATTRIBUTE = 'data-calendar-sticky'

// Where the grid opens (S32 decision 13): once for each view and range (`key`), as soon as the grid
// is drawn with its data (`ready`), "now" a third of the way down the visible part, or, without
// today on screen, the first block just under the top. The grid says both, in px from the top of its
// columns (data-now-y, data-first-y). On a computer the grid scrolls in its own box (`scroller`); on
// a phone (no box) the window scrolls, under the sticky header, and never so far that the banner
// goes under it (S32 screenshot pass). Read only there is no banner: the offline notice is part of
// the sticky block (S38), so its height is in `sticky` and now lands below it. A refresh of the data does not
// scroll again: the user may have scrolled since. `behavior: 'auto'`: the page opens where it is,
// with no motion.
export function useAutoScroll(
  scroller: RefObject<HTMLElement | null>,
  grid: RefObject<HTMLElement | null>,
  key: string,
  ready: boolean,
): void {
  const done = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!ready || done.current === key) return
    // The grid itself, or the box it was drawn in.
    const root = grid.current?.closest('[data-first-y]') ?? grid.current?.querySelector('[data-first-y]') ?? null
    if (root === null) return
    done.current = key
    const nowY = root.getAttribute('data-now-y')
    const y = nowY === null ? Number(root.getAttribute('data-first-y') ?? 0) : Number(nowY)
    // The top of the columns: below the row of the days in the week.
    const columns = root.querySelector('[data-date]') ?? root
    const box = scroller.current
    if (box !== null) {
      const offset = columns.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
      const lead = nowY === null ? FIRST_MARGIN_PX : box.clientHeight / 3
      box.scrollTo({ top: Math.max(0, offset + y - lead), behavior: 'auto' })
      return
    }
    // A page no taller than the window has nothing to scroll (and jsdom lays nothing out).
    if (document.documentElement.scrollHeight <= window.innerHeight) return
    const sticky = document.querySelector(`[${STICKY_ATTRIBUTE}]`)?.getBoundingClientRect().height ?? 0
    const offset = columns.getBoundingClientRect().top + window.scrollY
    const lead = nowY === null ? FIRST_MARGIN_PX : (window.innerHeight - sticky) / 3
    // The banner (the review, the report) sits between the sticky header and the grid: when it is
    // there, the first scroll stops where its top meets the header, so it is never half hidden.
    const banner = document.querySelector('[data-banner-row]')
    const limit = banner === null ? Number.POSITIVE_INFINITY : banner.getBoundingClientRect().top + window.scrollY - sticky
    window.scrollTo({ top: Math.max(0, Math.min(offset + y - sticky - lead, limit)), behavior: 'auto' })
  }, [scroller, grid, key, ready])
}
