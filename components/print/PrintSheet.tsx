/**
 * The print framework.
 *
 * Every printable document in the app — fee vouchers today, receipts, ID cards,
 * certificates and marksheets later — renders inside one of these. It owns the
 * three things each of those would otherwise reinvent:
 *
 *   1. Hiding the portal shell so only the document reaches the paper.
 *   2. The page size and margins, which differ per document: a fee voucher is
 *      A4, a counter receipt is an 80mm till roll.
 *   3. Page-break behaviour, so a document is never sliced across two sheets.
 *
 * ── Why the browser rather than a PDF library ────────────────────────────
 * No PDF dependency is involved: the browser's own print dialog is the
 * renderer, and "Save as PDF" is built into it. That matters for where this
 * deploys — Hostinger runs a plain Node process on shared infrastructure, where
 * a headless Chromium (what Puppeteer-style PDF generation needs) is unreliable
 * at best and unavailable at worst. One less dependency between a school and
 * its money.
 *
 * ── Screen vs paper ──────────────────────────────────────────────────────
 * The sheet is `hidden` on screen and revealed only by the `@media print`
 * rules in `globals.css`, which key off `[data-print-root]`. That is why this
 * component can sit inside an ordinary page: it costs nothing visually until
 * someone prints.
 */

/** Paper the document is designed for. */
export type PrintPaper = 'a4' | 'a4-landscape' | 'thermal80';

/**
 * `@page` cannot be scoped by selector or attribute — it is per-document. So
 * the chosen size is injected as a real style rule rather than a class.
 */
const PAGE_RULES: Record<PrintPaper, string> = {
  a4: '@page { size: A4 portrait; margin: 8mm; }',
  'a4-landscape': '@page { size: A4 landscape; margin: 8mm; }',
  // Till rolls have no bottom edge — height auto lets the receipt end where the
  // content does instead of feeding a fixed sheet's worth of blank paper.
  thermal80: '@page { size: 80mm auto; margin: 3mm; }',
};

export function PrintSheet({
  paper = 'a4',
  children,
}: {
  paper?: PrintPaper;
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Fixed strings from the record above; nothing caller-supplied is
          interpolated, so there is no injection surface here. */}
      <style dangerouslySetInnerHTML={{ __html: PAGE_RULES[paper] }} />
      <div data-print-root="" className="hidden bg-white text-black">
        {children}
      </div>
    </>
  );
}

/**
 * One document within a sheet — a single voucher, receipt or certificate.
 *
 * Keeps itself off a page boundary, and starts a new sheet after itself when
 * `breakAfter` is set. Bulk printing uses that: four hundred vouchers, one per
 * sheet, in a single print job.
 */
export function PrintDocument({
  breakAfter = false,
  children,
}: {
  breakAfter?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`print-document${breakAfter ? ' print-break-after' : ''}`}>
      {children}
    </div>
  );
}

/**
 * The masthead every branded document shares.
 *
 * The logo is deliberately optional and never blocks: a school that has not
 * uploaded one still gets a correctly laid-out voucher with its name in place
 * of the mark. A missing image must not cost a parent their fee slip.
 *
 * A plain `<img>` rather than `next/image` — the print renderer wants a real
 * resolved URL, not a lazy-loading, srcset-driven component that may not have
 * settled by the time the print dialog opens.
 */
export function PrintLetterhead({
  logoUrl,
  schoolName,
  branchName,
  address,
  phone,
  right,
}: {
  logoUrl: string | null;
  schoolName: string;
  branchName?: string | null;
  address?: string | null;
  phone?: string | null;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-black pb-1.5">
      <div className="flex items-start gap-2">
        {logoUrl === null || logoUrl === '' ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- see docblock.
          <img
            src={logoUrl}
            alt=""
            className="h-10 w-10 shrink-0 object-contain"
          />
        )}

        <div>
          <p className="text-sm font-bold uppercase">{schoolName}</p>
          {branchName === null || branchName === undefined ? null : (
            <p className="text-[9px]">{branchName}</p>
          )}
          {address === null || address === undefined ? null : (
            <p className="text-[9px]">{address}</p>
          )}
          {phone === null || phone === undefined ? null : (
            <p className="text-[9px]">Tel: {phone}</p>
          )}
        </div>
      </div>

      {right === undefined ? null : <div className="text-right">{right}</div>}
    </header>
  );
}
