import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/** Loading state for `/dashboard/accounting/categories`. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable className="mt-6" rows={10} columns={4} />
    </div>
  );
}
