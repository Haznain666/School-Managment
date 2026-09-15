import { SkeletonPageHeader, SkeletonStatTiles, SkeletonTable } from '@/components/ui/Skeleton';

/** Loading state for `/teacher/performance`: two overalls, then the KPIs. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <SkeletonStatTiles count={2} />
      <SkeletonTable rows={5} columns={3} />
    </div>
  );
}
