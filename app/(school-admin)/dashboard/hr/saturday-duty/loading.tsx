import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/hr/saturday-duty`.
 *
 * The page resolves the caller's permission set on the server, so it is dynamic
 * and required to have one — `npm run check-loaders` fails the build without it.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable rows={10} columns={3} />
    </div>
  );
}
