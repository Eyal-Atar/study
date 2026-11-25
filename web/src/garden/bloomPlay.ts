import { useEffect } from 'react'
import { onBloom } from '../closure/bloomEvents'

// The bloom plays once per closure, in the place where the closure happened (S33, Task 10). The event
// of bloomEvents.ts is recorded here, and the first BloomSlot of that exam to appear takes it: a
// refresh, or a second place that draws the same flower, finds nothing and shows it open.
const pending = new Set<string>()

// In AppShell: one subscription for the whole session.
export function useBloomListener(): void {
  useEffect(
    () =>
      onBloom((event) => {
        pending.add(event.exam_id)
      }),
    [],
  )
}

export function takeBloom(examId: string): boolean {
  return pending.delete(examId)
}
