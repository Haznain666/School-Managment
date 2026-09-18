'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/Button';
import {
  ChallanPrintView,
  type ChallanPrintData,
} from '@/components/fees/ChallanPrintView';

/**
 * Which fee document reaches the paper. Sprint 33c, C2.
 *
 * ── The trap this exists for ─────────────────────────────────────────────
 * A `PrintSheet` is hidden on screen and revealed by `@media print`. So the
 * moment a page holds **two** of them — a voucher and a receipt — Ctrl+P puts
 * both on the paper, and a parent walks into a bank with a demand stapled to a
 * receipt for the same money. Two buttons each calling `window.print()` would
 * not help: the browser prints the document, not the button.
 *
 * So exactly one sheet is mounted at a time and the buttons choose which. That
 * also makes Ctrl+P correct without anybody pressing anything: whatever is
 * chosen is what is on the paper, which is the only rule a reader can hold.
 *
 * ── Why three exports rather than one component ──────────────────────────
 * Because of where each half has to sit. The page's whole screen tree carries
 * `print:hidden`, which is `display: none` at print time — and a `display:
 * none` ancestor defeats the `visibility: visible` that `[data-print-root]`
 * relies on, so a sheet inside it prints **blank**. `STATE.md` §5bd records
 * that exact failure costing a sprint. The buttons therefore belong inside the
 * screen tree, beside the other actions, and the sheet belongs outside it; the
 * provider is what lets the two agree.
 *
 * ── `print()` is fired from an effect, not from the click ────────────────
 * The click sets the state; the effect runs after React has committed the new
 * sheet to the DOM. Calling `window.print()` inside the handler would print the
 * *previous* document, which is the same defect in a more confusing costume.
 * The ref is what stops it firing on the first render, when nothing has been
 * asked for.
 *
 * ── Why the default is the voucher ───────────────────────────────────────
 * On an open bill the voucher is what the page is for, and a reader pressing
 * Ctrl+P out of habit gets exactly what they got before Sprint 33c. On a
 * settled one there is no voucher to offer — Sprint 20's decision, which
 * stands — so the receipt is the only document and is mounted from the start.
 */

type FeeDocument = 'voucher' | 'receipt';

interface PrintChoice {
  voucher: ChallanPrintData | null;
  receipt: ChallanPrintData | null;
  active: FeeDocument | null;
  choose: (document: FeeDocument) => void;
}

const ChoiceContext = createContext<PrintChoice | null>(null);

function useChoice(): PrintChoice {
  const value = useContext(ChoiceContext);
  if (value === null) {
    throw new Error(
      'ChallanPrintButtons and ChallanPrintSheet must be inside a ChallanPrintProvider',
    );
  }
  return value;
}

export function ChallanPrintProvider({
  voucher,
  receipt,
  children,
}: {
  /** The demand. Null once the voucher is settled, cancelled or waived. */
  voucher: ChallanPrintData | null;
  /** The record of what was taken. Null until something has been. */
  receipt: ChallanPrintData | null;
  children: ReactNode;
}) {
  const [active, setActive] = useState<FeeDocument | null>(
    voucher !== null ? 'voucher' : receipt !== null ? 'receipt' : null,
  );
  const printOnCommit = useRef(false);

  useEffect(() => {
    if (!printOnCommit.current) return;
    printOnCommit.current = false;
    window.print();
  }, [active]);

  const value = useMemo<PrintChoice>(
    () => ({
      voucher,
      receipt,
      active,
      choose: (document) => {
        if (active === document) {
          // Already mounted, so no commit is coming and the effect above will
          // never run. Print it now.
          window.print();
          return;
        }
        printOnCommit.current = true;
        setActive(document);
      },
    }),
    [voucher, receipt, active],
  );

  return <ChoiceContext.Provider value={value}>{children}</ChoiceContext.Provider>;
}

/** The buttons. Goes wherever the page's other actions are. */
export function ChallanPrintButtons({ hint = null }: { hint?: string | null }) {
  const { voucher, receipt, choose } = useChoice();

  if (voucher === null && receipt === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {voucher === null ? null : (
        <Button
          variant="secondary"
          onClick={() => {
            choose('voucher');
          }}
        >
          {/*
            Named, not "Print". The two documents are about the same money
            pointing in opposite directions, and a button that does not say
            which is the one somebody presses twice.
          */}
          Print voucher
        </Button>
      )}

      {receipt === null ? null : (
        <Button
          variant="secondary"
          onClick={() => {
            choose('receipt');
          }}
        >
          Print receipt
        </Button>
      )}

      {hint === null || hint === '' ? null : (
        <p className="text-sm text-ink-muted">{hint}</p>
      )}
    </div>
  );
}

/**
 * The document. Goes **outside** anything carrying `print:hidden`.
 *
 * Exactly one sheet, ever. See the provider's docblock for why that is the
 * whole point of this file.
 */
export function ChallanPrintSheet() {
  const { voucher, receipt, active } = useChoice();

  if (active === 'voucher' && voucher !== null) return <ChallanPrintView data={voucher} />;
  if (active === 'receipt' && receipt !== null) return <ChallanPrintView data={receipt} />;
  return null;
}
