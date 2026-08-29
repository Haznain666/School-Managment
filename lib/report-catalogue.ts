import { formatAmount } from './money';
import type { Permission } from './permissions';

/**
 * The report catalogue — Sprint 12.
 *
 * ── One definition, three renderers ──────────────────────────────────────
 * A report is declared here once: its title, the question it answers, the
 * permission that opens it, the filters it takes and its columns. Three things
 * consume that declaration and none of them re-states it:
 *
 *   the screen   `app/(school-admin)/dashboard/reports/[reportKey]/page.tsx`
 *   the paper    `…/[reportKey]/print/page.tsx`, inside `PrintSheet`
 *   the file     `app/api/school/reports/[reportKey]/route.ts`, as CSV
 *
 * That is the whole architecture, and it exists because the alternative was
 * observed twice already in this repo: a cap that drifted between a list and
 * its print page (`lib/challan-print.ts`) and a strength meter that drifted
 * from the check that accepted the password (§5d). A column added to the screen
 * and forgotten in the export is the same defect, discovered by an accountant
 * reconciling a printout against a spreadsheet.
 *
 * ── No new permission key, deliberately ──────────────────────────────────
 * `SPRINTS.md` says Sprint 12 has no migration, and it is right to. A
 * `reports.read` key would need one: `role_permissions_permission_check` is
 * generated from the `PERMISSIONS` array, so adding a key means dropping and
 * recreating that constraint (§5aa). It would also be the wrong shape — a
 * single key would let anyone who may read the attendance register also read
 * the salary bill. Each report is gated on the permission that already governs
 * the screen its data comes from, so the reports index shows an accountant the
 * four financial reports and a coordinator the three academic ones, with no
 * school having to configure anything.
 *
 * ── Dependency-free ──────────────────────────────────────────────────────
 * No `server-only` and no database import: the index page, the filter bar and
 * the CSV route all read this, and two of those are reachable from the browser
 * bundle. `lib/report-queries.ts` is the half that talks to Postgres.
 */

export const REPORT_KEYS = [
  'attendance-summary',
  'subject-attendance',
  'fee-collection',
  'outstanding-aging',
  'academic-results',
  'payroll-summary',
  'leave-summary',
  'enrollment-funnel',
  'monthly-revenue',
  // Sprint 13.5 — the seven financial statements. They are declarations here
  // and runners in `lib/report-queries.ts`, and that buys all three renderers:
  // the screen, the `PrintSheet` and the CSV. A balance sheet that could be
  // read on screen and not printed would be worth very little to a school
  // taking one to a board meeting.
  'balance-sheet',
  'profit-loss',
  'day-book',
  'account-summary',
  'monthly-accounts',
  'expense-detail',
  'income-expense-summary',
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export function isReportKey(value: unknown): value is ReportKey {
  return typeof value === 'string' && (REPORT_KEYS as readonly string[]).includes(value);
}

/**
 * How a cell is rendered and aligned.
 *
 * `money` and `percent` are separate from `number` because they are formatted
 * differently and because only `money` gets grouped thousands. All three are
 * right-aligned and monospaced on screen so a column of figures reads as a
 * column.
 */
export type ColumnKind = 'text' | 'number' | 'money' | 'percent' | 'date';

export interface ReportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  /** Narrow columns the printed sheet may drop when it runs out of width. */
  secondary?: boolean;
}

/** A value as a report row carries it — raw, never pre-formatted. */
export type ReportValue = string | number | null;

/** One row, keyed by column. */
export type ReportRow = Record<string, ReportValue>;

/**
 * The filter controls a report offers.
 *
 * A closed set rather than free-form field descriptors: every report here takes
 * some combination of six things, and a general filter engine would be more
 * code than the nine reports it served.
 */
export type ReportFilter =
  | 'dateRange'
  | 'branch'
  | 'grade'
  | 'term'
  | 'academicYear'
  | 'year';

