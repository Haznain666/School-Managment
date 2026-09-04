import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/parent/calendar`.
 *
 * The page reads the school's holidays on the server, so it is dynamic and
 * required to have one. Measured against the live origin, an uncached request
 * is ~1s — this is what stands in that second on a parent's phone.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable rows={8} columns={3} />
    </div>
  );
}
