import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/admissions/students/[studentId]/history`.
 *
 * Next.js renders this the moment the route is entered and swaps in the page
 * when its server component has finished fetching. It is what stands between a
 * click and the data on a deployment whose origin was measured at ~1s per
 * uncached request, and it is required on every data-fetching route in this
 * app — `npm run check-loaders` fails the build without it.
 *
 * The shape mirrors the page it stands in for: a header and one table of exam
 * rows. Seven columns, because that is what the table has — a skeleton that is
 * the wrong shape is worse than none, since it promises a layout that then
 * jumps.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable rows={6} columns={7} />
    </div>
  );
}
