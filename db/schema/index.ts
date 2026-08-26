/**
 * Drizzle schema barrel — this file is what `drizzle.config.ts` points at and
 * what `lib/drizzle.ts` passes to the ORM. Every new table must be exported
 * here or it will not appear in generated migrations.
 *
 * Tenancy invariant: every table carries `location_id TEXT NOT NULL` (the GHL
 * Location ID) and is indexed on it. `schools` is the directory that key
 * refers to; everything else references it.
 */
export * from './schools';
export * from './school-modules';
export * from './school-branding';
export * from './school-users';
export * from './school-invitations';
export * from './auth-otp-sessions';
export * from './emergency-login-tokens';
export * from './password-setup-tokens';
export * from './ghl-tokens';
export * from './branches';
export * from './users';
export * from './students';
export * from './staff';

// Sprint 4 — Admissions.
export * from './academic-years';
export * from './grades';
export * from './sections';
export * from './student-profiles';
export * from './student-enrollments';
export * from './student-guardians';
export * from './admission-applications';
export * from './school-id-sequences';

// Sprint 5 — Fee Management.
export * from './fee-types';
export * from './fee-structures';
export * from './student-concessions';
export * from './fee-challans';
export * from './fee-challan-items';
export * from './fee-payments';
export * from './late-fee-rules';
export * from './challan-sequences';

// Sprint 6 — Academics & Timetable. `period-structures` comes first because
// `timetable-slots` references it: a period belongs to a named bell schedule.
export * from './subjects';
export * from './period-structures';
export * from './timetable-slots';
export * from './timetable-entries';
export * from './attendance-records';

// Sprint 7 — HR & Payroll. `./hr` is the barrel for the module's own tables;
// the employment record itself is `./staff`, exported above.
export * from './hr';

// Sprint 8 — per-school overrides of the default access model.
export * from './role-permissions';

// Sprint 9 — Exams, results and report cards. Dependency order, which is also
// the order to read them in: a scheme grades a term, a term holds exams, an
// exam holds papers, a paper holds marks.
export * from './grading-schemes';
export * from './exam-terms';
export * from './exams';
export * from './exam-subjects';
export * from './exam-results';

// Sprint 0 — auth hardening and the email outbox. Both are exceptions to the
// tenancy invariant above and each says why in its own docblock: `auth_attempts`
// guards the pre-authentication surface, where no tenant is established yet,
// and `email_outbox` also carries platform mail, which belongs to no school.
export * from './auth-attempts';
export * from './email-outbox';

// Sprint 10 — onboarding: getting a real school's roll into the system, moving
// it up a year, moving a student between campuses, and billing a family once.
// `family-challans` is exported before nothing in particular, but note
// `fee-challans` imports it: a challan may belong to a family voucher, never
// the other way round.
export * from './student-imports';
export * from './student-promotions';
export * from './student-transfers';
export * from './family-challans';

// Sprint 11 — communications. One message, who it was delivered to, and who has
// read it. The notice board is the delivery that always happens; email over the
// Sprint 0 outbox is the push that happens when the sender asks for it.
export * from './announcements';

// Sprint 13 — portal completion, the PWA shell and BR4 multiple principals.
// `principal-assignments` is exported before `schools` needs it only as a type,
// so the cycle is erased at compile time; the tables themselves do not
// reference each other.
export * from './principal-assignments';
export * from './lesson-plans';
export * from './notification-preferences';

// Sprint 13.5 — accounting. The ledger comes before anything that moves money:
// Sprint 16's parent wallet and Sprint 20's POS both post here, and a ledger
// retrofitted under live money is the cost this ordering exists to avoid.
//
// `ledger-accounts` is exported before `ledger-entries` because an entry
// references an account, and `expenses` and `cash-settlements` after both,
// because each is a consumer of the ledger rather than part of it. Deleting
// either of the last two would leave the school's books correct, which is the
// test of whether the ledger is doing the work.
export * from './ledger-accounts';
export * from './ledger-entries';
export * from './expenses';
export * from './cash-settlements';

// Sprint 14 — exam terms, per-grade datesheets, promotion criteria and the
// judgement a term ends in. Dependency order again, and it is worth reading in
// it: a term holds schedules, a schedule names the grades that sit it and the
// papers they sit, and `student_term_results` is what the whole thing is for.
//
// `result-subcategories` comes first because three of the others reference it —
// a descriptor is picked on a paper, named as the failing one in a grade's
// criteria, and awarded overall on a term result.
export * from './result-subcategories';
export * from './school-exam-settings';
export * from './exam-schedules';
export * from './exam-schedule-grades';
export * from './exam-schedule-subjects';
export * from './grade-promotion-criteria';
export * from './student-term-results';

// Sprint 16 — feedback from a school to the vendor, and the in-app bell that
// carries it in both directions.
//
// `notifications` is exported after `feedback` only for readability; neither
// references the other. The bell is deliberately general — a notification names
// a recipient, a title and a link, and knows nothing about feedback — so the
// next thing that needs to tell somebody something writes one row rather than
// adding a second mechanism.
export * from './feedback';
export * from './notifications';
