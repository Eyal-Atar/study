import { useEffect, useRef } from 'react'
import { durationText } from '../board/time'
import { en } from '../i18n/en'
import type { ClosureItem, MoedBResult } from './types'

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

// The line under Archi's sentence of an exam that is over: how long the student studied and how much of
// the plan is done (the sheet, the cards of the exam screen). None without a plan, and none when
// nothing was studied or done: "You finished 0% of the plan" on the evening of the exam reads as a
// grade, and Archi encourages without pressing (archi-voice.md 4).
export function statsText(item: Pick<ClosureItem, 'studied_minutes' | 'tasks_total' | 'completion_percent'>): string | null {
  if (item.tasks_total === 0) return null
  if (item.studied_minutes <= 0 && item.completion_percent === 0) return null
  if (item.studied_minutes <= 0) return en.closure.sheet.statsNoTime(item.completion_percent)
  return en.closure.sheet.stats(durationText(item.studied_minutes), item.completion_percent)
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

// Not everything of this exam fits before Moed B. The replan behind POST /exams/{id}/moed-b covers
// the whole board, so its shortfalls can be another exam's. An unscheduled task carries no exam, but a
// Moed B task that did not fit always makes a shortfall of this exam (the planner's _shortfalls).
export function moedBShort({ result }: MoedBAnswer): boolean {
  return result.shortfalls.some((s) => s.exam_id === result.exam.id)
}

// The live region of a sheet after Moed B: the sentence, and the line when not everything fits.
export function moedBDoneStatus(answer: MoedBAnswer): string {
  return moedBShort(answer) ? `${moedBDoneText(answer)} ${en.closure.moedB.short}` : moedBDoneText(answer)
}
