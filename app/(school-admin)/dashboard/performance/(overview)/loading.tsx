import { SkeletonPageHeader, SkeletonStatTiles, SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/performance` — a dashboard shape: tiles, then
 * the staff table.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <SkeletonStatTiles count={4} />
      <SkeletonTable rows={8} columns={6} />
    </div>
  );
}
