import {
  Skeleton,
  SkeletonStatTiles,
  SkeletonTable,
} from '@/components/ui/Skeleton';

/**
 * Shown while a school administration route's server component is fetching.
 *
 * Route-level rather than per-screen: this catches every page in the group,
 * including the ones nobody has got round to giving a bespoke skeleton. The
 * shape is the shape most screens in this product actually have — a heading, a
 * row of figures, a table — so it is a reasonable stand-in even where it is not
 * exact, and far better than the blank white gap that was here before.
 *
 * Deliberately not a spinner. A spinner says something is happening; a skeleton
 * says what is arriving and where, which stops the layout jumping when it does.
 */
export default function Loading() {
  return (
    <div>
      <div className="mb-6">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-3 h-7 w-64" />
      </div>

      <SkeletonStatTiles />

      <SkeletonTable className="mt-6" rows={6} columns={5} />
    </div>
  );
}
