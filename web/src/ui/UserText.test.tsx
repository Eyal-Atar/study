import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { isolate } from '../i18n/bidi'
import { UserText } from './UserText'

const HEBREW = 'חדו״א 1 (מועד ב׳)'
const MIXED = 'למידה: גרפים ו-BFS'

describe('UserText', () => {
  it('is an isolated inline element with a direction of its own', () => {
    render(<UserText>{HEBREW}</UserText>)
    const el = screen.getByText(HEBREW)
    expect(el.tagName).toBe('BDI')
    expect(el).toHaveAttribute('dir', 'auto')
    expect(el).not.toHaveClass('block')
  })

  it('keeps English and mixed content as it was typed', () => {
    render(
      <p>
        <UserText>{MIXED}</UserText>
        <UserText>Linear Algebra 2</UserText>
      </p>,
    )
    expect(screen.getByText(MIXED)).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('Linear Algebra 2')).toHaveAttribute('dir', 'auto')
  })

  it('truncate is a block that cuts the end of the text and stays on the interface edge', () => {
    render(<UserText truncate>{HEBREW}</UserText>)
    const el = screen.getByText(HEBREW)
    expect(el).toHaveAttribute('dir', 'auto')
    expect(el).toHaveClass('user-text-truncate')
  })

  it('prose is a block aligned by its own direction', () => {
    render(<UserText prose>{HEBREW}</UserText>)
    const el = screen.getByText(HEBREW)
    expect(el).toHaveAttribute('dir', 'auto')
    expect(el).toHaveClass('block', 'text-start')
  })

  it('takes the element, the id and extra classes of its place', () => {
    render(
      <UserText as="h3" id="title" className="font-semibold">
        {HEBREW}
      </UserText>,
    )
    const el = screen.getByRole('heading', { level: 3 })
    expect(el).toHaveAttribute('id', 'title')
    expect(el).toHaveAttribute('dir', 'auto')
    expect(el).toHaveClass('font-semibold')
  })
})

describe('isolate', () => {
  it('wraps a name in First Strong Isolate and Pop Directional Isolate', () => {
    expect(isolate(HEBREW)).toBe(`⁨${HEBREW}⁩`)
  })
})
