import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/teacher/calendar`.
 *
 * The page reads the holidays and this teacher's Saturday duty on the server,
 * so it is dynamic and required to have one — see CLAUDE.md, and
 * `npm run check-loaders`, which fails the build without it.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonTable rows={8} columns={3} />
    </div>
  );
}