export interface ReportDefinition {
  key: ReportKey;
  title: string;
  /** The question the report answers, in the words somebody would ask it. */
  blurb: string;
  /** How the index groups them. */
  group: 'Academics' | 'Fees' | 'People' | 'Accounting';
  permission: Permission;
  filters: readonly ReportFilter[];
  columns: readonly ReportColumn[];
  /** Wide reports print landscape. */
  landscape?: boolean;
  /**
   * A caveat shown on the screen *and* printed on the sheet.
   *
   * On the sheet especially: a printout leaves the building, and a number whose
   * meaning depends on a rule nobody can see is how a school reports the wrong
   * figure to a board in good faith.
   */
  caveat?: string;
}

/** Columns every class-scoped report starts with. */
const CLASS_COLUMNS: readonly ReportColumn[] = [
  { key: 'className', label: 'Class', kind: 'text' },
  { key: 'branchName', label: 'Campus', kind: 'text', secondary: true },
];

export const REPORTS: readonly ReportDefinition[] = [
  {
    key: 'attendance-summary',
    title: 'Attendance summary',
    blurb: 'How many days each class was present for, over a date range.',
    group: 'Academics',
    permission: 'academics.read',
    filters: ['dateRange', 'branch', 'grade'],
    columns: [
      ...CLASS_COLUMNS,
      { key: 'sectionName', label: 'Section', kind: 'text' },
      { key: 'students', label: 'Students', kind: 'number' },
      { key: 'present', label: 'Present', kind: 'number' },
      { key: 'absent', label: 'Absent', kind: 'number' },
      { key: 'late', label: 'Late', kind: 'number' },
      { key: 'excused', label: 'Excused', kind: 'number' },
      { key: 'holiday', label: 'Holiday', kind: 'number', secondary: true },
      { key: 'percentage', label: 'Attendance', kind: 'percent' },
    ],
    caveat:
      'Late counts as present — the child was in class. Holidays are reported ' +
      'but kept out of the percentage, so a school closure cannot drag it down.',
  },

  {
    key: 'subject-attendance',
    title: 'Subject-wise attendance',
    blurb: 'Which subjects lose the most teaching time to absence.',
    group: 'Academics',
    permission: 'academics.read',
    filters: ['dateRange', 'branch', 'grade'],
    columns: [
      { key: 'subjectName', label: 'Subject', kind: 'text' },
      { key: 'subjectCode', label: 'Code', kind: 'text', secondary: true },
      { key: 'sections', label: 'Sections', kind: 'number', secondary: true },
      { key: 'periodsScheduled', label: 'Student-periods', kind: 'number' },
      { key: 'periodsAttended', label: 'Attended', kind: 'number' },
      { key: 'periodsMissed', label: 'Missed', kind: 'number' },
      { key: 'percentage', label: 'Attendance', kind: 'percent' },
    ],
    caveat:
      'The register is taken once a day, not once a period (see ' +
      'attendance_records). So this is derived: a day a child was away is ' +
      'charged against whichever subjects their section had on the timetable ' +
      'that weekday. It measures teaching time lost, and it is only as ' +
      'accurate as the timetable — sections with no timetable contribute ' +
      'nothing to it.',
  },

  {
    key: 'fee-collection',
    title: 'Fee collection',
    blurb: 'Billed against collected, class by class, over a date range.',
    group: 'Fees',
    permission: 'fees.read',
    filters: ['dateRange', 'branch', 'grade'],
    columns: [
      ...CLASS_COLUMNS,
      { key: 'vouchers', label: 'Vouchers', kind: 'number' },
      { key: 'students', label: 'Students', kind: 'number', secondary: true },
      { key: 'billed', label: 'Billed', kind: 'money' },
      { key: 'collected', label: 'Collected', kind: 'money' },
      { key: 'outstanding', label: 'Outstanding', kind: 'money' },
      { key: 'rate', label: 'Collected', kind: 'percent' },
    ],
    caveat:
      'This follows the billing: a voucher issued inside the range is billed ' +
      'here, and whatever has been paid against it is collected here, whenever ' +
      'the money actually arrived. So Billed − Collected is exactly ' +
      'Outstanding, and the question it answers is "how much of what we ' +
      'charged in June have we got in". For cash by the month it arrived, use ' +
      'Monthly revenue. A voucher is attributed to the class its student is ' +
      'enrolled in today, because a voucher carries no class of its own. ' +
      'Cancelled vouchers are excluded; waived ones are billed and never ' +
      'collected, which is what waiving them means.',
  },

  {
    key: 'outstanding-aging',
    title: 'Outstanding & aging',
    blurb: 'Every rupee owed, split by how long it has been owed.',
    group: 'Fees',
    permission: 'fees.read',
    filters: ['branch', 'grade'],
    landscape: true,
    columns: [
      { key: 'studentName', label: 'Student', kind: 'text' },
      { key: 'studentNumber', label: 'ID', kind: 'text', secondary: true },
      ...CLASS_COLUMNS,
      { key: 'current', label: 'Not yet due', kind: 'money' },
      { key: 'd1_30', label: '1–30 days', kind: 'money' },
      { key: 'd31_60', label: '31–60 days', kind: 'money' },
      { key: 'd61_90', label: '61–90 days', kind: 'money' },
      { key: 'd90_plus', label: 'Over 90 days', kind: 'money' },
      { key: 'total', label: 'Total owed', kind: 'money' },
    ],
    caveat:
      'Aged from each voucher’s due date, as at today. Cancelled and waived ' +
      'vouchers are excluded — nobody owes them.',
  },

  {
    key: 'academic-results',
    title: 'Academic results',
    blurb: 'Pass rate and averages for every exam in a term.',
    group: 'Academics',
    permission: 'exams.read',
    // `branch` added in Sprint 19a, item 9. It was one of four reports that
    // could not be narrowed to a campus, on a screen that already prints a
    // Campus column — so the column named a campus the filter could not select.
    filters: ['term', 'branch'],
    columns: [
      { key: 'examTitle', label: 'Exam', kind: 'text' },
      ...CLASS_COLUMNS,
      { key: 'papers', label: 'Papers', kind: 'number', secondary: true },
      { key: 'graded', label: 'Graded', kind: 'number' },
      { key: 'passed', label: 'Passed', kind: 'number' },
      { key: 'passRate', label: 'Pass rate', kind: 'percent' },
      { key: 'average', label: 'Average', kind: 'percent' },
      { key: 'highest', label: 'Highest', kind: 'percent', secondary: true },
      { key: 'lowest', label: 'Lowest', kind: 'percent', secondary: true },
      { key: 'excluded', label: 'Not graded', kind: 'number' },
    ],
    caveat:
      'Published papers only, and a student is graded only once every ' +
      'published paper carries a mark for them. Anyone absent from a paper, or ' +
      'not yet marked on one, is counted under "Not graded" rather than folded ' +
      'in as a zero — the same rule the report card and the dashboard follow.',
  },

  {
    key: 'payroll-summary',
    title: 'Payroll summary',
    blurb: 'The salary bill month by month, and what it was reduced by.',
    group: 'People',
    permission: 'payroll.read',
    filters: ['year', 'branch'],
    columns: [
      { key: 'period', label: 'Month', kind: 'text' },
      { key: 'branchName', label: 'Campus', kind: 'text', secondary: true },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'staffCount', label: 'Staff', kind: 'number' },
      { key: 'gross', label: 'Gross', kind: 'money' },
      { key: 'lossOfPay', label: 'Loss of pay', kind: 'money' },
      { key: 'deductions', label: 'Deductions', kind: 'money' },
      { key: 'net', label: 'Net payable', kind: 'money' },
      { key: 'paid', label: 'Paid out', kind: 'money' },
    ],
    caveat:
      'Every run is listed, including drafts and cancelled ones, because a ' +
      'month missing from a salary report reads as a month nobody was paid. ' +
      '"Paid out" counts only payslips actually marked paid, so it lags the ' +
      'net figure until the run is settled.',
  },

  {
    key: 'leave-summary',
    title: 'Leave summary',
    blurb: 'Who took leave, how much of it, and how much was unpaid.',
    group: 'People',
    permission: 'hr.read',
    filters: ['dateRange', 'branch'],
    columns: [
      { key: 'staffName', label: 'Staff', kind: 'text' },
      { key: 'employeeCode', label: 'Code', kind: 'text', secondary: true },
      { key: 'department', label: 'Department', kind: 'text', secondary: true },
      { key: 'branchName', label: 'Campus', kind: 'text', secondary: true },
      { key: 'requests', label: 'Requests', kind: 'number' },
      { key: 'approvedDays', label: 'Approved days', kind: 'number' },
      { key: 'paidDays', label: 'Paid', kind: 'number' },
      { key: 'unpaidDays', label: 'Unpaid', kind: 'number' },
      { key: 'pending', label: 'Pending', kind: 'number' },
      { key: 'rejected', label: 'Rejected', kind: 'number', secondary: true },
    ],
    caveat:
      'A request counts against the range by its start date. Paid and unpaid ' +
      'come from the leave type, which is what payroll deducts on — so the ' +
      'unpaid column is the one that reaches a payslip.',
  },

  {
    key: 'enrollment-funnel',
    title: 'Enrollment funnel',
    blurb: 'Applications through to enrolled students, class by class.',
    group: 'Academics',
    permission: 'admissions.read',
    filters: ['academicYear', 'branch'],
    columns: [
      ...CLASS_COLUMNS,
      { key: 'applications', label: 'Applied', kind: 'number' },
      { key: 'open', label: 'Still open', kind: 'number' },
      { key: 'waitlisted', label: 'Waitlisted', kind: 'number', secondary: true },
      { key: 'accepted', label: 'Accepted', kind: 'number' },
      { key: 'rejected', label: 'Rejected', kind: 'number', secondary: true },
      { key: 'enrolled', label: 'Enrolled', kind: 'number' },
      { key: 'conversion', label: 'Applied → enrolled', kind: 'percent' },
    ],
    caveat:
      'Enrolled means the application was converted into a student record. A ' +
      'school that enrols a child without an application — a sibling, a ' +
      'walk-in, an imported roll — has students who are in no funnel, and this ' +
      'report is about the funnel rather than about the roll. "Still open" is ' +
      'pending and under review together: both mean nobody has decided yet.',
  },

  {
    key: 'monthly-revenue',
    title: 'Monthly revenue',
    blurb: 'Twelve months of money in, and how it arrived.',
    group: 'Fees',
    permission: 'fees.read',
    filters: ['branch'],
    columns: [
      { key: 'period', label: 'Month', kind: 'text' },
      { key: 'billed', label: 'Billed', kind: 'money' },
      { key: 'collected', label: 'Collected', kind: 'money' },
      { key: 'cash', label: 'Cash', kind: 'money' },
      { key: 'bankTransfer', label: 'Bank transfer', kind: 'money' },
      { key: 'cheque', label: 'Cheque', kind: 'money' },
      { key: 'payments', label: 'Receipts', kind: 'number', secondary: true },
    ],
    caveat:
      'Billed is by issue date and collected by payment date, so the two ' +
      'columns on one row are not the same money. Collection against a given ' +
      'month’s billing is the Fee collection report.',
  },
  /* ---------------------------------------------------------------------------
   * Sprint 13.5 — the financial statements.
   *
   * All seven read `ledger_entries` and nothing else, which is the property
   * that makes them worth having: a balance sheet assembled from the fee
   * module, the payroll module and a spreadsheet is three modules' opinions,
   * and the first thing anybody asks of it is why it does not balance.
   *
   * They are grouped under Accounting rather than Fees. An accountant reaching
   * the index sees both groups, which is right — but "Fee collection" answers
   * a question about children and "Profit and loss" answers one about the
   * school, and putting them in one list makes both harder to find.
   * ------------------------------------------------------------------------ */

  {
    key: 'balance-sheet',
    title: 'Balance sheet',
    blurb: 'What the school holds, what it owes, and what is left.',
    group: 'Accounting',
    permission: 'accounting.read',
    filters: ['dateRange', 'branch'],
    columns: [
      { key: 'section', label: 'Section', kind: 'text' },
      { key: 'code', label: 'Code', kind: 'text', secondary: true },
      { key: 'account', label: 'Account', kind: 'text' },
      { key: 'balance', label: 'Balance', kind: 'money' },
    ],
    caveat:
      'As at the end date. The start date is ignored — a balance sheet is a ' +
      'position on a day, not a period, and every entry up to that day counts ' +
      'towards it. The period’s profit is shown as its own line under Equity ' +
      'and is not closed out to a reserve: this product never runs a year-end, ' +
      'deliberately, because a school that has never run one would otherwise ' +
      'have a balance sheet that does not balance and nothing saying why.',
  },

  {
    key: 'profit-loss',
    title: 'Profit and loss',
    blurb: 'What the school earned and what it spent, head by head.',
    group: 'Accounting',
    permission: 'accounting.read',
    filters: ['dateRange', 'branch'],
    columns: [
      { key: 'section', label: 'Section', kind: 'text' },
      { key: 'code', label: 'Code', kind: 'text', secondary: true },
      { key: 'account', label: 'Account', kind: 'text' },
      { key: 'amount', label: 'Amount', kind: 'money' },
    ],
    caveat:
      'Income is counted when the money was received, not when it was billed ' +
      '— see migration 0027 for why. So a term’s fees appear in the months ' +
      'parents actually paid them, and what is still owed is not here at all: ' +
      'that is Outstanding & aging, under Fees.',
  },

  {
    key: 'day-book',
    title: 'Day book',
    blurb: 'Every entry in the books, newest first, with both sides.',
    group: 'Accounting',
    permission: 'accounting.read',
    filters: ['dateRange', 'branch'],
    landscape: true,
    columns: [
      { key: 'entryDate', label: 'Date', kind: 'date' },
      { key: 'memo', label: 'Entry', kind: 'text' },
      { key: 'source', label: 'Raised by', kind: 'text', secondary: true },
      { key: 'reference', label: 'Reference', kind: 'text', secondary: true },
      { key: 'debitAccount', label: 'Debit', kind: 'text' },
      { key: 'creditAccount', label: 'Credit', kind: 'text' },
      { key: 'amount', label: 'Amount', kind: 'money' },
    ],
    caveat:
      'One line per entry. An entry with more than two sides — a split — shows ' +
      'the largest of each side and the count beside it; open it in the ' +
      'accounting screens to see every line. Reversed entries are still here ' +
      'and are marked, beside the entry that reversed them: the ledger is ' +
      'append-only, so a correction adds a line rather than removing one.',
  },

  {
    key: 'account-summary',
    title: 'Account summary, day by day',
    blurb: 'One account’s movements, a line per day, with a running balance.',
    group: 'Accounting',
    permission: 'accounting.read',
    filters: ['dateRange', 'branch'],
    columns: [
      { key: 'entryDate', label: 'Date', kind: 'date' },
      { key: 'account', label: 'Account', kind: 'text' },
      { key: 'entries', label: 'Entries', kind: 'number', secondary: true },
      { key: 'debit', label: 'In', kind: 'money' },
      { key: 'credit', label: 'Out', kind: 'money' },
      { key: 'movement', label: 'Net', kind: 'money' },
    ],
    caveat:
      'Every account with movement in the range, a row per account per day. ' +
      'In and Out are debit and credit — for cash and expenses that reads the ' +
      'way it sounds, and for income and liabilities it is the other way ' +
      'round, because that is what those accounts do when they grow.',
  },

  {
    key: 'monthly-accounts',
    title: 'Month by month',
    blurb: 'Income, expenses and profit for each month of a year.',
    group: 'Accounting',
    permission: 'accounting.read',
    filters: ['year', 'branch'],
    columns: [
      { key: 'period', label: 'Month', kind: 'text' },
      { key: 'income', label: 'Income', kind: 'money' },
      { key: 'expenses', label: 'Expenses', kind: 'money' },
      { key: 'profit', label: 'Profit', kind: 'money' },
      { key: 'entries', label: 'Entries', kind: 'number', secondary: true },
    ],
    caveat:
      'Twelve rows for a calendar year, including the months with nothing in ' +
      'them — a missing month reads as an oversight, and a zero reads as a ' +
      'quiet month. Profit is income less expenses over the ledger, so it ' +
      'counts salaries and rent, which the fee module’s own reports cannot.',
  },

  {
    key: 'expense-detail',
    title: 'Expenses by category',
    blurb: 'Every approved expense in the range, grouped by what it was for.',
    group: 'Accounting',
    permission: 'accounting.read',
    filters: ['dateRange', 'branch'],
    landscape: true,
    columns: [
      { key: 'category', label: 'Category', kind: 'text' },
      { key: 'account', label: 'Account', kind: 'text', secondary: true },
      { key: 'expenseDate', label: 'Date', kind: 'date' },
      { key: 'payee', label: 'Paid to', kind: 'text' },
      { key: 'reference', label: 'Bill no.', kind: 'text', secondary: true },
      { key: 'paidFrom', label: 'Paid from', kind: 'text', secondary: true },
      { key: 'approvedBy', label: 'Approved by', kind: 'text', secondary: true },
      { key: 'amount', label: 'Amount', kind: 'money' },
    ],
    caveat:
      'Approved expenses only. A draft is a request for money and a rejected ' +
      'one is a request that was refused; neither is money that left the ' +
      'school, and putting either on this sheet would overstate what the ' +
      'school spent.',
  },

  {
    key: 'income-expense-summary',
    title: 'Income and expense summary',
    blurb: 'One line per head, for the year, in the shape a tax return wants.',
    group: 'Accounting',
    permission: 'accounting.read',
    filters: ['dateRange', 'branch'],
    columns: [
      { key: 'section', label: 'Section', kind: 'text' },
      { key: 'code', label: 'Code', kind: 'text' },
      { key: 'account', label: 'Account', kind: 'text' },
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'share', label: 'Share', kind: 'percent' },
    ],
    caveat:
      'The same figures as Profit and loss, with each head’s share of its own ' +
      'side beside it. It exists as a separate sheet because this is the one ' +
      'that gets handed to somebody outside the school, and a percentage ' +
      'column is what stops the reader having to work out whether 1.2 million ' +
      'in salaries is a lot.',
  },
];

