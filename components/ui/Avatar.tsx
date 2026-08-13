import Image from 'next/image';

import { cn } from '@/lib/utils';

/**
 * A person, drawn as their photo or as their initials.
 *
 * ── Initials, and why they are not a colour hash ─────────────────────────
 * The reflex is to hash the name into a hue so every person gets their own
 * colour. That is wrong here for two reasons. The palette is the school's, and
 * a hash spraying arbitrary hues across a staff list is precisely the thing
 * that makes a themed product stop looking themed. And a hashed hue carries no
 * information — two teachers being different colours does not tell you
 * anything, it just adds noise to a list you are scanning for a name.
 *
 * So initials sit on the brand's own subtle wash, and every avatar in a list
 * matches. Identity is carried by the letters, which are actually meaningful.
 *
 * ── Deriving initials from names in this market ──────────────────────────
 * Pakistani names frequently carry honorifics and particles ("Muhammad",
 * "Syed", "bin", "ul") and are often three or four parts long. Taking the first
 * letter of the first two words gives "MA" for a great many unrelated people.
 * `initialsFor` drops leading honorifics and prefers the first and *last*
 * meaningful part, which separates "Muhammad Bilal Ahmed" (BA) from "Muhammad
 * Asif Raza" (AR).
 */

const SIZES = {
  xs: { box: 'h-6 w-6', text: 'text-2xs', pixels: 24 },
  sm: { box: 'h-8 w-8', text: 'text-xs', pixels: 32 },
  md: { box: 'h-10 w-10', text: 'text-sm', pixels: 40 },
  lg: { box: 'h-14 w-14', text: 'text-base', pixels: 56 },
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
 * Words that are titles rather than names, and so carry no identifying value in
 * an initial. Lowercased for comparison.
 */
const HONORIFICS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'prof',
  'sir',
  'madam',
  'muhammad',
  'mohammad',
  'mohammed',
  'md',
  'syed',
  'shaikh',
  'sheikh',
  'hafiz',
  'mian',
  'malik',
  'ch',
  'chaudhry',
  'bin',
  'binte',
  'ul',
  'al',
  'ur',
]);

/** One or two letters that identify a person in a list. */
export function initialsFor(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}]/gu, ''))
    .filter((part) => part.length > 0);

  if (parts.length === 0) return '?';

  const meaningful = parts.filter((part) => !HONORIFICS.has(part.toLowerCase()));

  // Everything was an honorific — "Syed Muhammad". Fall back to the raw parts
  // rather than returning nothing; a wrong-ish initial beats an empty circle.
  const usable = meaningful.length > 0 ? meaningful : parts;

  const first = usable[0]!;
  const last = usable.length > 1 ? usable[usable.length - 1]! : undefined;

  return (
    first.charAt(0) + (last === undefined ? '' : last.charAt(0))
  ).toUpperCase();
}

export interface AvatarProps {
  /** Full name. Used for the initials and for the accessible label. */
  name: string;
  /** Photo URL. Falls back to initials when absent or when it fails to load. */
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const { box, text, pixels } = SIZES[size];

  return (
    <span
      // `title` as well as the label, because a truncated staff list is a place
      // people hover to confirm who they are looking at.
      title={name}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'bg-brand-primarySubtle text-brand-onPrimarySubtle',
        // A ring rather than a border: it sits outside the box, so the photo is
        // not inset by a pixel on one side at small sizes.
        'ring-1 ring-inset ring-[rgb(var(--ink)/0.08)]',
        box,
        className,
      )}
    >
      {src !== undefined && src !== null && src !== '' ? (
        <Image
          src={src}
          alt={name}
          width={pixels}
          height={pixels}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden="true" className={cn('font-semibold leading-none', text)}>
          {initialsFor(name)}
        </span>
      )}
      {src === undefined || src === null || src === '' ? (
        <span className="sr-only">{name}</span>
      ) : null}
    </span>
  );
}

export interface AvatarGroupProps {
  people: ReadonlyArray<{ name: string; src?: string | null }>;
  /** Beyond this many, the rest become a "+N" chip. */
  max?: number;
  size?: AvatarSize;
  className?: string;
}

/** Overlapping avatars for "who is in this section" style summaries. */
export function AvatarGroup({ people, max = 4, size = 'sm', className }: AvatarGroupProps) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <span className={cn('flex items-center -space-x-2', className)}>
      {shown.map((person, index) => (
        <Avatar
          key={`${person.name}-${index}`}
          name={person.name}
          src={person.src}
          size={size}
          className="ring-2 ring-surface-raised"
        />
      ))}

      {overflow > 0 ? (
        <span
          className={cn(
            'relative inline-flex items-center justify-center rounded-full',
            'bg-surface-sunken text-ink-muted ring-2 ring-surface-raised',
            SIZES[size].box,
            SIZES[size].text,
            'font-semibold',
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
