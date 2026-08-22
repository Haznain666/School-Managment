import { SkeletonForm, SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/exams/terms/[termId]`.
 *
 * Next.js renders this the moment the route is entered and swaps in the page
 * when its server component has finished fetching. It is what stands between a
 * click and the data on a deployment whose origin was measured at ~1s per
 * uncached request, and it is required on every data-fetching route in this
 * app — `npm run check-loaders` fails the build without it.
 *
 * A form above a list, because that is what a datesheet screen is: the editor
 * for one, and the term's other datesheets beneath it.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader action />
      <SkeletonForm fields={4} columns={2} />
      <SkeletonTable className="mt-6" rows={4} columns={4} />
    </div>
  );
}
