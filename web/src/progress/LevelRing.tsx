// The ring of the level, drawn as the one in the header chip (ProgressChip): a surface centre, a
// gold-track band and a gold arc whose length is the percentage (pathLength 100), turned a quarter
// back so it starts at the top, with the level in the middle. No link, and decoration only: the
// card around it says the same in words.
export function LevelRing({ size, stroke, percent, level }: { size: number; stroke: number; percent: number; level: number }) {
  const centre = size / 2
  const radius = (size - stroke) / 2
  return (
    <span aria-hidden="true" className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`} className="absolute inset-0 -rotate-90">
        <circle data-part="centre" cx={centre} cy={centre} r={radius} className="fill-surface" />
        <circle data-part="track" cx={centre} cy={centre} r={radius} fill="none" strokeWidth={stroke} className="stroke-gold-track" />
        {/* No arc at 0%: the band would still show its end. */}
        {percent > 0 ? (
          <circle
            data-part="arc"
            cx={centre}
            cy={centre}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            pathLength={100}
            strokeDasharray={`${percent.toFixed(1)} 100`}
            className="stroke-gold"
          />
        ) : null}
      </svg>
      <span data-part="value" className="relative text-small leading-none font-bold tabular-nums">
        {level}
      </span>
    </span>
  )
}
