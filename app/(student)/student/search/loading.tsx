import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for the search results page.
 *
 * A search runs several ILIKE sweeps and the reader has just pressed Enter, so
 * this is exactly the wait `check-loaders` exists for. The shape is a heading
 * and two grouped lists, which is what arrives.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <SkeletonPageHeader />
      <SkeletonTable rows={4} columns={3} />
      <SkeletonTable rows={3} columns={3} />
    </div>
  );
}
