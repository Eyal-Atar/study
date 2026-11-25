import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emitCompleted } from '../board/xpEvents'
import { en } from '../i18n/en'
import { XpBurst } from './XpBurst'

describe('XpBurst', () => {
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent')
    Reflect.deleteProperty(Element.prototype, 'animate')
  })

  function scene() {
    // jsdom lays nothing out: every element counts as shown.
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body })
    const animate = vi.fn(() => ({ finished: new Promise<never>(() => undefined), cancel: vi.fn() }))
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate })
    render(
      <>
        <span data-check="block-1" />
        <span data-part="level" />
        <XpBurst />
      </>,
    )
    return animate
  }

  it('a Done with no XP (a level or a badge alone) flies no chip', () => {
    const animate = scene()
    act(() => {
      emitCompleted({ blockId: 'block-1', xp: 0, level: 4, levelUp: false, badgesEarned: ['task_master_10'] })
    })
    expect(screen.queryByText(en.calendar.page.xp(0))).not.toBeInTheDocument()
    expect(animate).not.toHaveBeenCalled()
  })

  it('a Done with XP still flies its chip', () => {
    const animate = scene()
    act(() => {
      emitCompleted({ blockId: 'block-1', xp: 20, level: 4, levelUp: false, badgesEarned: [] })
    })
    expect(screen.getByText(en.calendar.page.xp(20))).toBeInTheDocument()
    expect(animate).toHaveBeenCalledOnce()
  })
})
