import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from 'react-aria-components'
import { describe, expect, it, vi } from 'vitest'
import { ApiContext } from '../api/ApiContext'
import { AuthProvider } from '../auth/AuthProvider'
import type { Commitment } from '../availability/types'
import { en } from '../i18n/en'
import { LOCALE } from '../i18n/locale'
import { createFakeApi, problem } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { ToastProvider } from '../ui/toast'
import { CommitmentDialog } from './CommitmentDialog'
import { groupCommitments, type CommitmentGroup } from './model'

const t = en.commitments.dialog
const TITLE = 'משמרת עבודה'

const row = (id: string, weekday: Commitment['weekday'], extra: Partial<Commitment> = {}): Commitment => ({
  id,
  title: TITLE,
  kind: 'work',
  weekday,
  start_time: '09:00',
  end_time: '12:00',
  valid_from: '2026-11-01',
  valid_until: null,
  source_job_id: null,
  created_at: '2026-11-01T08:00:00Z',
  ...extra,
})

const group = (days: Commitment['weekday'][]): CommitmentGroup => {
  const found = groupCommitments(days.map((d) => row(`c${String(d)}`, d)))[0]
  if (!found) throw new Error('no group')
  return found
}

const written = (id: string, weekday: Commitment['weekday']) => ({ commitment: row(id, weekday), plan_affected: false })

function setup(props: Partial<Parameters<typeof CommitmentDialog>[0]> = {}) {
  const fake = createFakeApi()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const onSaved = vi.fn()
  const onOpenChange = vi.fn()
  const auth = createFakeAuth(fakeSession())
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale={LOCALE}>
        <ApiContext value={fake.api}>
          <AuthProvider auth={auth.client}>
            <ToastProvider>
              <CommitmentDialog isOpen onOpenChange={onOpenChange} group={null} onSaved={onSaved} {...props} />
            </ToastProvider>
          </AuthProvider>
        </ApiContext>
      </I18nProvider>
    </QueryClientProvider>,
  )
  return { fake, onSaved, onOpenChange, invalidate, user: userEvent.setup() }
}

const day = (name: string) => screen.getByRole('checkbox', { name })
const save = () => screen.getByRole('button', { name: en.common.save })

async function typeTime(user: ReturnType<typeof userEvent.setup>, label: string, hh: string, mm: string) {
  const [hour, minute] = within(screen.getByRole('group', { name: label })).getAllByRole('spinbutton') as [HTMLElement, HTMLElement]
  await user.click(hour)
  await user.keyboard(hh)
  await user.click(minute)
  await user.keyboard(mm)
}

