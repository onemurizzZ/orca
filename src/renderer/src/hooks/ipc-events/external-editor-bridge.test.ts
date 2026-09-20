import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorFilesSlice } from '@/store/slices/editor/types/editor-files-slice'
import type { ExternalEditorRequest } from '../../../../shared/external-editor'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { registerExternalEditorBridge } from './external-editor-bridge'

const mocks = vi.hoisted(() => ({
  openFile: vi.fn<EditorFilesSlice['openFile']>(() => 'prompt-id'),
  updateSettings: vi.fn(async () => {}),
  setMarkdownViewMode: vi.fn(),
  visible: vi.fn(() => true),
  quiesce: vi.fn(async () => {})
}))
vi.mock('@/components/editor/editor-autosave', () => ({ requestEditorSaveQuiesce: mocks.quiesce }))
let state: {
  openFile: typeof mocks.openFile
  updateSettings: typeof mocks.updateSettings
  setMarkdownViewMode: typeof mocks.setMarkdownViewMode
  settings: { floatingTerminalEnabled: boolean }
  openFiles: { id: string }[]
}
const subscribers = new Set<(value: typeof state) => void>()
vi.mock('../../store', () => ({
  useAppStore: {
    getState: () => state,
    subscribe: (listener: (value: typeof state) => void) => {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    }
  }
}))
vi.mock('@/lib/floating-workspace-terminal-actions', () => ({
  isFloatingWorkspacePanelVisible: mocks.visible
}))
let onRequest: (request: ExternalEditorRequest) => void
let onCancel: (requestId: string) => void
const respond = vi.fn()
let unsubs: (() => void)[]
const request: ExternalEditorRequest = {
  requestId: 'request-1',
  filePath: '/tmp/prompt.md',
  wait: true
}
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  vi.clearAllMocks()
  subscribers.clear()
  state = {
    ...mocks,
    settings: { floatingTerminalEnabled: true },
    openFiles: [{ id: 'prompt-id' }]
  }
  vi.stubGlobal('requestAnimationFrame', vi.fn())
  vi.stubGlobal('window', {
    api: {
      ui: {
        onExternalEditorRequest: (listener: typeof onRequest) => {
          onRequest = listener
          return vi.fn()
        },
        onExternalEditorCancel: (listener: typeof onCancel) => {
          onCancel = listener
          return vi.fn()
        },
        respondExternalEditor: respond
      }
    }
  })
  unsubs = []
  registerExternalEditorBridge(unsubs)
})
afterEach(() => {
  unsubs.forEach((unsubscribe) => unsubscribe())
  vi.unstubAllGlobals()
})

describe('external editor renderer bridge', () => {
  it('opens a persistent local source tab and waits through edits and saves until its removal', async () => {
    onRequest(request)
    await flush()
    expect(mocks.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        runtimeEnvironmentId: null,
        filePath: '/tmp/prompt.md',
        mode: 'edit'
      }),
      expect.objectContaining({
        preview: false,
        focusEditor: true,
        suppressActiveRuntimeFallback: true
      })
    )
    expect(mocks.setMarkdownViewMode).toHaveBeenCalledWith('prompt-id', 'source')
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      requestId: request.requestId,
      status: 'opened'
    })
    subscribers.forEach((listener) => listener(state))
    expect(respond).toHaveBeenCalledOnce()
    state.openFiles = []
    subscribers.forEach((listener) => listener(state))
    await flush()
    expect(respond).toHaveBeenLastCalledWith({ requestId: request.requestId, status: 'closed' })
    expect(subscribers.size).toBe(0)
  })

  it('drains earlier writes before reporting completion', async () => {
    let finishWrite: () => void = () => {}
    mocks.quiesce.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        })
    )
    onRequest(request)
    await flush()
    state.openFiles = []
    subscribers.forEach((listener) => listener(state))
    await flush()
    expect(respond).toHaveBeenCalledOnce()
    finishWrite()
    await flush()
    expect(respond).toHaveBeenLastCalledWith({ requestId: request.requestId, status: 'closed' })
  })

  it('does not confuse another file closing with the requested file closing', async () => {
    state.openFiles.push({ id: 'other-file' })
    onRequest(request)
    await flush()
    state.openFiles = [{ id: 'prompt-id' }]
    subscribers.forEach((listener) => listener(state))
    expect(respond).toHaveBeenCalledOnce()
  })

  it('unsubscribes on caller cancellation without closing or reporting completion', async () => {
    onRequest(request)
    await flush()
    onCancel(request.requestId)
    expect(subscribers.size).toBe(0)
    expect(state.openFiles).toEqual([{ id: 'prompt-id' }])
    expect(respond).toHaveBeenCalledOnce()
  })

  it('does not open a file if the caller cancels while settings are enabling the panel', async () => {
    state.settings.floatingTerminalEnabled = false
    let enable: () => void = () => {}
    mocks.updateSettings.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          enable = resolve
        })
    )
    onRequest(request)
    onCancel(request.requestId)
    enable()
    await flush()
    expect(mocks.openFile).not.toHaveBeenCalled()
    expect(respond).not.toHaveBeenCalled()
  })

  it('returns an error when the renderer bridge is disposed', async () => {
    onRequest(request)
    await flush()
    unsubs.forEach((unsubscribe) => unsubscribe())
    expect(respond).toHaveBeenLastCalledWith({
      requestId: request.requestId,
      status: 'error',
      error: 'renderer_unavailable'
    })
    expect(subscribers.size).toBe(0)
  })

  it('does not retain subscriptions for nonwaiting opens', async () => {
    onRequest({ ...request, wait: false })
    await flush()
    expect(subscribers.size).toBe(0)
    expect(respond).toHaveBeenCalledOnce()
  })

  it('propagates settings failures instead of acknowledging a nonexistent tab', async () => {
    state.settings.floatingTerminalEnabled = false
    mocks.updateSettings.mockRejectedValueOnce(new Error('settings failed'))
    onRequest(request)
    await flush()
    expect(mocks.openFile).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      requestId: request.requestId,
      status: 'error',
      error: 'settings failed'
    })
  })
})
