import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/exams/promotions`.
 *
 * Required on every data-fetching route — `npm run check-loaders` fails the
 * build without it, and the origin was measured at ~1s per uncached request.
 *
 * One row per child, matching the class list that arrives. The same shape as
 * the teacher's own promotions loader, because it is the same sheet.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader action />
      <SkeletonTable rows={10} columns={3} />
    </div>
  );
}
