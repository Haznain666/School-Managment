import { SkeletonDetail, SkeletonPageHeader } from '@/components/ui/Skeleton';

/**
 * Loading state for `/suspended`.
 *
 * The page reads the session and, for the school administrator, the unpaid
 * invoices and the platform's bank accounts — a header and a record, which is
 * the shape this draws.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <SkeletonPageHeader />
      <SkeletonDetail rows={6} />
    </div>
  );
}
