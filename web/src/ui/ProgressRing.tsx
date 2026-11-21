import type { ReactNode } from 'react'

export interface ProgressRingProps {
  value: number
  max: number
  // Width and height in px.
  size?: number
  'aria-label': string
  // The value in words ("90 of 285 minutes"), read as aria-valuetext.
  valueText: string
  // The centre; without it, the rounded percentage.
  children?: ReactNode
}

const STROKE = 6

// A ring that fills as the week's study minutes are done (design language 5.8). The value is clipped
// to 0..max, and a max of 0 is an empty ring and 0%, with no division by zero.
export function ProgressRing({ value, max, size = 56, 'aria-label': label, valueText, children }: ProgressRingProps) {
  const top = max > 0 ? max : 0
  const now = value > 0 ? Math.min(value, top) : 0
  const fraction = top === 0 ? 0 : now / top
  const radius = (size - STROKE) / 2
  const circumference = 2 * Math.PI * radius
  const centre = size / 2
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg
        role="meter"
        aria-label={label}
        aria-valuenow={now}
        aria-valuemin={0}
        aria-valuemax={top}
        aria-valuetext={valueText}
        width={size}
        height={size}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        className="-rotate-90"
      >
        <circle cx={centre} cy={centre} r={radius} fill="none" strokeWidth={STROKE} className="stroke-surface-muted" />
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className="stroke-brand-strong transition-[stroke-dashoffset] duration-(--duration-slow) motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-small font-semibold tabular-nums">
        {children ?? `${String(Math.round(fraction * 100))}%`}
      </div>
    </div>
  )
}