const BY_KEY = new Map<ReportKey, ReportDefinition>(
  REPORTS.map((report) => [report.key, report]),
);

export function reportFor(key: ReportKey): ReportDefinition {
  const report = BY_KEY.get(key);
  // Unreachable: `ReportKey` is the catalogue's own key union.
  if (report === undefined) throw new Error(`No report definition for ${key}`);
  return report;
}

/**
 * The reports a caller may open.
 *
 * Order is the catalogue's, not the permissions'. The index groups them, so an
 * accountant with no academic permissions sees a Fees group and nothing else
 * rather than an empty Academics heading.
 */
export function reportsFor(
  permissions: readonly Permission[],
): readonly ReportDefinition[] {
  return REPORTS.filter((report) => permissions.includes(report.permission));
}

/* -----------------------------------------------------------------------------
 * Filters.
 * -------------------------------------------------------------------------- */

/** The filter values a report is run with, already parsed. */
export interface ReportParams {
  from?: string;
  to?: string;
  branchId?: string;
  gradeId?: string;
  termId?: string;
  academicYearId?: string;
  year?: number;
}

/** How far back a date-range report opens. A term is longer; a week is noise. */
export const DEFAULT_RANGE_DAYS = 30;

/** `YYYY-MM-DD` in UTC, which is what a DATE column holds. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function defaultDateRange(today: Date = new Date()): { from: string; to: string } {
  const start = new Date(today.getTime());
  start.setUTCDate(start.getUTCDate() - DEFAULT_RANGE_DAYS);
  return { from: isoDay(start), to: isoDay(today) };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query string to parameters.
 *
 * The one place this happens, so the screen, the print page and the CSV route
 * cannot read the same URL differently — which is the defect that would make an
 * export disagree with the table it was exported from.
 *
 * A malformed date falls back to the default range rather than being refused.
 * These values reach a `date` comparison in Postgres, where an unparseable
 * string is an error rather than an empty result, and the URL is hand-editable:
 * a mistyped one should show the default month, not a stack trace.
 */
