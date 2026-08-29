import { SkeletonDetail, SkeletonPageHeader } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/branches/[branchId]`.
 *
 * Next.js renders this the moment the route is entered and swaps in the page
 * when its server component has finished fetching. It is what stands between a
 * click and the data on a deployment whose origin was measured at ~1s per
 * uncached request, and it is required on every data-fetching route in this
 * app — `npm run check-loaders` fails the build without it.
 *
 * `SkeletonDetail`, because this is one record: eleven labelled facts about one
 * campus. A table shape here would promise rows that never arrive.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader action />
      <SkeletonDetail rows={11} />
    </div>
  );
}
