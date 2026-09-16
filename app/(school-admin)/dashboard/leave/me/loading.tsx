import { SkeletonForm, SkeletonPageHeader } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/leave/me`.
 *
 * A form above a list, so the shape is the form. Required on every
 * data-fetching route in this app; `npm run check-loaders` fails the build
 * without it.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonForm fields={5} />
    </div>
  );
}
