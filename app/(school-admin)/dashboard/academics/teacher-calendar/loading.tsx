import { SkeletonForm, SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/academics/teacher-calendar`.
 *
 * The page reads the teacher list on the server, so it waits — and on a
 * deployment whose origin was measured at ~1s per uncached request, this is
 * what stands between the click and the screen. `npm run check-loaders` fails
 * the build without it.
 *
 * Two shapes because the page has two: a row of selectors, then the calendar
 * itself. The week view is the default, and it is a list of days with periods
 * under each — a table skeleton is the closest shape that exists, and it is
 * close enough not to jump. `SkeletonForm` takes one or two columns, so the
 * three selectors are drawn as two; a third column is not worth a sixth shape.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonForm fields={3} columns={2} />
      <SkeletonTable rows={7} columns={3} />
    </div>
  );
}
