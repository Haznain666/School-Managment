import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { paletteToCSSVars } from '@/lib/branding';
import { SCHOOL_LOCATION_HEADER, SCHOOL_SLUG_HEADER } from '@/lib/school-context';
import { getSchoolBranding } from '@/lib/school-tenant';

/**
 * /manifest.webmanifest — the installable app, per school.
 *
 * ── Why a route and not `app/manifest.ts` ────────────────────────────────
 * Next's `MetadataRoute.Manifest` export is static: one manifest for the whole
 * deployment. This is a multi-tenant platform on wildcard subdomains, and one
 * manifest would install every school's parents an app called "SMS Platform" in
 * somebody else's colours. The tenant is already on the request — middleware
 * stamps it — so the manifest can simply be the school's.
 *
 * ── `start_url` and `scope` are relative on purpose ──────────────────────
 * A browser resolves both against the manifest's own URL, which is the school's
 * subdomain. Hard-coding an absolute origin would either be wrong for every
 * school but one, or require the manifest to know the base domain — and a
 * mismatch between `scope` and the page that registered the service worker is
 * the failure that silently makes an app non-installable.
 *
 * ── No `id` field, deliberately ──────────────────────────────────────────
 * Omitted, so the browser derives the app id from `start_url`. Each school is
 * therefore a distinct installed app, which is what a parent with children at
 * two schools needs. A shared `id` would make the second install replace the
 * first.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const headerList = await headers();
  const locationId = headerList.get(SCHOOL_LOCATION_HEADER);
  const slug = headerList.get(SCHOOL_SLUG_HEADER);

  const branding =
    locationId === null || locationId === ''
      ? null
      : await getSchoolBranding(locationId).catch(() => null);

  const name = branding?.name ?? 'School Portal';

  // The theme colour is the school's primary, read through the same derivation
  // the portals paint with — so the Android title bar and the app's own header
  // are the same colour rather than two versions of "the brand".
  const vars = paletteToCSSVars(branding?.palette ?? null) as Record<string, string>;
  const themeColor = cssVarToHex(vars['--brand-primary']) ?? '#1d4ed8';
  const backgroundColor = cssVarToHex(vars['--brand-background']) ?? '#ffffff';

  const manifest = {
    name,
    short_name: name.length > 12 ? name.slice(0, 12).trimEnd() : name,
    description: `${name} — attendance, fees, results and notices.`,
    start_url: './',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: themeColor,
    background_color: backgroundColor,
    icons: [
      { src: '/icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      // Per-tenant, and a school may change its name or colours. Short enough
      // that a rebrand lands the same day, long enough not to be re-fetched on
      // every launch.
      'Cache-Control': 'public, max-age=3600',
      ...(slug === null ? {} : { Vary: 'Host' }),
    },
  });
}

/**
 * `paletteToCSSVars` yields Tailwind-style `R G B` triples for `rgb()`.
 * The manifest wants a hex colour, and a browser given `220 38 38` treats the
 * whole manifest as malformed rather than ignoring one field.
 */
function cssVarToHex(value: string | undefined): string | null {
  if (value === undefined) return null;

  const parts = value.trim().split(/\s+/).map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;

  return `#${parts
    .map((part) => Math.max(0, Math.min(255, part)).toString(16).padStart(2, '0'))
    .join('')}`;
}
