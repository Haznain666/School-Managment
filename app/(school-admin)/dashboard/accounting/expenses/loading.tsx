import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/** Loading state for `/dashboard/accounting/expenses` — a header and a register. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable className="mt-6" rows={10} columns={7} />
    </div>
  );
}
