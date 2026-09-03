import { SkeletonChat, SkeletonPageHeader } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <SkeletonChat />
    </div>
  );
}