export function parseReportParams(
  definition: ReportDefinition,
  search: Record<string, string | undefined>,
  today: Date = new Date(),
): ReportParams {
  const params: ReportParams = {};

  if (definition.filters.includes('dateRange')) {
    const fallback = defaultDateRange(today);
    const from = search.from ?? '';
    const to = search.to ?? '';

    params.from = DATE_PATTERN.test(from) ? from : fallback.from;
    params.to = DATE_PATTERN.test(to) ? to : fallback.to;

    // A backwards range returns nothing and looks like missing data. Swapping
    // is what the user meant; refusing would make them work out which box was
    // wrong.
    if (params.from > params.to) {
      [params.from, params.to] = [params.to, params.from];
    }
  }

  // `ay` rather than `year` for the academic year: `year` is the payroll
  // report's calendar year, and one key meaning two things would have the
  // payroll filter silently selecting an academic year id.
  const passThrough = [
    ['branch', 'branchId'],
    ['grade', 'gradeId'],
    ['term', 'termId'],
    ['ay', 'academicYearId'],
  ] as const;

  for (const [queryKey, paramKey] of passThrough) {
    const value = search[queryKey];
    if (value !== undefined && value !== '') params[paramKey] = value;
  }

  if (definition.filters.includes('year')) {
    const parsed = Number.parseInt(search.year ?? '', 10);
    params.year =
      Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
        ? parsed
        : today.getFullYear();
  }

  return params;
}

