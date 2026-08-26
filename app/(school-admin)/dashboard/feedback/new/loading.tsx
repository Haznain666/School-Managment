import { SkeletonForm, SkeletonPageHeader } from '@/components/ui/Skeleton';

/** Loading state for the feedback form. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonForm fields={4} columns={1} />
    </div>
  );
}
