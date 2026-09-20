import { useMemo } from 'react'
import {
  BRIDGE_MEDIA_READ_MAX_BYTES,
  type BridgeMediaItem
} from '../mobile-web-shell/bridge/bridge-media-verbs'
import { useNativeVerbs, type NativeVerbs } from '../mobile-web-shell/bridge/use-native-verbs'
import { MobileImageBase64Accumulator } from '../session/mobile-image-base64-accumulator'
import type { MediaPicker, MobileClipboardImage, PickedMobileImage } from './media-picker-contract'

/**
 * Web sibling: the page has no photo library, no Files app and no pasteboard, so the shell picks
 * for it and hands back a handle.
 *
 * A handle rather than the bytes because a picked image reaches 18 MiB raw, which is over twice the
 * bridge's reply ceiling before base64 has touched it. So one pick is `pick`, then `read` in order
 * to `eof`, then `release` — and `release` runs for every item the caller never took, because the
 * shell holds eight staged files at a time and an abandoned pick otherwise waits out the TTL.
 *
 * Every refusal rejects. A shell that refused the pick, a handle that expired mid-read and a route
 * that was never granted the verb all surface as the `NativeVerbError` the bridge built, with the
 * reason on it; none of them is folded into the empty answer that means "the user cancelled",
 * because a screen showing nothing and a screen showing why are different screens.
 */

/** No preview URI on the page: the shell's staged file is a path in the app's cache that this
 *  document cannot load, and the composer already falls back to an inline data URI. */
function pickedImage(base64: string): PickedMobileImage {
  return { base64 }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * Every chunk of one staged item, concatenated as bytes and encoded once.
 *
 * Bytes and not strings: each chunk is base64 on its own, so only the last one may end on a partial
 * group, and a reader that joined the text would fold that padding into the middle of the file. The
 * cap the shell enforces is the same one asked for here, so a read never fails for being too large.
 */
async function readItem(verbs: NativeVerbs, item: BridgeMediaItem): Promise<string> {
  const accumulator = new MobileImageBase64Accumulator()
  let offset = 0
  for (;;) {
    // At least one byte, because an empty staged item still has to be read once to hear `eof`, and
    // the shell's schema refuses a zero-length read.
    const length = Math.max(1, Math.min(BRIDGE_MEDIA_READ_MAX_BYTES, item.byteLength - offset))
    const chunk = await verbs.readMedia(item.handle, offset, length)
    const bytes = decodeBase64(chunk.base64)
    accumulator.append(bytes)
    offset += bytes.byteLength
    if (chunk.eof) {
      break
    }
    if (bytes.byteLength === 0) {
      // Not `eof` and no bytes is a shell that would never finish. Named here rather than left to
      // spin, because the loop has no other exit.
      throw new Error(`the shell answered no bytes for ${item.handle} and did not report the end`)
    }
  }
  if (offset !== item.byteLength) {
    throw new Error(
      `the shell answered ${offset} bytes for an item it declared as ${item.byteLength}`
    )
  }
  return accumulator.finish()
}

/** Best effort, and deliberately quiet: this runs in a `finally`, where a throw would replace the
 *  refusal that brought us here with a complaint about cleaning up after it. */
async function releaseQuietly(verbs: NativeVerbs, handle: string): Promise<void> {
  try {
    await verbs.releaseMedia(handle)
  } catch (error) {
    console.warn('[page] a staged media handle could not be released', { handle }, error)
  }
}

async function* readPicked(
  verbs: NativeVerbs,
  items: readonly BridgeMediaItem[]
): AsyncGenerator<PickedMobileImage> {
  const unread = [...items]
  try {
    while (unread.length > 0) {
      const item = unread[0]!
      const base64 = await readItem(verbs, item)
      // Released before the yield, not after: the caller may take one image and walk away, and the
      // shell counts what it is still holding against every later pick.
      unread.shift()
      await releaseQuietly(verbs, item.handle)
      yield pickedImage(base64)
    }
  } finally {
    // The item whose read threw, and everything the caller never asked for.
    for (const item of unread) {
      await releaseQuietly(verbs, item.handle)
    }
  }
}

export function useMediaPicker(): MediaPicker {
  const verbs = useNativeVerbs()

  return useMemo<MediaPicker>(
    () => ({
      pickImage: async (source) => {
        for await (const image of readPicked(verbs, await verbs.pickMedia(source, false))) {
          return image
        }
        return null
      },
      pickImages: (source) => ({
        [Symbol.asyncIterator]: async function* () {
          yield* readPicked(verbs, await verbs.pickMedia(source, true))
        }
      }),
      readClipboardImage: async (): Promise<MobileClipboardImage | null> => {
        const [item] = await verbs.pickMedia('clipboard', false)
        if (item === undefined) {
          return null
        }
        try {
          return {
            data: await readItem(verbs, item),
            // Zero when the pasteboard reported no dimensions, which is what the downscale loop
            // already reads as "cannot resize this": the upload path's own size check then refuses
            // an image too large rather than this seam guessing a raster size for it.
            size: { width: item.width ?? 0, height: item.height ?? 0 }
          }
        } finally {
          await releaseQuietly(verbs, item.handle)
        }
      }
    }),
    [verbs]
  )
}
