import { SkeletonForm, SkeletonPageHeader } from '@/components/ui/Skeleton';

/** Loading state for the platform bank accounts — three short records and a form. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonForm fields={6} columns={2} />
    </div>
  );
}
