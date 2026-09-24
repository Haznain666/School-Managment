import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/** Loading state for `/super-admin/billing` — a list screen. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader action />
      <SkeletonTable rows={8} columns={7} />
    </div>
  );
}
