import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/** Loading state for `/dashboard/accounting/counters`. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable className="mt-6" rows={6} columns={5} />
    </div>
  );
}
