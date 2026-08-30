import type { Metadata } from 'next';
import Link from 'next/link';

import { ChallanCopies } from '@/components/fees/ChallanPrintView';
import { PrintSheet } from '@/components/print/PrintSheet';
import { PrintNow } from '@/components/print/PrintNow';
import { Card, CardTitle } from '@/components/ui/Card';
import { MAX_PRINTABLE_CHALLANS } from '@/lib/challan-print';
import { getChallanDetail, getLateFeeRule } from '@/lib/fee-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { getSchoolBranding } from '@/lib/school-tenant';
import { isUuid } from '@/lib/validation';
import { buildVoucherPrintData } from '@/lib/voucher-print-data';

export const metadata: Metadata = {
  title: 'Print vouchers',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Bulk challan printing.
 *
 * ── Why this page exists ─────────────────────────────────────────────────
 * Bulk generation already produced four hundred challans in one action, but
 * printing them meant opening four hundred pages and pressing Ctrl+P on each.
 * The generation half was useless without this half.
 *
 * Takes ids on the query string — `?ids=uuid,uuid,…` — because that is what the
 * challan list already knows after a filter. It deliberately does not re-run
 * the list's filters here: printing must be an exact echo of what the user
 * selected, not a second query that might have drifted between the two.
 *
 * ── The cap ──────────────────────────────────────────────────────────────
 * `MAX_PRINTABLE_CHALLANS` lives in `lib/challan-print.ts` because the challan
 * list enforces the same number client-side, and the two must not drift.
 * Batching the read into a single query is the obvious follow-up when a school
 * outgrows it. Reaching this page over the cap now takes a hand-edited URL —
 * the list will not build one — but it stays checked here regardless, because
 * the client is not a gate.
 */

function parseIds(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];

  // De-duplicated: the same challan twice would print twice, and a parent
  // handed two identical vouchers pays twice or pays neither.
  return [...new Set(raw.split(',').map((id) => id.trim()).filter(isUuid))];
}

export default async function BulkChallanPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  // Same permission as viewing one. Printing discloses nothing a reader of the
  // challan list cannot already see.
  const { locationId } = await requireSchoolPermission('fees.read');
  const { ids: rawIds } = await searchParams;

  const ids = parseIds(rawIds);

  if (ids.length === 0) {
    return (
      <Message title="Nothing selected">
        Choose some vouchers on the{' '}
        <Link href="/dashboard/fees/challans" className="underline">
          vouchers list
        </Link>{' '}
        and print from there.
      </Message>
    );
  }

  if (ids.length > MAX_PRINTABLE_CHALLANS) {
    return (
      <Message title="Too many at once">
        {ids.length} vouchers were selected. Print at most{' '}
        {MAX_PRINTABLE_CHALLANS} in one
        go — larger jobs tend to fail part-way through the browser&apos;s print
        dialog, and a half-printed batch is worse than none. Narrow the filter,
        by class or by section, and print in a few passes.
      </Message>
    );
  }

  const [branding, lateFeeRule, ...challans] = await Promise.all([
    getSchoolBranding(locationId),
    getLateFeeRule(locationId),
    ...ids.map((id) => getChallanDetail(locationId, id)),
  ]);

  // `getChallanDetail` is tenant-scoped, so an id belonging to another school
  // comes back null rather than leaking. Dropping them silently is right: the
  // user asked to print what they can see.
  const found = challans.filter((challan) => challan !== null);

  /*
   * Closed vouchers are dropped, and counted separately — Sprint 20, item 3a.
   *
   * The list will not build a selection containing one; this page is reached by
   * a hand-edited URL as well, and "the client is not a gate" is already this
   * file's own rule about the cap. A paid, cancelled or waived voucher is not a
   * payment instrument, and at a bank counter a printed one is indistinguishable
   * from a live slip.
   */
  const printable = found.filter(
    (challan) => challan.status === 'unpaid' || challan.status === 'partial',
  );
  const closed = found.length - printable.length;

  if (printable.length === 0) {
    return (
      <Message title="Nothing to print">
        {found.length === 0
          ? 'None of those vouchers could be found in this school.'
          : 'Every one of those vouchers is settled, cancelled or waived. A closed voucher is not a payment instrument, so there is nothing to print.'}
      </Message>
    );
  }

  /*
   * One assembled document per voucher, built by the same server helper the
   * detail page uses. Sequential rather than `Promise.all`: each one reads the
   * bank accounts for its own campus, and two hundred of those at once against
   * one pooled connection is how a bulk run times out.
   */
  const documents = [];
  for (const challan of printable) {
    documents.push(
      await buildVoucherPrintData(challan, {
        locationId,
        lateFeeRule,
        logoUrl: branding?.logoUrl ?? null,
      }),
    );
  }

  return (
    <>
      <Card className="print:hidden">
        <CardTitle title="Ready to print" />
        <p className="mt-2 text-sm">
          {printable.length} voucher{printable.length === 1 ? '' : 's'}, one per
          sheet, two copies each — student and school.
          {found.length === ids.length ? null : (
            <> {ids.length - found.length} could not be found and were skipped.</>
          )}
          {closed === 0 ? null : (
            <>
              {' '}
              {closed} {closed === 1 ? 'was' : 'were'} settled, cancelled or
              waived and {closed === 1 ? 'is' : 'are'} not printable.
            </>
          )}
        </p>
        <p className="mt-2 text-sm text-muted">
          In the print dialog choose <strong>A4 landscape</strong> and enable{' '}
          <strong>Background graphics</strong> — without it the table rules and
          cut lines do not appear on the page.
        </p>
        <PrintNow className="mt-4" />
      </Card>

      <PrintSheet paper="a4" orientation="landscape">
        {documents.map((document, index) => (
          <ChallanCopies
            key={document.challanNumber}
            breakAfter={index < documents.length - 1}
            data={document}
          />
        ))}
      </PrintSheet>
    </>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardTitle title={title} />
      <p className="mt-2 text-sm">{children}</p>
    </Card>
  );
}
