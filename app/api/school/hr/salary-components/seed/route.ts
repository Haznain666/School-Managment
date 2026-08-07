import { DEFAULT_SALARY_COMPONENTS, salaryComponents } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { batch, db } from '@/lib/drizzle';
import { listSalaryComponents } from '@/lib/hr-queries';

/**
 * POST /api/school/hr/salary-components/seed
 *
 * Creates the salary heads a Pakistani school's payslip normally carries, so a
 * school is not asked to invent a payroll structure from an empty screen.
 *
 * Idempotent: each insert is `ON CONFLICT DO NOTHING` against the unique
 * (location, name) index, so running it twice — or running it after the school
 * has already added some of these by hand — cannot duplicate a head or
 * overwrite a percentage they have since tuned.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withSchoolAuth(
  async (_request, auth) => {
    try {
      await batch(db, (tx) =>
        DEFAULT_SALARY_COMPONENTS.map((component) =>
          tx
            .insert(salaryComponents)
            .values({
              locationId: auth.locationId,
              name: component.name,
              description: component.description,
              kind: component.kind,
              calculation: component.calculation,
              defaultPercentBasisPoints: component.defaultPercentBasisPoints,
              isBasic: component.isBasic,
              proratedByAttendance: component.proratedByAttendance,
              sortOrder: component.sortOrder,
            })
            .onConflictDoNothing({
              target: [salaryComponents.locationId, salaryComponents.name],
            }),
        ),
      );

      return apiSuccess({
        components: await listSalaryComponents(auth.locationId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
