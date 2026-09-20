# Use Orca as an external editor

`orca file edit --wait <path>` opens an existing local UTF-8 text file in Orca's
floating workspace and returns after its editor tab closes. The file does not
need to belong to a project, Git worktree, or folder workspace. Markdown opens in
Source mode so editing a prompt does not reformat it through the rich editor.

For a POSIX shell:

```sh
export EDITOR="orca file edit --wait"
export VISUAL="orca file edit --wait"
```

For PowerShell:

```powershell
$env:EDITOR = 'orca file edit --wait'
$env:VISUAL = 'orca file edit --wait'
```

Start Orca before invoking the command; this version does not launch the app automatically.
The calling tool must support an editor command with arguments. Use the Orca CLI
that belongs to the desktop build containing this feature. For a development
build use `orca-dev file edit --wait` instead. This feature does not modify shell
configuration automatically.

## Completion and failures

- Save the file and close its tab to return to the calling tool. Saving alone
  leaves `--wait` running. The existing unsaved-changes flow still applies;
  cancelling a close leaves the caller waiting.
- Closing without saving returns the on-disk content. Outstanding writes are
  drained before completion is reported.
- Omitting `--wait` returns once the renderer acknowledges creating the tab.
- Closing the whole window, reloading or crashing the renderer, losing the
  runtime connection, or removing/renaming the original file fails the command.
  These events are not reported as successful editing.
- Ctrl+C cancels the caller's wait; it does not close the editor or discard edits.
- Multiple callers opening the same file each wait for that tab to close.

## Current scope

This first version supports **existing local files up to 1 MiB**, including empty
files and filenames without an extension. Binary formats, NUL bytes, invalid
UTF-8, directories, and missing files are rejected before a tab is requested.
The floating workspace is enabled if needed. No OS window activation is added.

SSH/WSL CLI shims and paired-runtime calls are rejected explicitly: their paths
belong to another execution host. Headless servers cannot provide the required
desktop acknowledgement. Local files stay local even if the desktop is viewing
a remote workspace. Native macOS, Windows, and Linux use the same command;
live validation on each platform is separate from mocked coverage.

An older runtime rejects the new `files.edit` method. An older renderer that
cannot acknowledge the request times out after 30 seconds. Once acknowledged,
the CLI waits for up to the transport timer maximum (about 24.8 days). Runtime
long-poll admission limits and disconnect cleanup also apply to editor requests.

`orca file open` keeps its existing workspace-scoped behavior. `file edit` is
separate because a caller-selected temporary path needs an explicit local-file
authorization and a tab-lifetime acknowledgement, not a relaxed workspace guard.
