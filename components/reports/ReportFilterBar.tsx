import { Button } from '@/components/ui/Button';
import type { ReportDefinition, ReportParams } from '@/lib/report-catalogue';
import type { ReportOptions } from '@/lib/report-options';

/**
 * A report's filters, as a plain `GET` form.
 *
 * No client component and no JavaScript. The filters belong in the URL — an
 * accountant links a colleague to a filtered view, the print page and the CSV
 * route read the same query string, and the back button works — and a native
 * form submission puts them there for free. A client component would have to
 * reimplement that with a router push and would be the third place that knows
 * the parameter names.
 *
 * The campus control is absent for a branch-bound administrator on purpose:
 * `lib/report-options.ts` returns no branches for them, because the runner pins
 * their scope regardless of what the URL says. An offered control that is
 * silently overridden is worse than no control.
 */
export function ReportFilterBar({
  definition,
  params,
  options,
  action,
}: {
  definition: ReportDefinition;
  params: ReportParams;
  options: ReportOptions;
  action: string;
}) {
  const has = (filter: ReportDefinition['filters'][number]): boolean =>
    definition.filters.includes(filter);

  const fieldClass =
    'h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink ' +
    'focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30';

  const labelClass = 'flex flex-col gap-1 text-xs font-medium text-ink-muted';

  return (
    <form
      method="get"
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface-raised p-4"
    >
      {has('dateRange') ? (
        <>
          <label className={labelClass}>
            From
            <input type="date" name="from" defaultValue={params.from} className={fieldClass} />
          </label>
          <label className={labelClass}>
            To
            <input type="date" name="to" defaultValue={params.to} className={fieldClass} />
          </label>
        </>
      ) : null}

      {has('branch') && options.branches.length > 0 ? (
        <label className={labelClass}>
          Campus
          <select name="branch" defaultValue={params.branchId ?? ''} className={fieldClass}>
            <option value="">All campuses</option>
            {options.branches.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {has('grade') && options.grades.length > 0 ? (
        <label className={labelClass}>
          Class
          <select name="grade" defaultValue={params.gradeId ?? ''} className={fieldClass}>
            <option value="">All classes</option>
            {options.grades.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {has('term') ? (
        <label className={labelClass}>
          Term
          <select name="term" defaultValue={params.termId ?? ''} className={fieldClass}>
            <option value="">Choose a term</option>
            {options.terms.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {has('academicYear') ? (
        <label className={labelClass}>
          Academic year
          <select name="ay" defaultValue={params.academicYearId ?? ''} className={fieldClass}>
            <option value="">Every year</option>
            {options.academicYears.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {has('year') ? (
        <label className={labelClass}>
          Year
          <select
            name="year"
            defaultValue={String(params.year ?? new Date().getFullYear())}
            className={fieldClass}
          >
            {options.years.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <Button type="submit" size="md">
        Apply
      </Button>
    </form>
  );
}
