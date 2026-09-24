import { SkeletonDetail, SkeletonPageHeader } from '@/components/ui/Skeleton';

/**
 * Loading state for `/handoff/[token]` — the school's branded frame is read
 * before the redemption starts.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <SkeletonPageHeader />
      <SkeletonDetail rows={2} />
    </div>
  );
}
