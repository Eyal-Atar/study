import { useId, useState, type ReactNode } from 'react'

// A collapsed note under a button that opens it (aria-expanded): the reason of a task, the evidence
// of a topic. Plain text only.
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value)
        }}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-brand-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`size-4 transition-transform ${open ? 'rotate-90' : 'rtl:rotate-180'}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M7.5 4.5 13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label}
      </button>
      <p id={panelId} hidden={!open} className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink">
        {children}
      </p>
    </div>
  )
}
