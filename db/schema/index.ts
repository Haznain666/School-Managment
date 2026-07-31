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
