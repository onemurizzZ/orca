import type { ActiveBrowserScreencastPage } from './runtime-browser-commands-browser-command-target-params'

/**
 * Answers a page's modal dialog on the screencast that reported it, if one is streaming.
 *
 * Chromium hands `Page.javascriptDialogOpening` to one CDP session and takes the answer only from
 * that session; a client attaching afterwards is told `No dialog is showing`. The agent-browser
 * path the other browser commands take is always a later client, and its bootstrap is
 * renderer-bound, so it blocks behind the very dialog it was sent to clear. `false` means nothing
 * here owns a dialog and the caller should take that path anyway — an agent driving a page with no
 * viewer still reaches Chromium's own dialog state through it.
 */
export async function settleBrowserDialogOnLiveScreencast(
  activeScreencastsByPageId: ReadonlyMap<string, ActiveBrowserScreencastPage>,
  browserPageId: string | undefined,
  accept: boolean,
  promptText?: string
): Promise<boolean> {
  if (browserPageId === undefined) {
    return false
  }
  const session = activeScreencastsByPageId.get(browserPageId)?.session
  if (!session) {
    return false
  }
  return session.settleDialog(accept, promptText)
}
