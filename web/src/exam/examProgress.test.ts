import { describe, expect, it } from 'vitest'
import { taskFixture } from '../test/examFixtures'
import { examProgress } from './examProgress'

describe('examProgress', () => {
  it('counts the minutes of done tasks out of every task that was not skipped', () => {
    const tasks = [
      taskFixture({ id: 'a', status: 'done', estimated_minutes: 30 }),
      taskFixture({ id: 'b', status: 'todo', estimated_minutes: 45 }),
      taskFixture({ id: 'c', status: 'skipped', estimated_minutes: 120 }),
      taskFixture({ id: 'd', status: 'todo', estimated_minutes: 25 }),
    ]
    expect(examProgress(tasks)).toEqual({ done: 30, total: 100, percent: 30 })
  })

  it('rounds the percent to a whole number', () => {
    const tasks = [
      taskFixture({ id: 'a', status: 'done', estimated_minutes: 10 }),
      taskFixture({ id: 'b', status: 'todo', estimated_minutes: 20 }),
    ]
    expect(examProgress(tasks).percent).toBe(33)
  })

  it('is empty without tasks, and when every task was skipped', () => {
    expect(examProgress([])).toEqual({ done: 0, total: 0, percent: 0 })
    expect(examProgress([taskFixture({ status: 'skipped', estimated_minutes: 30 })])).toEqual({ done: 0, total: 0, percent: 0 })
  })

  it('is 100 when everything is done', () => {
    expect(examProgress([taskFixture({ status: 'done', estimated_minutes: 30 })]).percent).toBe(100)
  })
})
