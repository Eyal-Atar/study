import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import { en } from '../i18n/en'
import { COMPLETED_AT, examFixture, meFixture } from '../test/onboardingFixtures'
import type { Material } from '../onboarding/types'
import { createFakeApi, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { ToastRegion } from '../ui/toast'
import { MaterialsSection } from './MaterialsSection'
import { taskItem } from '../test/analysisFixtures'

const t = en.exam.materials
const kinds = en.onboardingMaterials.kinds
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
  const view = render(
    <StrictMode>
      <AppProviders auth={auth.client} api={fake.api} storage={createFakeStorage().client} queryClient={queryClient}>
        <MaterialsSection examId="e1" />
        <ToastRegion />
      </AppProviders>
    </StrictMode>,
  )
  return { user: userEvent.setup(), unmount: view.unmount }
}

const sectionButton = () => screen.findByRole('button', { name: new RegExp(`^${t.title}`) })

// An analyzed exam keeps its materials closed: the test opens them like a user would. The summary
// appears once the files are loaded.
async function openSection(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(t.count(1))
  const button = await sectionButton()
  expect(button).toHaveAttribute('aria-expanded', 'false')
  await user.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
}

async function chooseKind(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(t.kindLabel('מבחן 2024.pdf')) }))
  await user.click(await screen.findByRole('option', { name: label }))
}

describe('MaterialsSection', () => {
  it('lists the exam files under its heading, with each file kind', async () => {
    setup(server({ aiTasks: false }))
    // The heading is the button of the section, with the number of files as its summary.
    expect(await screen.findByRole('heading', { level: 2, name: new RegExp(`^${t.title}`) })).toBeInTheDocument()
    expect(await screen.findByText(t.count(1))).toBeInTheDocument()
    // The name without its extension; the type is in the subtitle, where the kind's text would be.
    const row = (await screen.findByText('מבחן 2024')).closest('li')
    if (row === null) throw new Error('no row')
    expect(await within(row).findByRole('button', { name: new RegExp(t.kindLabel('מבחן 2024.pdf')) })).toHaveTextContent(
      kinds.past_exam,
    )
    expect(within(row).getByText('PDF.')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: en.onboardingMaterials.deleteNamed('מבחן 2024.pdf') })).toBeInTheDocument()
    // The section has the only heading: the list inside brings none of its own.
    expect(screen.getAllByRole('heading')).toHaveLength(1)
  })

  it('opens by itself for an exam that was not analyzed, and stays closed for one that was', async () => {
    const first = setup(server({ aiTasks: false }))
    await waitFor(async () => {
      expect(await sectionButton()).toHaveAttribute('aria-expanded', 'true')
    })
    first.unmount()

    setup(server({ aiTasks: true }))
    await screen.findByText(t.count(1))
    expect(await sectionButton()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: new RegExp(t.kindLabel('מבחן 2024.pdf')) })).not.toBeInTheDocument()
  })

  it('remembers what the user chose: a section they closed stays closed', async () => {
    const { user } = setup(server({ aiTasks: false }))
    const button = await sectionButton()
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-expanded', 'true')
    })
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('says how many files there are: none, one, several', () => {
    expect(t.count(0)).toBe('No files')
    expect(t.count(1)).toBe('1 file')
    expect(t.count(3)).toBe('3 files')
  })

  it('a kind change sends PATCH, shows the new kind, and hints at a reanalysis when the exam has AI tasks', async () => {
    const fake = server({ aiTasks: true })
    const { user } = setup(fake)
    await openSection(user)
    await chooseKind(user, kinds.summary)

    await waitFor(() => {
      expect(fake.calls('PATCH', '/materials/m1').map((c) => c.body)).toEqual([{ kind: 'summary' }])
    })
    expect(await screen.findByRole('status')).toHaveTextContent(t.reanalyzeHint)
    expect(screen.getByRole('button', { name: new RegExp(t.kindLabel('מבחן 2024.pdf')) })).toHaveTextContent(
      kinds.summary,
    )
    // Review Focus 3: the hint is outside the section, so closing the section does not hide it.
    await user.click(await sectionButton())
    expect(await sectionButton()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('status')).toBeVisible()
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
    const { user } = setup(fake)
    await openSection(user)
    expect(await screen.findByText(en.onboardingMaterials.processing)).toBeInTheDocument()
    expect(screen.queryByText(t.reanalyzeHint)).not.toBeInTheDocument()
    file.ready = true
    expect(await screen.findByText(t.reanalyzeHint, {}, POLL)).toBeInTheDocument()
  })
})
