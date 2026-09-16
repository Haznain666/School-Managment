import { SkeletonForm, SkeletonPageHeader } from '@/components/ui/Skeleton';

/**
 * Loading state for `/teacher/leave`.
 *
 * The shape changed with the page. It was a list and is now a form above a
 * list, so the skeleton is a form — a table shape here would promise a layout
 * that then jumps, which is worse than no skeleton at all.
 *
 * Required on every data-fetching route in this app; `npm run check-loaders`
 * fails the build without it.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonForm fields={5} />
    </div>
  );
}
