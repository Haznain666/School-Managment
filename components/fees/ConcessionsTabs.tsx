'use client';

import { ConcessionManager } from '@/components/fees/ConcessionManager';
import {
  ConcessionSchemes,
  type SchemeFeeTypeOption,
} from '@/components/fees/ConcessionSchemes';
import { Tabs } from '@/components/ui/Tabs';

/**
 * Concessions, in the two halves a school actually thinks in.
 *
 * **Schemes** is the policy: the discounts this school offers, named once, with
 * a rate and a window. **Granted** is one child's record: what they hold, and
 * the one-off concession a head grants at a desk that belongs to no policy at
 * all.
 *
 * They were one screen — a student picker and a form — so the only way to
 * express "our sibling discount is 20%" was to type it again per child, and
 * nothing could answer "who is on the staff discount". Schemes leads because it
 * is the thing a school sets up first; Granted is where somebody arrives having
 * been asked about one particular family.
 */
export function ConcessionsTabs({
  feeTypes,
  canEdit,
}: {
  feeTypes: readonly SchemeFeeTypeOption[];
  canEdit: boolean;
}) {
  return (
    <Tabs
      ariaLabel="Concessions"
      items={[
        {
          id: 'schemes',
          label: 'Schemes',
          content: <ConcessionSchemes feeTypes={feeTypes} canEdit={canEdit} />,
        },
        {
          id: 'granted',
          label: 'Granted',
          content: <ConcessionManager feeTypes={feeTypes} canEdit={canEdit} />,
        },
      ]}
    />
  );
}
