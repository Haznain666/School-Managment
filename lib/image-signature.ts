/**
 * What a file actually is, read from its own first bytes.
 *
 * ── Why the Content-Type is not an answer ────────────────────────────────
 * A multipart part carries whatever media type the *browser* guessed, and every
 * browser guesses from the file extension. So `payload.exe` renamed to
 * `photo.png` arrives with `Content-Type: image/png`, passes an extension
 * check, passes a header check, and lands in the school's bucket at a public
 * URL under a title an operator chose. Nothing in that chain looked at the
 * file.
 *
 * The first bytes of a container format are not a guess. They are written by
 * whatever produced the file and they are the only thing in an upload that the
 * uploader cannot trivially lie about while keeping the file usable.
 *
 * ── Both checks, not one ────────────────────────────────────────────────
 * Callers check the declared type *as well*, and refuse when the two disagree.
 * That is not redundancy: sniffing alone would happily accept a real JPEG
 * uploaded through a field that promised PNGs, and the declared type alone is
 * the hole above. Two agreeing answers is the only state worth storing, and the
 * one that gets stored is this function's — the bytes are the fact.
 *
 * ── Deliberately not `file-type` or any other package ────────────────────
 * Two formats, six bytes of signature between them. A dependency here would add
 * a hundred detectors, none of which this product accepts, to a server bundle
 * that would then have to be audited. `lib/storage.ts` makes the same argument
 * about `@supabase/supabase-js` and for the same reason.
 *
 * Dependency-free and free of `server-only` on purpose, so a test or a future
 * client-side pre-check can call it. Nothing here reads the environment.
 */

/** The media types this module can recognise. */
export type SniffedImageType = 'image/png' | 'image/jpeg';

/**
 * The eight-byte PNG signature.
 *
 * `\x89PNG\r\n\x1a\n` — and every byte of it earns its place. The high bit on
 * the first byte catches a seven-bit transfer, `\r\n` catches a line-ending
 * conversion, and the `\x1a` is a DOS end-of-file so that `TYPE image.png`
 * stops rather than filling a terminal. It is checked whole because checking
 * four bytes of it would match a file that had been corrupted in exactly the
 * ways the other four exist to detect.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The JPEG Start-of-Image marker, `FF D8 FF`.
 *
 * Only three bytes, because the fourth varies by encoder: `E0` for JFIF, `E1`
 * for EXIF — which is what every phone camera in a school office produces —
 * `DB` for a raw table, `EE` for Adobe. Insisting on `FF D8 FF E0` would refuse
 * the photographs this feature exists to accept.
 */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * The media type these bytes actually are, or null for anything else.
 *
 * Null is the answer for an empty buffer, a truncated upload and a PDF alike.
 * The caller turns it into a refusal that names what *is* accepted, because
 * "unsupported file" tells an admissions clerk nothing they can act on.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  return null;
}

/**
 * Whether a declared media type names the same format as `sniffed`.
 *
 * `image/jpg` is accepted as JPEG here and **only** here. It is not a real
 * media type — it is what some Windows browsers send — and refusing it would
 * refuse a genuine photograph for a spelling its uploader never chose. What
 * gets *stored* is always `sniffed`, so the non-type never reaches a column.
 */
export function declaredTypeMatches(
  declared: string,
  sniffed: SniffedImageType,
): boolean {
  const normalised = declared.trim().toLowerCase().split(';')[0] ?? '';

  if (sniffed === 'image/jpeg') {
    return normalised === 'image/jpeg' || normalised === 'image/jpg';
  }

  return normalised === sniffed;
}
