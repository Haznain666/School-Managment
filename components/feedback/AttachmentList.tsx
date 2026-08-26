import { FileText, Image as ImageGlyph } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
import type { FeedbackAttachmentRow } from '@/lib/feedback-queries';

/**
 * The files on a ticket, as downloads.
 *
 * ── Plain `<a>`, not `<Link>`, and that is deliberate ────────────────────
 * `next/link` prefetches and routes client-side. Neither is right for a URL
 * whose response is `Content-Disposition: attachment` — a client-side
 * navigation to a download either does nothing or leaves the router in a state
 * it cannot render, and prefetching would pull every attachment on the page
 * through the origin before anybody asked for one.
 *
 * The `download` attribute is left off on purpose too: the server already sets
 * the disposition and the filename, including the RFC 5987 form for a name that
 * is not ASCII. `download` here would let the browser use its own guess for the
 * name instead.
 */

export interface AttachmentListProps {
  attachments: readonly FeedbackAttachmentRow[];
  /** `/api/school/feedback/attachments` or the platform equivalent. */
  downloadBase: string;
}

export function AttachmentList({ attachments, downloadBase }: AttachmentListProps) {
  if (attachments.length === 0) {
    return <p className="text-sm text-ink-muted">No files were attached.</p>;
  }

  return (
    <ul className="space-y-2">
      {attachments.map((file) => (
        <li key={file.id}>
          <a
            href={`${downloadBase}/${file.id}`}
            className="flex items-center gap-3 rounded-control border border-line bg-surface-sunken px-3 py-2 transition-colors duration-fast hover:border-brand-primary hover:bg-surface-hover"
          >
            <Icon
              as={file.contentType === 'application/pdf' ? FileText : ImageGlyph}
              size="md"
              className="text-ink-muted"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">
                {file.fileName}
              </span>
              <span className="block text-xs text-ink-muted">
                {formatBytes(file.sizeBytes)} · downloads
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}
