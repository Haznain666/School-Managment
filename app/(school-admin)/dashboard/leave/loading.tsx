import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/leave`.
 *
 * A list screen, so the shape is the table it is waiting for. Required on
 * every data-fetching route in this app; `npm run check-loaders` fails the
 * build without it.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable rows={8} columns={6} />
    </div>
  );
}