/**
 * Parameters back onto a query string.
 *
 * The inverse of `parseReportParams`, and the reason Print and Export are plain
 * links: the sheet and the file are reached with the table's own filters
 * re-encoded, so none of the three can be showing a different selection.
 */
export function toReportQuery(params: ReportParams): string {
  const query = new URLSearchParams();

  if (params.from !== undefined) query.set('from', params.from);
  if (params.to !== undefined) query.set('to', params.to);
  if (params.branchId !== undefined) query.set('branch', params.branchId);
  if (params.gradeId !== undefined) query.set('grade', params.gradeId);
  if (params.termId !== undefined) query.set('term', params.termId);
  if (params.academicYearId !== undefined) query.set('ay', params.academicYearId);
  if (params.year !== undefined) query.set('year', String(params.year));

  return query.toString();
}

/**
 * Turns the applied filters back into a sentence.
 *
 * Printed under the letterhead. A sheet of figures with no statement of what
 * was asked for is the report that gets filed, found six months later and
 * misread — the whole reason the print framework carries a letterhead at all.
 */
export function describeScope(
  definition: ReportDefinition,
  params: ReportParams,
  names: { branch?: string; grade?: string; term?: string; academicYear?: string },
): string {
  const parts: string[] = [];

  if (params.from !== undefined && params.to !== undefined) {
    parts.push(`${params.from} to ${params.to}`);
  }
  if (definition.filters.includes('year') && params.year !== undefined) {
    parts.push(String(params.year));
  }
  parts.push(names.term ?? '');
  parts.push(names.academicYear ?? '');
  parts.push(names.branch ?? 'All campuses');
  parts.push(names.grade ?? '');

  return parts.filter((part) => part !== '').join(' · ');
}

