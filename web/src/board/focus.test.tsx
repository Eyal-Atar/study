import { act, screen } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderBoard } from '../test/boardFixtures'
import { silentApi } from '../test/fakeApi'
import { FOCUS_REQUEST_MS, useFocusRequest, useRequestFocus } from './focus'

let request: (blockId: string) => void = () => undefined

function Card({ id, disabled = false }: { id: string; disabled?: boolean }) {
  const ref = useRef<HTMLElement>(null)
  useFocusRequest(id, ref)
  return (
    <article ref={ref} aria-label={id}>
      <button disabled>{`${id} disabled`}</button>
      <button disabled={disabled}>{`${id} first`}</button>
      <button disabled={disabled}>{`${id} second`}</button>
    </article>
  )
}

type Cards = { id: string; disabled?: boolean }[]
let setCards: (cards: Cards) => void = () => undefined

function Board({ initial }: { initial: Cards }) {
  const ask = useRequestFocus()
  const [cards, set] = useState(initial)
  // The test drives the board through these two.
  useEffect(() => {
    request = ask
    setCards = set
  }, [ask])
  return (
    <div>
      <input aria-label="elsewhere" />
      {cards.map((c) => (
        <Card key={c.id} id={c.id} disabled={c.disabled} />
      ))}
    </div>
  )
}

function setup(initial: Cards) {
  renderBoard(<Board initial={initial} />, { api: silentApi() })
  return {
    show: (next: Cards) => {
      act(() => {
        setCards(next)
      })
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('focus requests', () => {
  it('a card that mounts with a pending request focuses its first enabled button, once', () => {
    const { show } = setup([{ id: 'a' }])
    act(() => {
      request('b')
    })
    show([{ id: 'a' }, { id: 'b' }])
    expect(screen.getByRole('button', { name: 'b first' })).toHaveFocus()

    // The request is used up: a later render does not take the focus again.
    act(() => {
      screen.getByRole('button', { name: 'a second' }).focus()
    })
    show([{ id: 'b' }, { id: 'a' }])
    expect(screen.getByRole('button', { name: 'a second' })).toHaveFocus()
  })

  it('waits while the buttons are disabled, and focuses once they are enabled', () => {
    const { show } = setup([{ id: 'a', disabled: true }])
    act(() => {
      request('a')
    })
    show([{ id: 'a', disabled: true }])
    expect(screen.getByRole('button', { name: 'a second' })).not.toHaveFocus()
    show([{ id: 'a' }])
    expect(screen.getByRole('button', { name: 'a first' })).toHaveFocus()
  })

  it('a request for a block with no card does nothing, and expires', () => {
    const { show } = setup([{ id: 'a' }])
    act(() => {
      request('gone')
    })
    show([{ id: 'a' }])
    expect(document.body).toHaveFocus()

    const later = Date.now() + FOCUS_REQUEST_MS + 1
    vi.spyOn(Date, 'now').mockReturnValue(later)
    show([{ id: 'a' }, { id: 'gone' }])
    expect(document.body).toHaveFocus()
  })

  it('does not take the focus from somewhere else on the page', () => {
    const { show } = setup([{ id: 'a' }])
    act(() => {
      request('a')
      screen.getByRole('textbox', { name: 'elsewhere' }).focus()
    })
    show([{ id: 'a' }])
    expect(screen.getByRole('textbox', { name: 'elsewhere' })).toHaveFocus()
  })
})
