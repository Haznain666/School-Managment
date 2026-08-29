'use client';

import { FileImage, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  DOCUMENT_UPLOAD_HINT,
  MAX_STUDENT_DOCUMENTS,
  documentTitleProblem,
} from '@/db/schema/student-documents';
import { withSchoolParam } from '@/lib/school-client';

/**
 * Student documents on the profile — Sprint 19b, item 16c.
 *
 * ── One chip per document, and a chip is a link ─────────────────────────
 * Not a table. A school holds six of these and the only question anybody asks
 * of the list is "have we got her B-Form" — which a row of titles answers at a
 * glance and a table with size, type and upload date columns buries. Opening
 * one is the second question and it is a click on the title.
 *
 * `target="_blank" rel="noopener"`, because the document is a *reference* the
 * operator is checking against the record they are already looking at. Opening
 * it in place would mean losing the profile and coming back with the browser's
 * back button, and the whole reason to open it is to compare.
 *
 * ── Add is inline, not a page ───────────────────────────────────────────
 * The missing document is discovered here, while the record is on screen, and a
 * navigation to a dedicated upload page would take away the very thing the
 * operator is reading. Two fields and a button is the whole form.
 *
 * ── Pending state, because this fetches after mount ─────────────────────
 * CLAUDE.md: `loading.tsx` covers the server render, and everything a client
 * component fetches afterwards carries its own visible pending state. Uploading
 * a 4 MB photograph over a school's connection is several seconds, and a button
 * that does nothing visible for several seconds gets pressed again.
 */

export interface StudentDocumentChip {
  id: string;
  title: string;
  downloadUrl: string;
}

export interface StudentDocumentsCardProps {
  studentProfileId: string;
  documents: readonly StudentDocumentChip[];
  /** `students.update`. Adding and removing; seeing needs only `students.read`. */
  canEdit: boolean;
}

export function StudentDocumentsCard({
  studentProfileId,
  documents,
  canEdit,
}: StudentDocumentsCardProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const full = documents.length >= MAX_STUDENT_DOCUMENTS;

  const reset = (): void => {
    setTitle('');
    setFile(null);
    setAdding(false);
    // The held `File` lives in state, but the control keeps showing the file
    // name until it is cleared — so a second upload starts with the first
    // document's name under it, which reads as a form that did not submit.
    if (fileInput.current !== null) fileInput.current.value = '';
  };

  const upload = async (): Promise<void> => {
    const problem = documentTitleProblem(title);
    if (problem !== null) {
      setError(problem);
      return;
    }
    if (file === null) {
      setError('Choose a PNG or JPG to upload.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const form = new FormData();
      form.append('title', title);
      form.append('file', file);

      const response = await fetch(
        withSchoolParam(`/api/school/students/${studentProfileId}/documents`),
        { method: 'POST', body: form },
      );

      if (!response.ok) {
        /*
         * The message is read out of the body, always.
         *
         * A 413 and a 415 here are the two things that actually happen — a
         * photograph straight off a phone, and a PDF — and each carries a
         * sentence saying what to do about it. Collapsing them into "the upload
         * failed" is the defect the enrollment wizard's photo upload shipped
         * with, and it cost a student a photograph nobody was ever told about.
         */
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;

        setError(
          payload?.error?.message ??
            `The document could not be uploaded (HTTP ${response.status}).`,
        );
        return;
      }

      reset();
      router.refresh();
    } catch {
      setError('The document could not be uploaded.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (documentId: string, documentTitle: string): Promise<void> => {
    // A document is a scan somebody had to walk to a cabinet for. Deleting one
    // is cheap to do and expensive to undo, so it is asked about first.
    if (!window.confirm(`Delete “${documentTitle}”? This cannot be undone.`)) return;

    setRemovingId(documentId);
    setError(null);

    try {
      const response = await fetch(
        withSchoolParam(
          `/api/school/students/${studentProfileId}/documents/${documentId}`,
        ),
        { method: 'DELETE' },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(payload?.error?.message ?? 'Could not delete that document.');
        return;
      }

      router.refresh();
    } catch {
      setError('Could not delete that document.');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card
      header={
        <CardTitle
          title="Student documents"
          description="Scans the school keeps on file. Each one opens in a new tab."
          action={
            canEdit && !adding && !full ? (
              <Button
                size="sm"
                variant="secondary"
                icon={Plus}
                onClick={() => {
                  setAdding(true);
                  setError(null);
                }}
              >
                Add document
              </Button>
            ) : null
          }
        />
      }
    >
      {documents.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing on file yet.
          {canEdit
            ? ' A B-Form, a birth certificate or a leaving certificate is what most schools keep here.'
            : ''}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {documents.map((document) => (
            <li key={document.id}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken py-1 pl-3 pr-1.5 text-sm">
                <FileImage className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
                <a
                  href={document.downloadUrl}
                  target="_blank"
                  rel="noopener"
                  className="font-medium text-brand-primary hover:underline"
                >
                  {document.title}
                </a>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Delete ${document.title}`}
                    disabled={removingId === document.id}
                    className="rounded-full p-1 text-ink-muted hover:bg-surface-raised hover:text-status-danger-ink disabled:opacity-50"
                    onClick={() => {
                      void remove(document.id, document.title);
                    }}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : (
                  <span className="pr-1.5" />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {full && canEdit ? (
        <p className="mt-3 text-xs text-ink-muted">
          This student has the maximum of {MAX_STUDENT_DOCUMENTS} documents.
          Remove one before adding another.
        </p>
      ) : null}

      {adding ? (
        <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
          <Input
            label="Title"
            placeholder="e.g. B-Form"
            value={title}
            disabled={busy}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">File</label>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              disabled={busy}
              className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-sunken file:px-3 file:py-2 file:text-sm file:font-medium"
              onChange={(event) => {
                // Only ever sets — cancelling a native dialog fires `change`
                // with an empty list on some platforms.
                const chosen = event.target.files?.[0];
                if (chosen !== undefined) setFile(chosen);
              }}
            />
            <p className="mt-1.5 text-xs text-ink-muted">{DOCUMENT_UPLOAD_HINT}</p>
          </div>

          <div className="flex gap-3 sm:col-span-2">
            <Button
              size="sm"
              isLoading={busy}
              onClick={() => {
                void upload();
              }}
            >
              Upload
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error !== null ? (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}
    </Card>
  );
}
