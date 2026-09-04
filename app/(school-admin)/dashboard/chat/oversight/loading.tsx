import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <SkeletonTable rows={6} columns={3} />
    </div>
  );
}
