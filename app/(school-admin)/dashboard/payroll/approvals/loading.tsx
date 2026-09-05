import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/payroll/approvals`.
 *
 * The page resolves the caller's `school_users` row and the runs waiting on
 * them on the server, so it is dynamic and required to have one —
 * `npm run check-loaders` fails the build without it.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable rows={4} columns={3} />
    </div>
  );
}
