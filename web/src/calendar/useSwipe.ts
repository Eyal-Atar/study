import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Block } from '../board/types'
import { createClickGuard } from './clickGuard'

// The swipe of a block on a phone (S32 decision 10): a finger that moves the block to the left
// uncovers Defer and Skip behind its end. Touch only: a mouse drags (useBlockDrag.ts) and has
// the actions sheet. A done block has nothing to defer or skip, so it does not swipe.
//
// The block has touch-action: pan-y, so a vertical move is the page's scroll (the browser cancels
// the pointer) and a horizontal one stays with the block. The buttons exist only while the swipe
// is open or moving, so they are never in the Tab order of a closed block.

export const SWIPE_WIDTH_PX = 132
// A release past this keeps the swipe open; short of it, it closes.
const OPEN_AT_PX = 60
// Horizontal travel before a move counts as a swipe (and not a press).
const SLOP_PX = 8

export type SwipeAction = 'defer' | 'skip'

interface Track {
  id: string
  pointerId: number
  startX: number
  startY: number
  // Where the block was when the finger came down: 0 closed, SWIPE_WIDTH_PX open.
  base: number
  offset: number
  // null until the move says what it is: a swipe, or a scroll.
  swiping: boolean | null
}

export interface SwipeHandlers {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
}

export interface Swipe {
  handlers: (block: Block) => SwipeHandlers
  // How far the block is moved to the left, in px (0: in place).
  offset: (blockId: string) => number
  // A finger is moving the block now: it follows with no transition.
  tracking: (blockId: string) => boolean
  // The block whose swipe is open, or the one whose swipe last closed (it may slide back).
  openId: string | null
  settledId: string | null
  act: (block: Block, action: SwipeAction) => void
  // The click that ends a swipe is not a press on the block: true once after a swipe.
  consumeClick: () => boolean
  // A key on the block: the next click is the user's.
  clearClick: () => void
}

export function useSwipe(blocks: Block[], onAction: (block: Block, action: SwipeAction) => void): Swipe {
  const [openId, setOpenId] = useState<string | null>(null)
  const [settledId, setSettledId] = useState<string | null>(null)
  const [track, setTrackState] = useState<Track | null>(null)
  const trackRef = useRef<Track | null>(null)
  const [clickGuard] = useState(createClickGuard)

  function setTrack(next: Track | null) {
    trackRef.current = next
    setTrackState(next)
  }

  function close() {
    setOpenId(null)
  }

  // A refetch that removes the open block, or marks it done, closes its swipe (during the render,
  // so no frame shows buttons for a block that is gone).
  if (openId !== null && !blocks.some((b) => b.id === openId && b.status !== 'done')) setOpenId(null)

  // While a swipe is open: a press outside it, a scroll or Escape closes it. The listeners live
  // only as long as the swipe is open.
  useEffect(() => {
    if (openId === null) return
    const outside = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest(`[data-block-id="${openId}"], [data-swipe-actions="${openId}"]`) !== null) return
      setOpenId(null)
    }
    const escape = (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape') setOpenId(null)
    }
    const scroll = () => {
      setOpenId(null)
    }
    const scrollOptions = { capture: true, passive: true }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    // In the capture phase, a scroll of any element reaches the window: the grid scrolls inside the page.
    window.addEventListener('scroll', scroll, scrollOptions)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('scroll', scroll, scrollOptions)
    }
  }, [openId])

  function trackOf(block: Block, event: PointerEvent): Track | null {
    const current = trackRef.current
    return current?.id === block.id && current.pointerId === event.pointerId ? current : null
  }

  function handlers(block: Block): SwipeHandlers {
    return {
      onPointerDown: (event) => {
        clickGuard.reset()
        if (event.pointerType !== 'touch' || block.status === 'done' || block.state === 'done') return
        const base = openId === block.id ? SWIPE_WIDTH_PX : 0
        setTrack({ id: block.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, base, offset: base, swiping: null })
      },
      onPointerMove: (event) => {
        const current = trackOf(block, event)
        if (current === null) return
        const dx = event.clientX - current.startX
        const dy = event.clientY - current.startY
        if (current.swiping === null) {
          // Only toward the actions from a closed block, either way from an open one.
          if (Math.abs(dx) > SLOP_PX && Math.abs(dx) > Math.abs(dy) && (dx < 0 || current.base > 0)) {
            setSettledId(block.id)
            setTrack({ ...current, swiping: true, offset: Math.min(Math.max(current.base - dx, 0), SWIPE_WIDTH_PX) })
          } else if (Math.abs(dy) > SLOP_PX) {
            // A scroll.
            setTrack(null)
          }
          return
        }
        if (!current.swiping) return
        setTrack({ ...current, offset: Math.min(Math.max(current.base - dx, 0), SWIPE_WIDTH_PX) })
      },
      onPointerUp: (event) => {
        const current = trackOf(block, event)
        if (current === null) return
        setTrack(null)
        if (current.swiping === true) {
          clickGuard.arm()
          setOpenId(current.offset >= OPEN_AT_PX ? block.id : null)
          return
        }
        // A tap on an open block closes it, and does not open the block's actions.
        if (current.base > 0) {
          clickGuard.arm()
          close()
        }
      },
      onPointerCancel: (event) => {
        if (trackOf(block, event) !== null) setTrack(null)
      },
    }
  }

  return {
    handlers,
    offset: (blockId) => {
      if (track?.id === blockId && track.swiping === true) return track.offset
      return openId === blockId ? SWIPE_WIDTH_PX : 0
    },
    tracking: (blockId) => track?.id === blockId && track.swiping === true,
    openId,
    settledId,
    act: (block, action) => {
      setOpenId(null)
      setSettledId(block.id)
      onAction(block, action)
    },
    consumeClick: clickGuard.consume,
    clearClick: clickGuard.reset,
  }
}