/* -----------------------------------------------------------------------------
 * Formatting — screen and paper only. The CSV writes raw values.
 * -------------------------------------------------------------------------- */

/**
 * A cell as a person reads it.
 *
 * The CSV deliberately does not use this: `12,500` is text to a spreadsheet and
 * will not sum, which is the first thing anybody does to an exported fee
 * report. See `lib/csv-export.ts`.
 */
export function formatCell(kind: ColumnKind, value: ReportValue): string {
  if (value === null || value === '') return '—';

  switch (kind) {
    case 'money':
      return typeof value === 'number' ? formatAmount(value) : String(value);
    case 'percent':
      return typeof value === 'number' ? `${value}%` : String(value);
    case 'number':
      return typeof value === 'number' ? value.toLocaleString('en-PK') : String(value);
    default:
      return String(value);
  }
}

/** Numeric kinds are right-aligned and tabular; text is not. */
export function isNumericKind(kind: ColumnKind): boolean {
  return kind === 'money' || kind === 'percent' || kind === 'number';
}

/* -----------------------------------------------------------------------------
 * Percentages.
 * -------------------------------------------------------------------------- */

/**
 * A rate as one decimal place, or null when there is nothing to divide by.
 *
 * Null rather than 0: a class with no marked days has no attendance rate, and
 * printing `0%` beside it says the children were all absent. Every report here
 * distinguishes the two, and `formatCell` draws the empty one as an em dash.
 */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}
