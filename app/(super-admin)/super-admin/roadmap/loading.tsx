import { SkeletonDetail, SkeletonPageHeader } from '@/components/ui/Skeleton';

/**
 * Loading state for the Roadmap tab.
 *
 * The content is static; what is awaited is the `catalogue` permission check
 * (Sprint 35, §9). A header over a record is the shape of the guide.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonDetail rows={8} />
    </div>
  );
}
