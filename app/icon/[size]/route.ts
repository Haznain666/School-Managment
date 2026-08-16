import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import sharp from 'sharp';

import { paletteToCSSVars } from '@/lib/branding';
import { readableForeground } from '@/lib/color-contrast';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import { getSchoolBranding } from '@/lib/school-tenant';

/**
 * /icon/192 and /icon/512 — the installed app's icon, per school.
 *
 * ── Why generated rather than uploaded ───────────────────────────────────
 * A school's logo is optional and, when it exists, is whatever aspect ratio
 * they had. An installable app needs a square 192 and a square 512, and a
 * missing icon is one of the few things that makes a PWA silently
 * non-installable — no error, the install prompt simply never appears. Deriving
 * one from the school's own colours means every school is installable on the
 * day it is created, with no operator step.
 *
 * ── Two sizes, and nothing else ──────────────────────────────────────────
 * The path is validated against a fixed list rather than parsed as a number.
 * `/icon/100000` would otherwise be an invitation to ask this server to
 * allocate a ten-gigapixel raster, which is a denial of service with no
 * authentication in front of it.
 *
 * ── Drawn as an SVG and rasterised by sharp ──────────────────────────────
 * `sharp` is already a dependency (`next/image` needs it), so this adds
 * nothing to the lock file — `SPRINTS.md` §0.1 pins that list. The rounded
 * square is inset ~10% so the icon survives Android's maskable crop, which cuts
 * to a circle inscribed in the middle 80%.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The only sizes a manifest here asks for. Not a parsed number — see above. */
const ALLOWED_SIZES = new Set(['192', '512']);

export async function GET(
  _request: Request,
  context: { params: Promise<{ size: string }> },
): Promise<NextResponse> {
  const { size } = await context.params;
  if (!ALLOWED_SIZES.has(size)) {
    return NextResponse.json({ error: 'Unsupported icon size.' }, { status: 404 });
  }

  const px = Number.parseInt(size, 10);
  const headerList = await headers();
  const locationId = headerList.get(SCHOOL_LOCATION_HEADER);

  const branding =
    locationId === null || locationId === ''
      ? null
      : await getSchoolBranding(locationId).catch(() => null);

  const vars = paletteToCSSVars(branding?.palette ?? null) as Record<string, string>;
  const background = channelsToHex(vars['--brand-primary']) ?? '#1d4ed8';
  const foreground = readableForeground(background);

  const png = await sharp(Buffer.from(iconSvg(px, background, foreground, initialsOf(branding?.name ?? 'School'))))
    .png()
    .toBuffer();

  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      // A day: an icon changes only when a school rebrands, and a stale icon on
      // somebody's home screen for a few hours is not a defect worth a
      // re-render on every launch.
      'Cache-Control': 'public, max-age=86400',
      Vary: 'Host',
    },
  });
}

/** Up to two initials, which is all that stays legible at 192px on a phone. */
function initialsOf(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter((part) => /[a-z0-9]/i.test(part))
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return initials === '' ? 'S' : initials;
}

function channelsToHex(value: string | undefined): string | null {
  if (value === undefined) return null;
  const parts = value.trim().split(/\s+/).map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return `#${parts
    .map((part) => Math.max(0, Math.min(255, part)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The icon itself.
 *
 * `initials` is XML-escaped even though it can only be A–Z and 0–9 by the time
 * it gets here: the escape costs nothing and it is what stops a later change to
 * `initialsOf` turning a school name into markup inside an SVG this server
 * rasterises.
 */
function iconSvg(
  px: number,
  background: string,
  foreground: string,
  initials: string,
): string {
  const inset = Math.round(px * 0.1);
  const box = px - inset * 2;
  const radius = Math.round(box * 0.22);
  const fontSize = Math.round(box * (initials.length > 1 ? 0.42 : 0.58));

  const safe = initials.replace(/[<>&"']/g, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">
  <rect width="${px}" height="${px}" fill="${background}"/>
  <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}" fill="${background}"/>
  <text
    x="50%" y="50%"
    dominant-baseline="central" text-anchor="middle"
    font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"
    font-size="${fontSize}" font-weight="700"
    fill="${foreground}"
  >${safe}</text>
</svg>`;
}
