import { SkeletonForm, SkeletonPageHeader } from '@/components/ui/Skeleton';

/**
 * Loading state for `/apply`.
 *
 * Next.js renders this the moment the route is entered and swaps in the page
 * when its server component has finished fetching. It is what stands between a
 * click and the data on a deployment whose origin was measured at ~1s per
 * uncached request, and it is required on every data-fetching route in this
 * app — `npm run check-loaders` fails the build without it.
 *
 * The shape mirrors the page it stands in for. A skeleton that is the wrong
 * shape is worse than none: it promises a layout that then jumps.
 *
 * ── Why it lives in the `(home)` route group ─────────────────────────────
 * A `loading.tsx` is a Suspense boundary for its segment *and every segment
 * below it*. Beside `app/(public)/apply/page.tsx` it wrapped all of
 * `/apply/*`, so a hard load of `/apply/success` streamed this skeleton
 * first — a page header and an eight-field form — then that route's own
 * skeleton nested inside it: the wrong shape, and two streamed boundaries
 * where one was needed. The group changes no URL; it only stops this
 * boundary reaching its siblings. STATE.md §5bz.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonPageHeader />
      <SkeletonForm fields={8} />
    </div>
  );
}
