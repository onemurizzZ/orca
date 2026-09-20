/**
 * What picking media means to the screens, free of any device API.
 *
 * The two siblings of `media-picker.ts` agree on this and nothing else: one opens the OS pickers
 * over `expo-image-picker` and `expo-document-picker`, the other asks the shell for them over
 * `native.media.pick` / `read` / `release`. Neither type nor error may live beside an Expo import,
 * because a screen that catches `ImageLibraryPermissionError` would otherwise drag the native
 * picker chain into the page bundle for the sake of one `instanceof`.
 */
import type { MobileClipboardImage } from '../session/mobile-clipboard-image'

/** Where a picked image comes from. The pasteboard is `readClipboardImage`, not a source here:
 *  its caller wants pixel dimensions and gets no file. */
export type MobileImageSource = 'library' | 'files'

export type PickedMobileImage = {
  // Raw base64 (no data: prefix); fed straight into the existing upload pipeline.
  readonly base64: string
  // Local file URI of the picked asset — used only to render a composer preview
  // thumbnail (the host upload uses `base64`); absent when the source can't supply one.
  readonly uri?: string
}

export class ImageLibraryPermissionError extends Error {
  constructor() {
    super('Photo library permission denied')
    this.name = 'ImageLibraryPermissionError'
  }
}

/** Re-exported so a caller of `readClipboardImage` has one import rather than two; the type is
 *  the upload path's own, so the two cannot disagree about what it answers. */
export type { MobileClipboardImage }

/**
 * Picking on whichever half of the app is running.
 *
 * A hook rather than three functions because the web sibling needs the page's bridge client, which
 * is React context — the shape the clipboard seam already has.
 *
 * Rejecting is how every one of these reports failure, and a cancelled picker is not a failure: it
 * answers `null` or an empty sequence. The web sibling never turns a refusal into one of those,
 * because "the shell refused the pick" and "the user changed their mind" lead a caller to opposite
 * screens.
 */
export type MediaPicker = {
  pickImage: (source: MobileImageSource) => Promise<PickedMobileImage | null>
  pickImages: (source: MobileImageSource) => AsyncIterable<PickedMobileImage>
  /** The pasteboard's image, or null when it holds none. */
  readClipboardImage: () => Promise<MobileClipboardImage | null>
}
