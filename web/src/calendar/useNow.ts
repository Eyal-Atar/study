import { useEffect, useState } from 'react'

// The clock of the screen, in milliseconds: the line of now, Archi's hour and the break move with
// it. Every 30 seconds is enough for a line drawn by the minute.
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, intervalMs)
    return () => {
      clearInterval(id)
    }
  }, [intervalMs])
  return now
}
