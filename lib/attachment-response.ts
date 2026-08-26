import 'server-only';

import { NextResponse } from 'next/server';

import type { DownloadedObject } from './storage';

/**
 * Turns a stored object into a download.
 *
 * Shared by the school route and the platform one so the two cannot disagree
 * about the headers. It lives in `lib/` rather than beside either of them: a
 * module one route tree owns and the other reaches across into is a module that
 * gets moved carelessly the first time somebody reorganises `app/api`.
 *
 * The headers matter — and the headers are the whole security posture of this
 * endpoint, not a formatting detail:
 *
 * `Content-Disposition: attachment` means the browser saves the file rather
 * than rendering it. A PDF rendered inline runs in this origin, and a PDF is a
 * scriptable format; an `inline` disposition here would turn "a school attached
 * a file" into "a school ran something on the portal's origin". The product
 * owner's requirement — clicking an attachment downloads it — and the safe
 * behaviour are the same behaviour, which is a happy accident worth writing
 * down so nobody later "improves" it into a preview.
 *
 * `X-Content-Type-Options: nosniff` stops a browser second-guessing the type
 * and rendering something we declared as an image.
 *
 * `private, no-store` keeps it out of every shared cache. Prerendered pages on
 * this deployment ship a year-long `s-maxage` (STATE.md §5aq), and a tenant's
 * file landing in a CDN under that policy is exactly the leak the route exists
 * to prevent.
 */
export function attachmentResponse(
  object: DownloadedObject,
  fileName: string,
  contentType: string,
): NextResponse {
  /*
   * Two forms of the filename, which is not belt-and-braces but the actual
   * specification: RFC 6266 says a bare `filename` must be ASCII, and every
   * modern browser prefers `filename*` when both are present. A school
   * uploading `فیس.pdf` gets its own name back, and a browser that has never
   * heard of RFC 5987 gets something it can still save.
   */
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName);

  return new NextResponse(object.bytes, {
    headers: {
      // The declared type from the row, not the one Storage echoed back: the
      // row is what was validated on upload.
      'Content-Type': contentType,
      'Content-Length': String(object.bytes.byteLength),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
