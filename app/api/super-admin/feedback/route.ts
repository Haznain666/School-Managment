import type { NextRequest } from 'next/server';

import { isFeedbackNature, isFeedbackStatus } from '@/db/schema';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import {
  FEEDBACK_SORT_COLUMNS,
  isFeedbackSection,
  type FeedbackSortColumn,
} from '@/lib/feedback';
import { getFeedbackSectionCounts, listPlatformFeedback } from '@/lib/feedback-queries';
import { readListQuery } from '@/lib/list-query';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * GET /api/super-admin/feedback — the cross-tenant listing.
 *
 * ── The one route in the product with no tenant filter ───────────────────
 * That is not an oversight and it is why this sits behind `requireSuperAdmin`
 * rather than `withSchoolAuth`. There is no `locationId` in a platform session
 * to scope by, and a school id arriving in the query string *narrows* the
 * result rather than authorising it — an operator filtering to one school is a
 * convenience, not a permission check.
 *
 * Sort, page and size go through `readListQuery`, so the 100-row ceiling and
 * the column whitelist are the same ones every other listing in the product
 * uses. A column name off the wire never reaches the query builder.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const search = request.nextUrl.searchParams;

    const list = readListQuery<FeedbackSortColumn>(search, {
      sortable: FEEDBACK_SORT_COLUMNS,
      defaultSort: 'createdAt',
      defaultDirection: 'desc',
    });

    const sectionRaw = search.get('section');
    const natureRaw = search.get('nature');
    const statusRaw = search.get('status');
    const schoolRaw = search.get('school');

    const [page, counts] = await Promise.all([
      listPlatformFeedback({
        section: isFeedbackSection(sectionRaw) ? sectionRaw : null,
        nature: isFeedbackNature(natureRaw) ? natureRaw : null,
        status: isFeedbackStatus(statusRaw) ? statusRaw : null,
        locationId: schoolRaw === null || schoolRaw === '' ? null : schoolRaw,
        search: search.get('q') ?? '',
        sort: list.sort,
        direction: list.direction,
        page: list.page,
        limit: list.limit,
      }),
      // Always the whole-estate counts, never the filtered ones. The counter
      // beside a section title answers "how much is waiting in there", and a
      // number that moved every time somebody typed in the search box would be
      // answering a different question with the same digits.
      getFeedbackSectionCounts(),
    ]);

    return apiSuccess({
      tickets: page.rows,
      total: page.total,
      page: list.page,
      limit: list.limit,
      counts,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
