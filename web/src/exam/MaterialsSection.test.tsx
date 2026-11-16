import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import { he } from '../i18n/he'
import { COMPLETED_AT, examFixture, meFixture } from '../onboarding/testFixtures'
import type { Material } from '../onboarding/types'
import { createFakeApi, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { ToastRegion } from '../ui/toast'
import { MaterialsSection } from './MaterialsSection'
import { taskItem } from './analysisFixtures'

const t = he.exam.materials
const kinds = he.onboardingMaterials.kinds
const POLL = { timeout: 4000 }

function material(overrides: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    exam_id: 'e1',
    filename: 'מבחן 2024.pdf',
    kind: 'past_exam',
    mime: 'application/pdf',
    size_bytes: 1000,
    page_count: 3,
    scanned_pages: 0,
    ingest_status: 'ready',
    ingest_error: null,
    warnings: [],
    created_at: '2026-11-16T08:00:00Z',
    ingested_at: '2026-11-16T08:01:00Z',
    ...overrides,
  }
}

function server({ aiTasks, materials = () => [material()] }: { aiTasks: boolean; materials?: () => Material[] }) {
  const state = { kind: 'past_exam' as Material['kind'] }
  const fake = createFakeApi()
    .on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT }))
    .on('GET /exams', [examFixture()])
    .on('GET /exams/e1/tasks', aiTasks ? [taskItem()] : [])
    .on('GET /exams/e1/materials', () => materials().map((m) => (m.id === 'm1' ? { ...m, kind: state.kind } : m)))
    .on('PATCH /materials/m1', (call: ApiCall) => {
      state.kind = (call.body as { kind: Material['kind'] }).kind
      return material({ kind: state.kind })
    })
  return fake
}

function setup(fake: FakeApi) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
  render(
    <StrictMode>
      <AppProviders auth={auth.client} api={fake.api} storage={createFakeStorage().client} queryClient={queryClient}>
        <MaterialsSection examId="e1" />
        <ToastRegion />
      </AppProviders>
    </StrictMode>,
  )
  return { user: userEvent.setup() }
}

async function chooseKind(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(t.kindLabel('מבחן 2024.pdf')) }))
  await user.click(await screen.findByRole('option', { name: label }))
}

describe('MaterialsSection', () => {
  it('lists the exam files under its heading, with each file kind', async () => {
    setup(server({ aiTasks: false }))
    expect(await screen.findByRole('heading', { name: t.title })).toBeInTheDocument()
    const row = (await screen.findByText('מבחן 2024.pdf')).closest('li')
    if (row === null) throw new Error('no row')
    expect(within(row).getByRole('button', { name: new RegExp(t.kindLabel('מבחן 2024.pdf')) })).toHaveTextContent(
      kinds.past_exam,
    )
  })

  it('a kind change sends PATCH, shows the new kind, and hints at a reanalysis when the exam has AI tasks', async () => {
    const fake = server({ aiTasks: true })
    const { user } = setup(fake)
    await chooseKind(user, kinds.summary)

    await waitFor(() => {
      expect(fake.calls('PATCH', '/materials/m1').map((c) => c.body)).toEqual([{ kind: 'summary' }])
    })
    expect(await screen.findByText(t.reanalyzeHint)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(t.kindLabel('מבחן 2024.pdf')) })).toHaveTextContent(
      kinds.summary,
    )
  })

  it('without AI tasks a kind change needs no hint: the build button covers it', async () => {
    const fake = server({ aiTasks: false })
    const { user } = setup(fake)
    await chooseKind(user, kinds.solution)
    await waitFor(() => {
      expect(fake.calls('PATCH', '/materials/m1')).toHaveLength(1)
    })
    expect(await screen.findByText(t.kindSaved)).toBeInTheDocument()
    expect(screen.queryByText(t.reanalyzeHint)).not.toBeInTheDocument()
  })

  it('a new file that becomes ready hints at a reanalysis when the exam has AI tasks', async () => {
    const file = { ready: false }
    const fake = server({
      aiTasks: true,
      materials: () => [material({ ingest_status: file.ready ? 'ready' : 'processing' })],
    })
    setup(fake)
    expect(await screen.findByText(he.onboardingMaterials.processing)).toBeInTheDocument()
    expect(screen.queryByText(t.reanalyzeHint)).not.toBeInTheDocument()
    file.ready = true
    expect(await screen.findByText(t.reanalyzeHint, {}, POLL)).toBeInTheDocument()
  })
})
