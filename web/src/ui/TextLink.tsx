import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cx, FOCUS_RING_NATIVE } from './styles'

interface TextLinkBase {
  children: ReactNode
  className?: string | undefined
}

// Exactly one of the two: `to` is a screen of the app (the router's Link); `href` is anything the
// router does not own (another site, mailto:, a file).
export type TextLinkProps = TextLinkBase & ({ to: string; href?: never } | { href: string; to?: never })

// A link in text. Always underlined: WCAG 1.4.1 does not let a link differ from the text around
// it by colour alone, and the underline is kept for links only. The weight and the size come from
// the text around it.
// A link that stands alone (not inside a sentence) needs a 44px target: the caller adds
// className="inline-flex min-h-touch items-center".
// Another site (http, https) opens in a new tab, so a form that is half filled is not lost;
// mailto: and the rest stay in the tab.
export function TextLink({ to, href, children, className }: TextLinkProps) {
  const look = cx(
    'rounded-badge text-brand-strong underline underline-offset-2 transition-colors duration-(--duration-fast) hover:text-brand-strong',
    FOCUS_RING_NATIVE,
    className,
  )
  if (to !== undefined) {
    return (
      <Link to={to} className={look}>
        {children}
      </Link>
    )
  }
  const isOutside = /^https?:/i.test(href)
  return (
    <a href={href} className={look} {...(isOutside ? { target: '_blank', rel: 'noreferrer' } : {})}>
      {children}
    </a>
  )
}
