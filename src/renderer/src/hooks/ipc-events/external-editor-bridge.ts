import { requestEditorSaveQuiesce } from '@/components/editor/editor-autosave'
import { useAppStore } from '../../store'
import { openLocalFileInFloatingWorkspace } from '@/lib/open-markdown-in-floating-workspace'
import { TOGGLE_FLOATING_TERMINAL_EVENT } from '@/lib/floating-terminal'
import { isFloatingWorkspacePanelVisible } from '@/lib/floating-workspace-terminal-actions'
import {
  EXTERNAL_EDITOR_RENDERER_UNAVAILABLE,
  type ExternalEditorRequest
} from '../../../../shared/external-editor'

export function registerExternalEditorBridge(unsubs: (() => void)[]): void {
  const api = window.api.ui
  if (!api.onExternalEditorRequest || !api.onExternalEditorCancel || !api.respondExternalEditor) {
    return
  }
  const respond = api.respondExternalEditor
  const pending = new Map<string, () => void>()
  const cancel = (requestId: string): void => {
    pending.get(requestId)?.()
    pending.delete(requestId)
  }
  const open = async (request: ExternalEditorRequest): Promise<void> => {
    let cancelled = false
    pending.set(request.requestId, () => {
      cancelled = true
    })
    try {
      const store = useAppStore.getState()
      if (!store.settings?.floatingTerminalEnabled) {
        await store.updateSettings({ floatingTerminalEnabled: true })
      }
      if (cancelled) {
        return
      }
      const basename = request.filePath.split(/[\\/]/).pop() || request.filePath
      const fileId = openLocalFileInFloatingWorkspace(
        store.openFile,
        {
          filePath: request.filePath,
          relativePath: basename
        },
        { focusEditor: true }
      )
      // External editors must preserve prompt text, not serialize it through rich Markdown.
      useAppStore.getState().setMarkdownViewMode(fileId, 'source')
      requestAnimationFrame(() => {
        if (!cancelled && !isFloatingWorkspacePanelVisible()) {
          window.dispatchEvent(new CustomEvent(TOGGLE_FLOATING_TERMINAL_EVENT))
        }
      })
      respond({ requestId: request.requestId, status: 'opened' })
      if (!request.wait) {
        pending.delete(request.requestId)
        return
      }
      let previousFiles = useAppStore.getState().openFiles
      const unsubscribe = useAppStore.subscribe((state) => {
        if (state.openFiles === previousFiles) {
          return
        }
        previousFiles = state.openFiles
        if (state.openFiles.some((file) => file.id === fileId)) {
          return
        }
        unsubscribe()
        // A discarded tab can still have an earlier write in flight.
        void requestEditorSaveQuiesce({ fileId })
          .then(() => {
            if (cancelled) {
              return
            }
            pending.delete(request.requestId)
            respond({ requestId: request.requestId, status: 'closed' })
          })
          .catch((error: unknown) => {
            if (cancelled) {
              return
            }
            cancel(request.requestId)
            respond({ requestId: request.requestId, status: 'error', error: String(error) })
          })
      })
      pending.set(request.requestId, () => {
        cancelled = true
        unsubscribe()
      })
    } catch (error) {
      cancel(request.requestId)
      respond({
        requestId: request.requestId,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  unsubs.push(
    api.onExternalEditorRequest((request) => {
      void open(request)
    }),
    api.onExternalEditorCancel(cancel),
    () => {
      for (const requestId of pending.keys()) {
        cancel(requestId)
        respond({ requestId, status: 'error', error: EXTERNAL_EDITOR_RENDERER_UNAVAILABLE })
      }
    }
  )
}
