import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/student/calendar`.
 *
 * The page reads the school's holidays on the server, so it is dynamic and
 * required to have one — see CLAUDE.md, and `npm run check-loaders`.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable rows={8} columns={3} />
    </div>
  );
}
