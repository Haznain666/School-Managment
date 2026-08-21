import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/** Loading state for `/dashboard/accounting/day-book`. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable className="mt-6" rows={12} columns={6} />
    </div>
  );
}
