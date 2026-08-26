import {
  FEEDBACK_STATUSES,
  type FeedbackNature,
  type FeedbackStatus,
} from '@/db/schema/feedback';

/**
 * The rules a feedback ticket has to satisfy, in one place both sides read.
 *
 * Deliberately free of `server-only` and of any database import, exactly as
 * `lib/permissions.ts` is: the browser form and the route enforce the same
 * numbers, from the same constants, or they drift. A form that accepts a sixth
 * file and a route that refuses it is a school losing what it just typed.
 */

/** The product owner's cap. Enforced in the form and again in the route. */
export const MAX_ATTACHMENTS = 5;

/**
 * 10 MB per file.
 *
 * Not a product decision so much as a physical one: the whole request is held
 * in memory while it is read, and five 10 MB screenshots is already a 50 MB
 * body. The three accepted types are all things a person produces from a phone
 * or a laptop and none of them reaches this legitimately.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * PNG, JPEG and PDF, and nothing else.
 *
 * The extension list beside it is not redundant. A browser will happily send
 * `application/octet-stream` for a file it does not recognise, and a phone
 * camera roll occasionally sends an empty type — so a file is accepted when
 * *either* its declared type or its extension is on the list, and refused when
 * neither is. Sniffing the magic bytes would be stronger and is not done here:
 * nothing on this path ever executes or renders the file, it is streamed back
 * as an attachment with `Content-Disposition: attachment`, and a mislabelled
 * PNG is a curiosity rather than a vector.
 */
export const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf'] as const;
export const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf'] as const;

/** What the file input's `accept` attribute carries. */
export const ATTACHMENT_ACCEPT = [...ACCEPTED_MIME_TYPES, ...ACCEPTED_EXTENSIONS].join(',');

export const TITLE_MAX = 160;
export const BODY_MAX = 8000;
export const REPLY_MAX = 8000;

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

/**
 * Why this file cannot be attached, or null when it can.
 *
 * Returns a sentence rather than a code. The caller is always about to show it
 * to the person who chose the file, and "unsupported_type" is not something
 * anybody can act on.
 */
export function attachmentProblem(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (file.size === 0) {
    return `"${file.name}" is empty.`;
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    const mb = Math.round((file.size / (1024 * 1024)) * 10) / 10;
    return `"${file.name}" is ${mb} MB. The limit is ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB per file.`;
  }

  const typeOk = (ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type);
  const extensionOk = (ACCEPTED_EXTENSIONS as readonly string[]).includes(
    extensionOf(file.name),
  );

  if (!typeOk && !extensionOk) {
    return `"${file.name}" is not a PNG, JPEG or PDF.`;
  }

  return null;
}

/** The content type to store, preferring the declared one when it is usable. */
export function resolveContentType(file: { name: string; type: string }): string {
  if ((ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) return file.type;

  switch (extensionOf(file.name)) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

export interface FeedbackDraft {
  title: string;
  body: string;
  nature: FeedbackNature;
}

/**
 * Why this ticket cannot be sent, or null.
 *
 * Blank title and blank description are both refused, and that is not the same
 * judgement `CnicField` makes about a blank CNIC. A CNIC that is not to hand is
 * a fact about the world; a feedback ticket with no words in it is not a
 * message at all, and there is nobody it could be chased with.
 */
export function feedbackProblem(draft: FeedbackDraft): string | null {
  const title = draft.title.trim();
  const body = draft.body.trim();

  if (title === '') return 'Give the feedback a title.';
  if (title.length > TITLE_MAX) return `The title must be ${TITLE_MAX} characters or fewer.`;
  if (body === '') return 'Describe what you saw, or what you would like.';
  if (body.length > BODY_MAX) return `The description must be ${BODY_MAX} characters or fewer.`;

  return null;
}

/**
 * The four sections the Super Admin listing is divided into.
 *
 * `active` is two statuses rather than one: a ticket somebody has opened but
 * not decided about is still work outstanding, and moving it out of the active
 * list the moment it was read would mean opening a ticket made it disappear.
 * That is the product owner's rule, and it is stated here once so the listing,
 * the counters and the dashboard tile cannot disagree about it.
 */
export const FEEDBACK_SECTIONS = ['active', 'in_progress', 'future', 'resolved'] as const;
export type FeedbackSection = (typeof FEEDBACK_SECTIONS)[number];

export const FEEDBACK_SECTION_LABELS: Record<FeedbackSection, string> = {
  active: 'Active',
  in_progress: 'Work in progress',
  future: 'Future development',
  resolved: 'Resolved',
};

export const FEEDBACK_SECTION_DESCRIPTIONS: Record<FeedbackSection, string> = {
  active: 'Everything nobody has decided about yet, read or not.',
  in_progress: 'Being worked on now.',
  future: 'Agreed, and scheduled for a later release.',
  resolved: 'Done, or answered.',
};

/** Which statuses fall in a section. The one definition of the split. */
export const FEEDBACK_SECTION_STATUSES: Record<FeedbackSection, readonly FeedbackStatus[]> = {
  active: ['unread', 'read'],
  in_progress: ['in_progress'],
  future: ['future'],
  resolved: ['resolved'],
};

export function isFeedbackSection(value: unknown): value is FeedbackSection {
  return (
    typeof value === 'string' && (FEEDBACK_SECTIONS as readonly string[]).includes(value)
  );
}

export function sectionForStatus(status: FeedbackStatus): FeedbackSection {
  switch (status) {
    case 'unread':
    case 'read':
      return 'active';
    case 'in_progress':
      return 'in_progress';
    case 'future':
      return 'future';
    case 'resolved':
      return 'resolved';
  }
}

/**
 * The badge colour for a status.
 *
 * `unread` is `info` rather than `danger`. Urgency on this screen belongs to
 * the *nature* — a bug is highlighted whatever its status — and a listing where
 * every new row is red trains an operator to stop seeing red, which is exactly
 * the signal a bug report needs to keep.
 */
export function statusBadgeVariant(
  status: FeedbackStatus,
): 'info' | 'neutral' | 'warning' | 'brand' | 'success' {
  switch (status) {
    case 'unread':
      return 'info';
    case 'read':
      return 'neutral';
    case 'in_progress':
      return 'warning';
    case 'future':
      return 'brand';
    case 'resolved':
      return 'success';
  }
}

export function natureBadgeVariant(nature: FeedbackNature): 'danger' | 'neutral' {
  return nature === 'bug' ? 'danger' : 'neutral';
}

/** Sort columns the Super Admin listing offers, and the route's whitelist. */
export const FEEDBACK_SORT_COLUMNS = [
  'createdAt',
  'title',
  'school',
  'nature',
  'status',
] as const;
export type FeedbackSortColumn = (typeof FEEDBACK_SORT_COLUMNS)[number];

/** Re-exported so a caller needs one import rather than two. */
export { FEEDBACK_STATUSES };
export type { FeedbackNature, FeedbackStatus };
