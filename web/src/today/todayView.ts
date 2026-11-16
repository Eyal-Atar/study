import { useState } from 'react'

// How "today" shows its blocks: a list of cards (the default) or the day's timeline (S18 decision
// 11). The choice is a convenience of this browser, so it lives in localStorage, and a browser
// that refuses storage (private mode, blocked site data) simply starts with the list.

export type TodayView = 'list' | 'timeline'

export const TODAY_VIEW_KEY = 'studyflow.todayView'

function readView(): TodayView {
  try {
    return window.localStorage.getItem(TODAY_VIEW_KEY) === 'timeline' ? 'timeline' : 'list'
  } catch {
    return 'list'
  }
}

export function useTodayView(): [TodayView, (view: TodayView) => void] {
  const [view, setView] = useState<TodayView>(readView)
  const choose = (next: TodayView) => {
    setView(next)
    try {
      window.localStorage.setItem(TODAY_VIEW_KEY, next)
    } catch {
      // Not remembered; this visit still shows it.
    }
  }
  return [view, choose]
}
