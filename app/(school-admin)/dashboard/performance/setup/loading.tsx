import { SkeletonForm, SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/** Loading state for `/dashboard/performance/setup`: the settings form, then the teacher list. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <SkeletonForm fields={4} columns={2} />
      <SkeletonTable rows={6} columns={4} />
    </div>
  );
}
