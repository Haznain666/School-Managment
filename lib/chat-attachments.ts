import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import {
  chatAttachments,
  type ChatAttachmentMimeType,
  MAX_CHAT_ATTACHMENT_BYTES,
} from '@/db/schema/chat-attachments';
import { chatMessages } from '@/db/schema/chat-messages';

import { db } from './drizzle';
import { sniffImageType } from './image-signature';

/**
 * Files on a message — what may be attached, and what the bytes actually are.
 *
 * ── Staff only, and the identity is the control ──────────────────────────
 * Sprint 24 shipped text-only because images from pupils were the first abuse
 * the brief named. That judgement stands. What changed is *who may upload*:
 * every uploader here is a member of staff, a known adult with an employment
 * record whose account an administrator can switch off.
 *
 * That is why there is no NSFW classifier in this file. The control is
 * accountability rather than a model, and it is enforced in the route rather
 * than by hiding a button — a pupil or a parent posting to the upload endpoint
 * is refused by `staffOnlyProblem` below.
 *
 * ── Why the type is sniffed twice, in two different modules ──────────────
 * `lib/image-signature.ts` recognises **PNG and JPEG only**, and its docblock
 * says the two-format limit is deliberate. It returns null for `%PDF-`.
 *
 * Chat accepts PDF, so something has to know about it. Widening
 * `sniffImageType` was the obvious move and is the wrong one: two other upload
 * paths — student documents and feedback — depend on that function meaning
 * exactly "an image this product will store", and teaching it about PDFs would
 * silently widen both. A student document that is really a PDF would start
 * being accepted by a screen that has said "PNG or JPEG" since Sprint 19.
 *
 * So the PDF check lives here, next to the only route that wants it, and the
 * image check keeps coming from the shared module.
 */

/** `%PDF-` — the five bytes every PDF starts with. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * What these bytes really are, or null.
 *
 * The *sniffed* answer is what gets stored, never the browser's
 * `Content-Type` — the same posture `student_documents` takes, and for the same
 * reason: a `Content-Type` is a claim made by whoever is uploading.
 */
export function sniffChatAttachment(bytes: Uint8Array): ChatAttachmentMimeType | null {
  const image = sniffImageType(bytes);
  if (image !== null) return image;
  if (startsWith(bytes, PDF_SIGNATURE)) return 'application/pdf';
  return null;
}

/** Roles that may attach a file. Everyone else is text-only. */
const ATTACHING_ROLES: readonly string[] = [
  'school_admin',
  'branch_admin',
  'principal',
  'vice_principal',
  'coordinator',
  'teacher',
  'accountant',
  'hr_manager',
  'marketing',
];

/**
 * Why this person may not attach a file, or null.
 *
 * Server-side, not a hidden button. The refusal names the rule rather than the
 * mechanism, because a parent who tries is not doing anything wrong and should
 * be told what the school decided rather than that they lack a permission.
 */
export function staffOnlyProblem(role: string): string | null {
  if (ATTACHING_ROLES.includes(role)) return null;
  return 'Only school staff can attach files. You can still send a message.';
}

/** Why this file may not be stored, or null. */
export function attachmentProblem(
  bytes: Uint8Array,
  declaredName: string,
): { problem: string } | { contentType: ChatAttachmentMimeType } {
  if (bytes.byteLength === 0) {
    return { problem: 'That file is empty.' };
  }

  if (bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES) {
    const mb = (MAX_CHAT_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0);
    return { problem: `Attachments can be at most ${mb} MB. That one is larger.` };
  }

  if (declaredName.trim() === '' || declaredName.length > 200) {
    return { problem: 'That file needs a shorter name.' };
  }

  const contentType = sniffChatAttachment(bytes);
  if (contentType === null) {
    return {
      problem: 'Only PNG, JPEG and PDF files can be attached, and that is none of them.',
    };
  }

  return { contentType };
}

export interface AttachmentRow {
  id: string;
  messageId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/** The attachments on a set of messages, for rendering a transcript. */
export async function attachmentsForMessages(
  locationId: string,
  messageIds: readonly string[],
): Promise<AttachmentRow[]> {
  if (messageIds.length === 0) return [];

  return db
    .select({
      id: chatAttachments.id,
      messageId: chatAttachments.messageId,
      fileName: chatAttachments.fileName,
      contentType: chatAttachments.contentType,
      sizeBytes: chatAttachments.sizeBytes,
    })
    .from(chatAttachments)
    .where(
      and(
        eq(chatAttachments.locationId, locationId),
        inArray(chatAttachments.messageId, [...messageIds]),
      ),
    );
}

/**
 * One attachment, with the conversation it belongs to.
 *
 * The conversation id is what the download route re-checks membership against.
 * An attachment id is not a capability: holding one proves nothing about being
 * allowed to read the thread it hangs off.
 */
export async function attachmentForDownload(
  locationId: string,
  attachmentId: string,
): Promise<{
  storagePath: string;
  fileName: string;
  contentType: string;
  conversationId: string;
} | null> {
  const rows = await db
    .select({
      storagePath: chatAttachments.storagePath,
      fileName: chatAttachments.fileName,
      contentType: chatAttachments.contentType,
      conversationId: chatMessages.conversationId,
    })
    .from(chatAttachments)
    .innerJoin(chatMessages, eq(chatMessages.id, chatAttachments.messageId))
    .where(
      and(eq(chatAttachments.locationId, locationId), eq(chatAttachments.id, attachmentId)),
    )
    .limit(1);

  return rows[0] ?? null;
}
