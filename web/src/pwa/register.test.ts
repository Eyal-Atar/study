import { describe, expect, it, vi } from 'vitest'
import { reloadOnUpdate } from './register'

function container(controlled: boolean) {
  const target = new EventTarget()
  return Object.assign(target, { controller: controlled ? ({} as ServiceWorker) : null })
}

describe('reloadOnUpdate', () => {
  it('reloads once when a new worker takes over a page an older worker controlled', () => {
    const sw = container(true)
    const reload = vi.fn()
    reloadOnUpdate(sw, reload)
    sw.dispatchEvent(new Event('controllerchange'))
    sw.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not reload on the first install, when nothing controlled the page', () => {
    const sw = container(false)
    const reload = vi.fn()
    reloadOnUpdate(sw, reload)
    sw.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
  })
})
