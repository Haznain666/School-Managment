import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/calendar`.
 *
 * The page reads the caller's staff record and their permission set on the
 * server, so it is dynamic and needs this — `npm run check-loaders` fails the
 * build without it.
 *
 * A table shape rather than a grid one: the month grid is drawn by a client
 * component from data it fetches after mount, so what this stands in for is the
 * header and the list beneath it. A skeleton of the wrong shape promises a
 * layout that then jumps.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader action />
      <SkeletonTable rows={8} columns={3} />
    </div>
  );
}
