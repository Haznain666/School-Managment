import { SkeletonDetail, SkeletonPageHeader } from '@/components/ui/Skeleton';

/** Loading state for one platform invoice — a record. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonDetail rows={10} />
    </div>
  );
}
