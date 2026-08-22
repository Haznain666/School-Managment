import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/exams/criteria`.
 *
 * Next.js renders this the moment the route is entered and swaps in the page
 * when its server component has finished fetching. It is what stands between a
 * click and the data on a deployment whose origin was measured at ~1s per
 * uncached request, and it is required on every data-fetching route in this
 * app — `npm run check-loaders` fails the build without it.
 *
 * One row per class, which is exactly what arrives.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader action />
      <SkeletonTable rows={8} columns={3} />
    </div>
  );
}
