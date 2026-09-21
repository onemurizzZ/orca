import { describe, expect, it, vi } from 'vitest'
import { createExternalEditorSaveWaits } from './editor-external-save-waits'

/** Control settlement without relying on timer races. */
function pendingWrite() {
  let resolve: () => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('external editor save ownership', () => {
  it('waits for old and new ID writes, including writes added during a drain', async () => {
    const waits = createExternalEditorSaveWaits()
    const oldWrite = pendingWrite()
    const newWrite = pendingWrite()
    waits.track(['caller'], oldWrite.promise)
    const finished = vi.fn()
    const drain = waits.wait('caller').then(finished)
    waits.track(['caller'], newWrite.promise)
    oldWrite.resolve()
    await new Promise((resolve) => setImmediate(resolve))
    expect(finished).not.toHaveBeenCalled()
    newWrite.resolve()
    await drain
    expect(finished).toHaveBeenCalledOnce()
  })

  it('drops a cancelled observer without dropping another observer or its write', async () => {
    const waits = createExternalEditorSaveWaits()
    const write = pendingWrite()
    waits.track(['cancelled', 'active'], write.promise)
    waits.track(['active'], write.promise)
    waits.release('cancelled')
    await waits.wait('cancelled')
    const finished = vi.fn()
    const drain = waits.wait('active').then(finished)
    await new Promise((resolve) => setImmediate(resolve))
    expect(finished).not.toHaveBeenCalled()
    write.resolve()
    await drain
    expect(finished).toHaveBeenCalledOnce()
  })

  it('treats a failed write as settled without leaking a rejected observer promise', async () => {
    const waits = createExternalEditorSaveWaits()
    const write = pendingWrite()
    waits.track(['caller'], write.promise)
    const drain = waits.wait('caller')
    write.reject(new Error('disk unavailable'))
    await drain
    await expect(waits.wait('caller')).resolves.toBeUndefined()
    waits.clear()
  })
})
