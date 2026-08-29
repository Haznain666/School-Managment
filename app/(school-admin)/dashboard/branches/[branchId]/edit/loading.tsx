import { SkeletonForm, SkeletonPageHeader } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/branches/[branchId]/edit`.
 *
 * Next.js renders this the moment the route is entered and swaps in the page
 * when its server component has finished fetching. It is what stands between a
 * click and the data on a deployment whose origin was measured at ~1s per
 * uncached request, and it is required on every data-fetching route in this
 * app — `npm run check-loaders` fails the build without it.
 *
 * Eight fields, matching the campus form with its two lead toggles hidden —
 * which is what an edit renders. A skeleton that is the wrong shape is worse
 * than none: it promises a layout that then jumps.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonForm fields={8} />
    </div>
  );
}
