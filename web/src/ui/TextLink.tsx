import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cx, FOCUS_RING_NATIVE } from './styles'

export interface TextLinkProps {
  to: string
  children: ReactNode
  className?: string
}

// A link in text, to another screen of the app. Always underlined: WCAG 1.4.1 does not let a link
// differ from the text around it by colour alone, and the underline is kept for links only. The
// weight and the size come from the text around it.
// A link that stands alone (not inside a sentence) needs a 44px target: the caller adds
// className="inline-flex min-h-touch items-center".
export function TextLink({ to, children, className }: TextLinkProps) {
  return (
    <Link
      to={to}
      className={cx(
        'rounded-badge text-brand underline underline-offset-2 transition-colors duration-(--duration-fast) hover:text-brand-strong',
        FOCUS_RING_NATIVE,
        className,
      )}
    >
      {children}
    </Link>
  )
}
