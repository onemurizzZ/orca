/** Associate existing writes with callers independently of path-derived editor IDs. */
export function createExternalEditorSaveWaits() {
  const pending = new Map<string, Set<Promise<void>>>()

  /** Repeated store notifications must not attach duplicate settlement handlers. */
  const track = (requestIds: readonly string[] | undefined, save: Promise<void>): void => {
    for (const requestId of requestIds ?? []) {
      const writes = pending.get(requestId) ?? new Set<Promise<void>>()
      if (writes.has(save)) {
        continue
      }
      pending.set(requestId, writes)
      writes.add(save)
      const settled = (): void => {
        writes.delete(save)
        if (writes.size === 0 && pending.get(requestId) === writes) {
          pending.delete(requestId)
        }
      }
      void save.then(settled, settled)
    }
  }

  /** Include writes admitted during an earlier drain without following a reused file ID. */
  const wait = async (requestId: string): Promise<void> => {
    while (pending.has(requestId)) {
      const writes = pending.get(requestId)
      if (!writes) {
        return
      }
      await Promise.all([...writes].map((save) => save.catch(() => undefined)))
    }
  }

  return {
    track,
    wait,
    /** Cancel observation without cancelling writes shared with another caller. */
    release: (requestId: string): void => {
      pending.delete(requestId)
    },
    /** The save controller owns these observations only for its own lifetime. */
    clear: (): void => pending.clear()
  }
}
