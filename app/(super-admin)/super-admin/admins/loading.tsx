import { SkeletonPageHeader, SkeletonTable } from '@/components/ui/Skeleton';

/** Loading state for `/super-admin/admins` — a short list. */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader action />
      <SkeletonTable rows={4} columns={3} />
    </div>
  );
}
