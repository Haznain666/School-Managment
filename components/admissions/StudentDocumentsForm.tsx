'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  DOCUMENT_UPLOAD_HINT,
  MAX_DOCUMENT_BYTES,
  MAX_STUDENT_DOCUMENTS,
} from '@/db/schema/student-documents';

/**
 * The Documents step of an enrollment — Sprint 19b, item 16b.
 *
 * ── Entirely skippable, and that is the design ──────────────────────────
 * An admissions desk with a queue in front of it must never be blocked by a
 * birth certificate that is at home. CLAUDE.md's rule about the CNIC — "blank
 * is always allowed", because a required field produces an invented answer
 * rather than a document — applies here in its most literal form: a required
 * upload produces a photograph of a blank sheet, filed as a B-Form.
 *
 * So there is no validation to fail. A step with no rows continues; a row with
 * a file and no title continues too, and is simply not sent.
 *
 * ── The files are held, not uploaded, until the student exists ──────────
 * Every document's storage path is keyed by `student_profiles.id`, which does
 * not exist until the enrollment lands. The wizard therefore carries `File`
 * objects through the step and uploads them afterwards, exactly as it already
 * does for the photo — and, exactly as the photo does, a failed upload must not
 * undo an enrollment that has landed. The profile page's own Add document is
 * where a missed one gets added.
 *
 * ── The rows re-render their own held files ─────────────────────────────
 * The wizard renders its steps conditionally, so every `<input type="file">`
 * here is unmounted and remounted **empty** whenever the operator steps away
 * and back. The `File` survives in state; the file name beside the button does
 * not, which is the only thing anybody looks at. Rendering the held file is the
 * fix, and it is the same defect the photo field records at length.
 */

/** One document as the wizard holds it, before the student exists. */
export interface DocumentDraft {
  title: string;
  file: File | null;
}

export function emptyDocument(): DocumentDraft {
  return { title: '', file: null };
}

/** The drafts that are actually worth uploading: a file *and* a title. */
export function uploadableDocuments(
  drafts: readonly DocumentDraft[],
): Array<{ title: string; file: File }> {
  return drafts.flatMap((draft) =>
    draft.file === null || draft.title.trim() === ''
      ? []
      : [{ title: draft.title.trim(), file: draft.file }],
  );
}

export interface StudentDocumentsFormProps {
  documents: readonly DocumentDraft[];
  onChange: (documents: DocumentDraft[]) => void;
  disabled?: boolean;
}

export function StudentDocumentsForm({
  documents,
  onChange,
  disabled = false,
}: StudentDocumentsFormProps) {
  const update = (index: number, patch: Partial<DocumentDraft>): void => {
    onChange(
      documents.map((document, position) =>
        position === index ? { ...document, ...patch } : document,
      ),
    );
  };

  const remove = (index: number): void => {
    onChange(documents.filter((_, position) => position !== index));
  };

  const oversized = documents.some(
    (document) => document.file !== null && document.file.size > MAX_DOCUMENT_BYTES,
  );

  return (
    <Card
      header={
        <CardTitle
          title="Documents"
          description="Optional. Anything the school keeps on file — a B-Form, a birth certificate, the last school's leaving certificate."
        />
      }
    >
      {documents.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing attached. You can add documents now or from the student&rsquo;s
          profile at any time — an enrollment is never held up for paperwork.
        </p>
      ) : (
        <ul className="space-y-4">
          {documents.map((document, index) => (
            <li key={index} className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Title"
                  placeholder="e.g. B-Form"
                  value={document.title}
                  disabled={disabled}
                  onChange={(event) => {
                    update(index, { title: event.target.value });
                  }}
                />

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink">
                    File
                  </label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    disabled={disabled}
                    className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-sunken file:px-3 file:py-2 file:text-sm file:font-medium"
                    onChange={(event) => {
                      /*
                        Only ever *sets*, never nulls — the same rule the photo
                        field carries. Cancelling a native file dialog fires
                        `change` with an empty `FileList` on some platforms, and
                        reading that as "removed" silently discards a selection
                        made a minute earlier. Removing is the button below.
                      */
                      const file = event.target.files?.[0];
                      if (file !== undefined) update(index, { file });
                    }}
                  />
                  <HeldFile file={document.file} />
                </div>
              </div>

              <div className="sm:self-end sm:pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    remove(index);
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {oversized ? (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle"
        >
          One of these is larger than 5 MB and will not be uploaded. Photograph
          it again at a lower resolution, or leave it and add it from the profile
          later.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {documents.length < MAX_STUDENT_DOCUMENTS ? (
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              onChange([...documents, emptyDocument()]);
            }}
          >
            {documents.length === 0 ? 'Add a document' : 'Add another'}
          </Button>
        ) : (
          <p className="text-sm text-ink-muted">
            Up to {MAX_STUDENT_DOCUMENTS} documents per student.
          </p>
        )}
        <p className="text-xs text-ink-muted">{DOCUMENT_UPLOAD_HINT}</p>
      </div>
    </Card>
  );
}

/**
 * A thumbnail of the file this row is actually holding.
 *
 * The object URL is revoked on change and on unmount, because each one pins the
 * file's bytes in memory until it is — ten held certificates is otherwise ten
 * multi-megabyte buffers the tab cannot release.
 */
function HeldFile({ file }: { file: File | null }) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (file === null) {
      setPreview(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreview(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  if (file === null) {
    return (
      <p className="mt-1.5 text-xs text-ink-muted">
        Uploaded once the student record has been created.
      </p>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-3">
      {preview === null ? null : (
        // An object URL for a File the browser already holds. `next/image`
        // cannot help: it would have to fetch and optimise a `blob:` URL that
        // exists only in this tab.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt={`Selected document: ${file.name}`}
          className="h-12 w-12 rounded-lg object-cover"
        />
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-ink">{file.name}</p>
        <p className="text-xs text-ink-muted">{(file.size / 1024).toFixed(0)} KB</p>
      </div>
    </div>
  );
}
