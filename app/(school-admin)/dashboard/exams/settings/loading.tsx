import { SkeletonForm, SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/exams/settings`.
 *
 * Next.js renders this the moment the route is entered and swaps in the page
 * when its server component has finished fetching. It is what stands between a
 * click and the data on a deployment whose origin was measured at ~1s per
 * uncached request, and it is required on every data-fetching route in this
 * app — `npm run check-loaders` fails the build without it.
 *
 * The shape mirrors the page: the add-a-descriptor row, the list of them, and
 * the two switches underneath.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader action />
      <SkeletonForm fields={4} columns={2} />
      <SkeletonTable className="mt-6" rows={4} columns={2} />
    </div>
  );
}
