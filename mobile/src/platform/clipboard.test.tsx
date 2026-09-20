/** The native form of the clipboard seam: the app's own `expo-clipboard`, and what it answers. */
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipboardReader, ClipboardWriter } from './clipboard'

const clipboard = vi.hoisted(() => ({
  setStringAsync: vi.fn(() => Promise.resolve(true)),
  getStringAsync: vi.fn(() => Promise.resolve('pasted'))
}))

vi.mock('expo-clipboard', () => clipboard)

import { useClipboardReader, useClipboardWriter } from './clipboard'

/** The hook as a screen holds it; `react-test-renderer` is what every other seam test here uses. */
function mountWriter(): ClipboardWriter {
  const held: { writer: ClipboardWriter | null } = { writer: null }
  function Screen(): null {
    held.writer = useClipboardWriter()
    return null
  }
  act(() => {
    create(<Screen />)
  })
  const writer = held.writer
  if (writer === null) {
    throw new Error('nothing mounted')
  }
  return writer
}

function mountReader(): ClipboardReader {
  const held: { reader: ClipboardReader | null } = { reader: null }
  function Screen(): null {
    held.reader = useClipboardReader()
    return null
  }
  act(() => {
    create(<Screen />)
  })
  const reader = held.reader
  if (reader === null) {
    throw new Error('nothing mounted')
  }
  return reader
}

beforeEach(() => {
  clipboard.getStringAsync.mockReset()
  clipboard.getStringAsync.mockImplementation(() => Promise.resolve('pasted'))
  clipboard.setStringAsync.mockReset()
  clipboard.setStringAsync.mockImplementation(() => Promise.resolve(true))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('writing the clipboard on a phone', () => {
  it('hands the text to the app unchanged', async () => {
    const writer = mountWriter()
    await expect(writer.writeText('copied')).resolves.toBeUndefined()
    expect(clipboard.setStringAsync.mock.calls).toEqual([['copied']])
  })

  it('rejects when the pasteboard refused it, rather than reporting a copy', async () => {
    // `setStringAsync` answers whether the write landed, and a caller showing "Copied" over a
    // write that did not is the failure this seam exists to avoid.
    clipboard.setStringAsync.mockImplementation(() => Promise.resolve(false))
    const writer = mountWriter()
    await expect(writer.writeText('copied')).rejects.toThrow(/did not accept/)
  })
})

describe('reading the clipboard on a phone', () => {
  it('answers whatever the pasteboard held, empty included', async () => {
    expect(await mountReader().readText()).toBe('pasted')
    clipboard.getStringAsync.mockImplementation(() => Promise.resolve(''))
    // Empty is not a fault: the terminal paste reads it as "no text" and looks for an image.
    expect(await mountReader().readText()).toBe('')
    expect(clipboard.getStringAsync).toHaveBeenCalledTimes(2)
  })

  it('answers one object across mounts, so a caller may hold it in a dependency list', () => {
    expect(mountReader()).toBe(mountReader())
  })
})