describe('CommitmentDialog', () => {
  it('asks the add question, has no Delete, and keeps Save from sending an empty form', async () => {
    const { fake, user } = setup()
    expect(screen.getByRole('heading', { name: t.titleAdd })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.common.delete })).not.toBeInTheDocument()
    await user.click(save())
    expect(screen.getByText(t.nameRequired)).toBeInTheDocument()
    expect(fake.calls()).toHaveLength(0)
  })

  it('adding on two days sends two POSTs and reports the OR of plan_affected', async () => {
    const { fake, onSaved, user } = setup()
    let n = 0
    fake.on('POST /commitments', ({ body }: { body: { weekday: Commitment['weekday'] } }) => {
      n += 1
      return { commitment: row(`n${String(n)}`, body.weekday), plan_affected: n === 2 }
    })
    await user.type(screen.getByRole('textbox', { name: t.name }), 'Shift')
    await user.click(screen.getByRole('radio', { name: en.commitments.kinds.work }))
    await user.click(day(en.commitments.weekdayLong[1]))
    await user.click(day(en.commitments.weekdayLong[3]))
    await typeTime(user, t.from, '0900', '00')
    await typeTime(user, t.to, '1200', '00')
    await user.click(save())
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(true)
    })
    const posts = fake.calls('POST', '/commitments').map((c) => c.body)
    expect(posts).toHaveLength(2)
    expect(posts).toEqual([
      expect.objectContaining({ title: 'Shift', kind: 'work', weekday: 1, start_time: '09:00', end_time: '12:00' }),
      expect.objectContaining({ weekday: 3 }),
    ])
  })

  it('editing shows the edit question and Delete, and dropping a day sends one DELETE', async () => {
    const { fake, onSaved, user } = setup({ group: group([1, 2, 3]) })
    fake.on('DELETE /commitments/c2', { plan_affected: false })
    expect(screen.getByRole('heading', { name: t.titleEdit })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: t.name })).toHaveValue(TITLE)
    expect(day(en.commitments.weekdayLong[2])).toBeChecked()
    await user.click(day(en.commitments.weekdayLong[2]))
    await user.click(save())
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(false)
    })
    expect(fake.calls('DELETE')).toHaveLength(1)
    expect(fake.calls('PATCH')).toHaveLength(0)
    expect(fake.calls('POST')).toHaveLength(0)
  })

  it('changing the end time sends a PATCH to every day that stays', async () => {
    const { fake, onSaved, user } = setup({ group: group([1, 2]) })
    fake.on({ method: 'PATCH', path: /^\/commitments\/c\d$/ }, { commitment: row('c1', 1), plan_affected: true })
    await typeTime(user, t.to, '1300', '00')
    await user.click(save())
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(true)
    })
    const patches = fake.calls('PATCH')
    expect(patches.map((c) => c.path).sort()).toEqual(['/commitments/c1', '/commitments/c2'])
    expect(patches[0]?.body).toEqual({ end_time: '13:00' })
  })

  it('a 422 too_short shows its message next to the hours and stays open', async () => {
    const { fake, onSaved, onOpenChange, user } = setup({ group: group([1]) })
    fake.on('PATCH /commitments/c1', problem(422, 'validation_error', { errors: [{ loc: ['body', 'end_time'], type: 'too_short' }] }))
    await typeTime(user, t.to, '0905', '00')
    await user.click(save())
    expect(await screen.findByText(t.tooShort)).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('a 422 before_valid_from shows its message next to the date', async () => {
    const { fake, user } = setup({ group: group([1]) })
    fake.on('PATCH /commitments/c1', problem(422, 'validation_error', { errors: [{ loc: ['body', 'valid_until'], type: 'before_valid_from' }] }))
    await typeTime(user, t.to, '1300', '00')
    await user.click(save())
    expect(await screen.findByText(t.beforeStart)).toBeInTheDocument()
  })

  it('a request-level code shows a note', async () => {
    const { fake, user } = setup()
    fake.on('POST /commitments', problem(422, 'too_many_commitments'))
    await user.type(screen.getByRole('textbox', { name: t.name }), 'Shift')
    await user.click(day(en.commitments.weekdayLong[1]))
    await typeTime(user, t.from, '0900', '00')
    await typeTime(user, t.to, '1000', '00')
    await user.click(save())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('draft mode sends nothing and hands the draft over', async () => {
    const onDraft = vi.fn()
    const { fake, onSaved, onOpenChange, user } = setup({ mode: 'draft', onDraft, group: group([1, 2]) })
    await user.click(day(en.commitments.weekdayLong[4]))
    await user.click(save())
    await waitFor(() => {
      expect(onDraft).toHaveBeenCalledWith(
        expect.objectContaining({ title: TITLE, kind: 'work', weekdays: [1, 2, 4], start_time: '09:00', end_time: '12:00' }),
      )
    })
    expect(fake.calls()).toHaveLength(0)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('a failure on the second request refreshes the list, says so and stays open', async () => {
    const { fake, onSaved, onOpenChange, invalidate, user } = setup()
    let n = 0
    fake.on('POST /commitments', ({ body }: { body: { weekday: Commitment['weekday'] } }) => {
      n += 1
      return n === 1 ? written('n1', body.weekday) : problem(500, 'internal_error')
    })
    await user.type(screen.getByRole('textbox', { name: t.name }), 'Shift')
    await user.click(day(en.commitments.weekdayLong[1]))
    await user.click(day(en.commitments.weekdayLong[3]))
    await typeTime(user, t.from, '0900', '00')
    await typeTime(user, t.to, '1200', '00')
    await user.click(save())
    expect(await screen.findByText(t.saveFailed)).toBeInTheDocument()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: expect.arrayContaining(['commitments']) as unknown })
    expect(onSaved).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    // Trying again does not create Monday a second time.
    fake.on('POST /commitments', written('n2', 3))
    await user.click(save())
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled()
    })
    expect(fake.calls('POST').map((c) => (c.body as { weekday: number }).weekday)).toEqual([1, 3, 3])
  })

  // Day 1 is created (plan_affected true), day 2 fails.
  async function partialFailure(replyFirst: boolean) {
    const ctx = setup()
    let n = 0
    ctx.fake.on('POST /commitments', ({ body }: { body: { weekday: Commitment['weekday'] } }) => {
      n += 1
      return n === 1 ? { commitment: row('n1', body.weekday), plan_affected: replyFirst } : problem(500, 'internal_error')
    })
    await ctx.user.type(screen.getByRole('textbox', { name: t.name }), 'Shift')
    await ctx.user.click(day(en.commitments.weekdayLong[1]))
    await ctx.user.click(day(en.commitments.weekdayLong[3]))
    await typeTime(ctx.user, t.from, '0900', '00')
    await typeTime(ctx.user, t.to, '1200', '00')
    await ctx.user.click(save())
    await screen.findByText(t.saveFailed)
    return ctx
  }

  it('a retry after a partial failure still reports the plan_affected of the first write', async () => {
    const { fake, onSaved, user } = await partialFailure(true)
    fake.on('POST /commitments', written('n2', 3))
    await user.click(save())
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(true)
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('Cancel after a partial failure reports that the list changed', async () => {
    const { onSaved, onOpenChange, user } = await partialFailure(true)
    await user.click(screen.getByRole('button', { name: en.common.cancel }))
    expect(onSaved).toHaveBeenCalledWith(true)
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Cancel with nothing written reports nothing', async () => {
    const { onSaved, user } = setup()
    await user.click(screen.getByRole('button', { name: en.common.cancel }))
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('a 422 field error after a partial write also says the list was refreshed', async () => {
    const { fake, user } = await partialFailure(false)
    fake.on('POST /commitments', problem(422, 'validation_error', { errors: [{ loc: ['body', 'end_time'], type: 'too_short' }] }))
    await user.click(save())
    expect(await screen.findByText(t.tooShort)).toBeInTheDocument()
    expect(screen.getByText(t.saveFailed)).toBeInTheDocument()
  })

  it('Delete removes every row and hands the group to onDeleted', async () => {
    const onDeleted = vi.fn()
    const g = group([1, 2])
    const { fake, user } = setup({ group: g, onDeleted })
    fake.on({ method: 'DELETE', path: /^\/commitments\/c\d$/ }, { plan_affected: false })
    await user.click(screen.getByRole('button', { name: en.common.delete }))
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith(g)
    })
    expect(fake.calls('DELETE')).toHaveLength(2)
  })
})
