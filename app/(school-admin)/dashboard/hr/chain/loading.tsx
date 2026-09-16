import { SkeletonForm, SkeletonPageHeader } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/hr/chain`.
 *
 * A picker above a multi-select, so the form shape is the one it is waiting
 * for. Required on every data-fetching route in this app; `npm run
 * check-loaders` fails the build without it.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonForm fields={3} columns={1} />
    </div>
  );
}
