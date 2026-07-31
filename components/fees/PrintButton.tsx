'use client';

import { Button } from '@/components/ui/Button';

/**
 * Opens the browser's print dialog.
 *
 * A client island of exactly one button, so the pages that render a challan can
 * stay server components. There is no document to fetch and no PDF to build —
 * the print view is already in the page and `@media print` reveals it.
 */
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button
      variant="secondary"
      onClick={() => {
        window.print();
      }}
    >
      {label}
    </Button>
  );
}
