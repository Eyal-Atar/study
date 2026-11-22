import { useSyncExternalStore } from 'react'
import { paintedRanges } from '../commitments/model'

// The hours marked in the small week of step 4 and not saved yet (S34 decisions 6–7). Only "Build my
// plan" saves them, so they must outlive the step: the tight note sends the student Back to step 3,
// and the marks are still there when they return. Steps 1 and 3 count them too, so every step
// shows the same estimate for the same data.
// Module-level and not a context, like pendingDeletes: there is one onboarding per tab, and the
// steps that read the marks are not the one that makes them.

let marked: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The marked cells, as WeekPainter names them (`${column}-${clock hour}`).
export function markedCells(): ReadonlySet<string> {
  return marked
}

export function setMarkedCells(cells: ReadonlySet<string>): void {
  if (cells === marked) return
  marked = cells
  for (const listener of [...listeners]) listener()
}

// The marks are saved, or the student said they have no fixed hours, or the plan is built.
export function clearMarkedCells(): void {
  if (marked.size > 0) setMarkedCells(new Set())
}

export function useMarkedCells(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, markedCells)
}

// The rows of the week (S34 decision 6): whole hours from the wake hour up to the sleep hour, the
// last row being the hour before sleep. A sleep time after midnight runs on past 24, and a sleep
// time with minutes keeps the hour it falls in.
export function weekHours(wake: string, sleep: string): { firstHour: number; lastHour: number } {
  const firstHour = Number(wake.slice(0, 2))
  const sleepMinutes = Number(sleep.slice(0, 2)) * 60 + Number(sleep.slice(3, 5))
  let lastHour = Math.ceil(sleepMinutes / 60)
  if (lastHour <= firstHour) lastHour += 24
  return { firstHour, lastHour }
}

// The marked cells as busy ranges, read against the profile's wake hour as the week reads them.
export function markedRanges(
  cells: ReadonlySet<string>,
  profile: { wake_time: string; sleep_time: string },
): ReturnType<typeof paintedRanges> {
  return paintedRanges(cells, weekHours(profile.wake_time, profile.sleep_time).firstHour)
}
