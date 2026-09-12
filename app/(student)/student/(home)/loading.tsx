import {
  SkeletonChart,
  SkeletonPageHeader,
  SkeletonStatTiles,
  SkeletonTable,
} from '@/components/ui/Skeleton';

/**
 * Loading state for `/student`.
 *
 * Next.js renders this the moment the route is entered and swaps in the page
 * when its server component has finished fetching. It is what stands between a
 * click and the data on a deployment whose origin was measured at ~1s per
 * uncached request, and it is required on every data-fetching route in this
 * app — `npm run check-loaders` fails the build without it.
 *
 * The shape mirrors the page it stands in for. A skeleton that is the wrong
 * shape is worse than none: it promises a layout that then jumps.
 *
 * ── Why it lives in the `(home)` route group ─────────────────────────────
 * A `loading.tsx` is a Suspense boundary for its segment *and every segment
 * below it*. Beside `app/(student)/student/page.tsx` it wrapped all of
 * `/student/*`, so a hard load of `/student/results` streamed this skeleton
 * first — stat tiles, two charts and a table — then that route's own
 * skeleton nested inside it: the wrong shape, and two streamed boundaries
 * where one was needed. The group changes no URL; it only stops this
 * boundary reaching its siblings. STATE.md §5bz.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonStatTiles />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SkeletonChart />
        <SkeletonChart />
      </div>
      <SkeletonTable className="mt-6" rows={6} columns={5} />
    </div>
  );
}
