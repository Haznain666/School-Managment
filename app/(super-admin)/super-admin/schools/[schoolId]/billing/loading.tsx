import { SkeletonForm, SkeletonPageHeader } from '@/components/ui/Skeleton';

/**
 * Loading state for `/super-admin/schools/[schoolId]/billing`.
 *
 * The tab is a settings form — environment, currencies, trial, grace, then a
 * column of rates — so the form shape is what is arriving.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonForm fields={8} columns={2} />
    </div>
  );
}
