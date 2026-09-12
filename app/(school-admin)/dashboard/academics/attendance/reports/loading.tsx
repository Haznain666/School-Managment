import { SkeletonChart, SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/academics/attendance/reports`.
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
 * The page is one full-width *Attendance by class* chart — horizontal, a row
 * per class — then the class-and-month report under it. This used to promise
 * stat tiles and two side-by-side charts, which the page has never had.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonChart className="mt-6" orientation="horizontal" legend={false} />
      <SkeletonTable className="mt-6" rows={6} columns={5} />
    </div>
  );
}
