import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/** Loading state for `/dashboard/accounting/accounts` — a header and a list. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable className="mt-6" rows={12} columns={5} />
    </div>
  );
}
