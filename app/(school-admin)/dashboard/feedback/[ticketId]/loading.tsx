import { SkeletonDetail, SkeletonPageHeader } from '@/components/ui/Skeleton';

/** Loading state for one feedback ticket. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonDetail rows={6} />
    </div>
  );
}
