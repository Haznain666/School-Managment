'use client';

import {
  ChallanTable,
  type AcademicYearOption,
  type GradeOption,
} from '@/components/fees/ChallanTable';
import { FamilyVoucherRegister } from '@/components/fees/FamilyVoucherRegister';
import { Tabs } from '@/components/ui/Tabs';

/**
 * The Vouchers register, in two tabs.
 *
 * ── Why the family vouchers live here ────────────────────────────────────
 * A family voucher is a voucher. It has a number, a due date, a total and a
 * payment, and somebody looking for one comes to the register — which held only
 * per-student vouchers, so the answer to "where is F-0041" was "a different
 * screen, filed under the wizard that made it". The wizard is where one is
 * *created*; this is where every one that exists is listed.
 *
 * `Tabs` rather than `LinkTabs`: both panels are client components that fetch
 * on mount, so switching is local and instant, and putting the choice in the
 * URL would cost a navigation to change a filter.
 */
export function VoucherRegisterTabs({
  academicYears,
  grades,
  canGenerate,
}: {
  academicYears: readonly AcademicYearOption[];
  grades: readonly GradeOption[];
  canGenerate: boolean;
}) {
  return (
    <Tabs
      ariaLabel="Voucher register"
      items={[
        {
          id: 'students',
          label: 'Student vouchers',
          content: (
            <ChallanTable
              academicYears={academicYears}
              grades={grades}
              canGenerate={canGenerate}
            />
          ),
        },
        {
          id: 'family',
          label: 'Family vouchers',
          content: <FamilyVoucherRegister canWrite={canGenerate} />,
        },
      ]}
    />
  );
}
