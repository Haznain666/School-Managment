import type { BadgeVariant } from '@/components/ui/Badge';
import type { InvoiceDisplayStatus } from '@/lib/platform-billing';

/**
 * The colour of each invoice chip, in one place so the Billing tab, the
 * invoice list and the invoice itself cannot disagree about what "Overdue"
 * looks like. Five chips, and no "partial" (E6).
 */
export const INVOICE_BADGE: Record<InvoiceDisplayStatus, BadgeVariant> = {
  draft: 'neutral',
  due: 'info',
  overdue: 'danger',
  paid: 'success',
  carried_forward: 'warning',
};
