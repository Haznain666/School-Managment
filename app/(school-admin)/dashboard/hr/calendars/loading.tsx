import { SkeletonForm, SkeletonPageHeader } from '@/components/ui/Skeleton';

/**
 * Loading state for `/dashboard/hr/calendars`.
 *
 * Settings above a form, so the form shape is the one arriving. Required on
 * every data-fetching route in this app; `npm run check-loaders` fails the
 * build without it.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonForm fields={4} />
    </div>
  );
}
