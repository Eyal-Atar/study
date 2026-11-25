import { useEffect, useRef } from 'react'
import { en } from '../i18n/en'
import type { MoedBResult } from './types'

// What the closure sheet and the Moed B sheet share, outside a component file (fast refresh).

// True from mount until unmount. The handlers of the closure actions run from the mutation, and
// still run after the sheet is gone.
export function useMounted() {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return mounted
}

// The answer of POST /exams/{id}/moed-b and the number of practice exams the round starts with.
export interface MoedBAnswer {
  result: MoedBResult
  simulations: number
}

// Archi's sentence after Moed B was planned: the title of the sheet, and what its live region says.
export function moedBDoneText({ result, simulations }: MoedBAnswer): string {
  return en.closure.moedB.done(
    simulations,
    result.weak_topics.map((t) => t.name),
  )
}

// Not everything fits before Moed B.
export function moedBShort({ result }: MoedBAnswer): boolean {
  return result.unscheduled.length > 0 || result.shortfalls.length > 0
}

// The live region of a sheet after Moed B: the sentence, and the line when not everything fits.
export function moedBDoneStatus(answer: MoedBAnswer): string {
  return moedBShort(answer) ? `${moedBDoneText(answer)} ${en.closure.moedB.short}` : moedBDoneText(answer)
}
