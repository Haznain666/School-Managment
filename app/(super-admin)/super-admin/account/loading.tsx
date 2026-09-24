import { SkeletonForm, SkeletonPageHeader } from '@/components/ui/Skeleton';

/** Loading state for "My account" — a short record and a password form. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonForm fields={3} columns={1} />
    </div>
  );
}
