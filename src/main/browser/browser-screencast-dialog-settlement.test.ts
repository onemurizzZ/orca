/**
 * Settling the dialog the stream reported, on the session that reported it.
 *
 * Measured against Chromium 1217 on 2026-09-20: only the CDP session that received
 * `Page.javascriptDialogOpening` can answer it — a second client that attaches afterwards gets
 * `No dialog is showing`, and every renderer-bound command it sends (`Page.enable`,
 * `Runtime.evaluate`, `DOM.getDocument`) hangs for as long as the dialog is up. So a reply that
 * travels through a fresh session cannot land, and the page stays blocked with no second dialog.
 */
import { describe, expect, it, vi } from 'vitest'

import { startBrowserScreencast } from './browser-screencast-stream'
import { createMockScreencastWebContents } from './browser-screencast-web-contents-test-double'

const OPTIONS = {
  format: 'jpeg' as const,
  quality: 70,
  maxWidth: 1440,
  maxHeight: 1200,
  everyNthFrame: 1,
  minFrameIntervalMs: 0
}

function openDialog(
  webContents: ReturnType<typeof createMockScreencastWebContents>,
  type = 'alert',
  message = 'first'
): void {
  webContents.debugger.emit('message', {}, 'Page.javascriptDialogOpening', { type, message })
}

function dialogCalls(webContents: ReturnType<typeof createMockScreencastWebContents>): unknown[][] {
  return webContents.debugger.sendCommand.mock.calls.filter(
    (call) => call[0] === 'Page.handleJavaScriptDialog'
  )
}

describe('the browser screencast settles the dialog it reported', () => {
  it('answers the open dialog on its own debugger session', async () => {
    const webContents = createMockScreencastWebContents()
    const session = await startBrowserScreencast(webContents as never, {
      ...OPTIONS,
      onFrame: vi.fn(),
      onEvent: vi.fn()
    })

    openDialog(webContents)
    await expect(session.settleDialog(true)).resolves.toBe(true)

    expect(dialogCalls(webContents)).toEqual([['Page.handleJavaScriptDialog', { accept: true }]])

    session.stop()
    await session.done
  })

  it('carries a prompt answer and a dismissal', async () => {
    const webContents = createMockScreencastWebContents()
    const session = await startBrowserScreencast(webContents as never, {
      ...OPTIONS,
      onFrame: vi.fn()
    })

    openDialog(webContents, 'prompt', 'name?')
    await expect(session.settleDialog(true, 'Ada')).resolves.toBe(true)
    webContents.debugger.emit('message', {}, 'Page.javascriptDialogClosed', {})
    openDialog(webContents, 'confirm', 'sure?')
    await expect(session.settleDialog(false)).resolves.toBe(true)

    expect(dialogCalls(webContents)).toEqual([
      ['Page.handleJavaScriptDialog', { accept: true, promptText: 'Ada' }],
      ['Page.handleJavaScriptDialog', { accept: false }]
    ])

    session.stop()
    await session.done
  })

  it('reports no dialog rather than answering one that is not open', async () => {
    const webContents = createMockScreencastWebContents()
    const session = await startBrowserScreencast(webContents as never, {
      ...OPTIONS,
      onFrame: vi.fn()
    })

    await expect(session.settleDialog(true)).resolves.toBe(false)
    openDialog(webContents)
    webContents.debugger.emit('message', {}, 'Page.javascriptDialogClosed', {})
    await expect(session.settleDialog(true)).resolves.toBe(false)

    expect(dialogCalls(webContents)).toEqual([])

    session.stop()
    await session.done
  })

  it('dismisses a dialog still open when the stream stops, so no later session inherits it', async () => {
    const webContents = createMockScreencastWebContents()
    const session = await startBrowserScreencast(webContents as never, {
      ...OPTIONS,
      onFrame: vi.fn()
    })

    openDialog(webContents, 'confirm', 'still up')
    session.stop()
    await session.done

    // Before `Page.stopScreencast`, because a stopped screencast is still an attached session and
    // the order is what makes the answer land rather than race the teardown.
    const methods = webContents.debugger.sendCommand.mock.calls.map((call) => call[0])
    expect(dialogCalls(webContents)).toEqual([['Page.handleJavaScriptDialog', { accept: false }]])
    expect(methods.indexOf('Page.handleJavaScriptDialog')).toBeLessThan(
      methods.indexOf('Page.stopScreencast')
    )
  })

  it('leaves the page alone when it stops with no dialog open', async () => {
    const webContents = createMockScreencastWebContents()
    const session = await startBrowserScreencast(webContents as never, {
      ...OPTIONS,
      onFrame: vi.fn()
    })

    openDialog(webContents)
    webContents.debugger.emit('message', {}, 'Page.javascriptDialogClosed', {})
    session.stop()
    await session.done

    expect(dialogCalls(webContents)).toEqual([])
  })

  it('raises every dialog of the subscription, not just the first', async () => {
    const webContents = createMockScreencastWebContents()
    const onEvent = vi.fn()
    const session = await startBrowserScreencast(webContents as never, {
      ...OPTIONS,
      onFrame: vi.fn(),
      onEvent
    })

    openDialog(webContents, 'alert', 'first')
    await session.settleDialog(true)
    webContents.debugger.emit('message', {}, 'Page.javascriptDialogClosed', {})
    openDialog(webContents, 'confirm', 'second')
    await session.settleDialog(true)

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'dialog', dialogType: 'alert', message: 'first' },
      { type: 'dialogClosed' },
      { type: 'dialog', dialogType: 'confirm', message: 'second' }
    ])

    session.stop()
    await session.done
  })
})
