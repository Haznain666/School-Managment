import {
  SkeletonPageHeader,
  SkeletonStatTiles,
  SkeletonTable,
} from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/accounting`.
 *
 * Four tiles and a table, which is what the page is. Required on every
 * data-fetching route in this app — `npm run check-loaders` fails the build
 * without it — and it is what stands between the click and a ~1s uncached
 * request on the live origin.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonStatTiles />
      <SkeletonTable className="mt-6" rows={8} columns={4} />
    </div>
  );
}
