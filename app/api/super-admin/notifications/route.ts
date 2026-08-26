import { apiSuccess, handleApiError } from '@/lib/api-response';
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationsRead,
} from '@/lib/notifications';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * GET  /api/super-admin/notifications — the platform bell.
 * POST /api/super-admin/notifications — mark it all read.
 *
 * The recipient is the surface, not a user id: there is exactly one platform
 * identity by construction (`SUPER_ADMIN_EMAIL`), and `audience = 'super_admin'`
 * rows carry no `school_user_id` because the operator has no `school_users` row
 * at any school. Should a second operator ever exist, this is the one predicate
 * that needs an address on it, and the schema already has somewhere to put one.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECIPIENT = { audience: 'super_admin' } as const;

export async function GET() {
  try {
    await requireSuperAdmin();

    const [rows, unread] = await Promise.all([
      listNotifications(RECIPIENT),
      countUnreadNotifications(RECIPIENT),
    ]);

    return apiSuccess({ notifications: rows, unread });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST() {
  try {
    await requireSuperAdmin();
    return apiSuccess({ marked: await markNotificationsRead(RECIPIENT) });
  } catch (error) {
    return handleApiError(error);
  }
}
