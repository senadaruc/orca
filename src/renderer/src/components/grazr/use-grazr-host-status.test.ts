// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GrazrActionResult,
  GrazrApi,
  GrazrHostStatus,
  GrazrSyncApi
} from '../../../../shared/grazr-api-types'
import type { GrazrHostRef } from '../../../../shared/grazr-host'
import { useGrazrHostStatus } from './use-grazr-host-status'

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), message: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMocks }))

const HOST: GrazrHostRef = { kind: 'ssh', sshTargetId: 'target-1' }

function statusFor(label: string): GrazrHostStatus {
  return {
    host: HOST,
    label,
    outcome: { kind: 'not-deployed' },
    engineOutdated: false,
    bundledEngineVersion: null
  }
}

type Api = { [K in keyof (GrazrApi & GrazrSyncApi)]: ReturnType<typeof vi.fn> }

function fakeApi(): Api {
  return {
    status: vi.fn(async () => statusFor('Build box')),
    refresh: vi.fn(async (): Promise<GrazrActionResult> => ({ ok: true, message: '' })),
    swap: vi.fn(),
    setEnabled: vi.fn(),
    install: vi.fn(),
    uninstall: vi.fn(),
    deploy: vi.fn(),
    enrolCommand: vi.fn(),
    drainNotices: vi.fn(async () => []),
    setAccounts: vi.fn(),
    syncState: vi.fn(),
    syncSetEnabled: vi.fn(),
    syncApply: vi.fn(),
    syncSetIncluded: vi.fn(),
    syncKick: vi.fn(async () => undefined),
    onSyncStateChanged: vi.fn(() => () => {})
  }
}

type Hook = ReturnType<typeof useGrazrHostStatus>

let api: Api
const roots: Root[] = []

function mount(pollMs: number): { current: Hook | null } {
  const result: { current: Hook | null } = { current: null }
  function Probe(): null {
    result.current = useGrazrHostStatus(HOST, { pollMs, label: 'Build box' })
    return null
  }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  act(() => {
    root.render(createElement(Probe))
  })
  return result
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  api = fakeApi()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { grazr: api }
  })
  toastMocks.error.mockReset()
  toastMocks.message.mockReset()
})

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  vi.useRealTimers()
})

describe('useGrazrHostStatus', () => {
  it('reads the status on mount and again every poll interval', async () => {
    const hook = mount(60_000)
    await flush()
    expect(api.status).toHaveBeenCalledTimes(1)
    expect(hook.current?.status?.label).toBe('Build box')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(api.status).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(api.status).toHaveBeenCalledTimes(3)
  })

  it('ignores a second run while the first is in flight and sets busy at once', async () => {
    const hook = mount(60_000)
    await flush()
    let finish: (value: GrazrActionResult) => void = () => {}
    const action = vi.fn(
      () =>
        new Promise<GrazrActionResult>((resolve) => {
          finish = resolve
        })
    )

    act(() => {
      void hook.current?.run(action)
    })
    act(() => {
      void hook.current?.run(action)
    })
    expect(action).toHaveBeenCalledTimes(1)
    expect(hook.current?.busy).toBe(true)

    await act(async () => {
      finish({ ok: true, message: '' })
      await Promise.resolve()
    })
    expect(hook.current?.busy).toBe(false)
  })

  it('shows the spinner flag only after 200 ms of a call in flight', async () => {
    const hook = mount(60_000)
    await flush()
    act(() => {
      void hook.current?.run(() => new Promise(() => {}))
    })
    expect(hook.current?.busy).toBe(true)
    expect(hook.current?.spinning).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199)
    })
    expect(hook.current?.spinning).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(hook.current?.spinning).toBe(true)
  })

  it('toasts the engine message when an action reports ok false', async () => {
    const hook = mount(60_000)
    await flush()
    await act(async () => {
      await hook.current?.run(async () => ({ ok: false, message: 'Engine refused the swap.' }))
    })
    expect(toastMocks.error).toHaveBeenCalledWith('Engine refused the swap.')
  })

  it('drains notices after an action and toasts each one under the host label', async () => {
    api.drainNotices.mockResolvedValueOnce([
      { ts: '2026-10-22T10:00:00Z', title: 'Swapped', body: 'Now on work@example.test' }
    ])
    const hook = mount(60_000)
    await flush()
    await act(async () => {
      await hook.current?.run(async () => ({ ok: true, message: '' }))
    })
    expect(api.drainNotices).toHaveBeenCalledWith(HOST)
    expect(toastMocks.message).toHaveBeenCalledWith('grazr · Build box', {
      description: 'Swapped\nNow on work@example.test'
    })
  })
})
