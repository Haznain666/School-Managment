'use client';

import { Button } from '@/components/ui/Button';

/**
 * Opens the browser's print dialog.
 *
 * Deliberately a button rather than an automatic `useEffect` print-on-load:
 * a dialog that appears before the page has painted gives the user no chance
 * to check they are printing the right batch, and printing four hundred
 * vouchers by accident wastes a school's afternoon and its toner.
 *
 * Hidden from the printed output itself — see `print:hidden`.
 */
export function PrintNow({
  className,
  label = 'Print',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <Button
      type="button"
      className={className}
      onClick={() => {
        window.print();
      }}
    >
      {label}
    </Button>
  );
}
