# Release notes

One file per completed sprint, newest first. These say what a school gets and
what is not there yet. They are not the engineering handover — that is
`STATE.md` — and they are not the plan, which is `SPRINTS.md`.

| Sprint | Theme | Migration | Notes |
| --- | --- | --- | --- |
| **19b** | Campus calendars created in runs, the promotion that could not name its year, student documents, academic history, Enrol → Enroll | `0036` **APPLIED** | [read](RELEASE-NOTES-SPRINT-19B.md) |
| **19a** | A campus is a boundary; the owner's cross-campus dashboard, branch CRUD, a campus on every report | `0035` **APPLIED** | [read](RELEASE-NOTES-SPRINT-19A.md) |
| **18** | A challan is a Voucher, concession schemes the school owns, student CRUD as four permissions | `0034` **APPLIED** | [read](RELEASE-NOTES-SPRINT-18.md) |
| **17** | Onboarding by password link, the admission fee voucher, the discount that never applied, per-KPI setup progress | `0033` **APPLIED** | [read](RELEASE-NOTES-SPRINT-17.md) |
| **16** | School feedback, global search on five portals, dashboard progress and layout fixes | `0032` **APPLIED** | [read](RELEASE-NOTES-SPRINT-16.md) |
| **15** | The school creation wizard, dashboards on five portals, one table primitive | `0031` **APPLIED** | [read](RELEASE-NOTES-SPRINT-15.md) |
| — | School creation wizard, the 429 status, the clipped address list — **folded into Sprint 15**, kept for its detail | `0031` (see Sprint 15) | [read](RELEASE-NOTES-SCHOOL-WIZARD-AND-PROVISIONING.md) |
| — | School onboarding, fixed (not a sprint) | — | [read](RELEASE-NOTES-SCHOOL-ONBOARDING-FIXES.md) |
| — | Address & phone fields — one shape everywhere (not a sprint) | — | [read](RELEASE-NOTES-ADDRESS-AND-PHONE-FIELDS.md) |
| — | SMTP delivery and wildcard subdomains (not a sprint) | — | [read](RELEASE-NOTES-SMTP-AND-WILDCARD-SUBDOMAINS.md) |
| — | School & branch creation, fixed (not a sprint) | `0024` | [read](RELEASE-NOTES-SCHOOL-BRANCH-CREATION-FIXES.md) |
| — | Panel chooser, school deletion, address autocomplete (not a sprint) | — | [read](RELEASE-NOTES-PANEL-CHOOSER-AND-SCHOOL-DELETION.md) |
| — | Dashboard, deletion UI, branch delete, email delivery (not a sprint) | — | [read](RELEASE-NOTES-DASHBOARD-DELETION-AND-EMAIL.md) |
| **13.5** | Accounting — the ledger, expenses and per-staff cash | `0027` **proven, not deployed** | [read](RELEASE-NOTES-SPRINT-13.5.md) |
| **13.7** | Parent accounts, period schedules, colours, teacher calendar | `0025` | [read](RELEASE-NOTES-SPRINT-13.7.md) |
| **13.8** | Sibling identity — the guardian CNIC becomes the key | `0026` | [read](RELEASE-NOTES-SPRINT-13.8.md) |
| — | Announcement sweep & the deploy pipeline (not a sprint) | none | [read](RELEASE-NOTES-ANNOUNCEMENT-SWEEP-AND-DEPLOY.md) |
| **13** | Portals completed, the installable app, and two principals | `0023` | [read](RELEASE-NOTES-SPRINT-13.md) |
| **12** | Reports & analytics — nine printable, exportable reports | none | [read](RELEASE-NOTES-SPRINT-12.md) |
| **11** | Communications — announcements, notice board, delivery log | `0022` | [read](RELEASE-NOTES-SPRINT-11.md) |
| **10.5** | Design system, application shell & dashboard charts | none | [read](RELEASE-NOTES-SPRINT-10.5.md) |
| **10** | Onboarding — import, promotion, transfer, family fees | `0018`–`0020` | [read](RELEASE-NOTES-SPRINT-10.md) |
| **9** | Exams, results & report cards | `0016` | [read](RELEASE-NOTES-SPRINT-09.md) |
| **0** | Auth hardening & the email outbox | `0015` | [read](RELEASE-NOTES-SPRINT-00.md) |
| **8** | Roles & permissions | `0010` | [read](RELEASE-NOTES-SPRINT-08.md) |
| **7** | HR & payroll | `0009` | [read](RELEASE-NOTES-SPRINT-07.md) |
| **6** | Academics, timetable & attendance | `0008` | [read](RELEASE-NOTES-SPRINT-06.md) |
| **5** | Fee management | `0007` | [read](RELEASE-NOTES-SPRINT-05.md) |
| **4** | Admissions & student records | `0006` | [read](RELEASE-NOTES-SPRINT-04.md) |
| **3** | School users, invitations & sign-in | `0003`–`0005` | [read](RELEASE-NOTES-SPRINT-03.md) |
| **2** | The Super Admin panel | `0001`–`0002` | [read](RELEASE-NOTES-SPRINT-02.md) |
| **1** | Foundation & multi-tenancy | `0000` | [read](RELEASE-NOTES-SPRINT-01.md) |

Sprint 0 sits between 8 and 9 because that is when it was built. It is numbered
0 because it is reconciliation work, not because it came first.

The unnumbered row at the top is not a sprint and is not pretending to be one.
It is a batch of fixes to screens Sprints 2 and 3 built, and it took migration
`0024` because it needed columns — not because a fourteenth sprint happened.
Sprint 14 is internal chat and is still ahead.

## Not a sprint, but it shipped

Between Sprint 8 and Sprint 0 the platform moved underneath everything above:
**Firebase Auth → Supabase Auth, Neon → Supabase Postgres, and the move to
Hostinger**,
and **GoHighLevel went from being the tenant key to an opt-in per-school
integration**. There is no release note for it because a school sees nothing;
`STATE.md` §3 and §5b–§5d are the record. It matters when reading the early
notes below: some of what Sprints 1–3 built was rebuilt on a different
substrate afterwards, and each note says where.

## How these were written

**Sprints 0 and 9 onward were written from a contemporaneous record** — the
`STATE.md` section each sprint wrote as it finished.

**Sprints 1–8 are reconstructed after the fact**, in August 2026, from the
migrations, the screens on disk and `SPRINTS.md` §0. They are accurate about
what exists and deliberately thin about intent: nobody wrote down why at the
time, and inventing reasons a year later would be worse than omitting them.
Where a later sprint changed or replaced something, the note says so rather
than describing a state that is no longer true.

**No release here is dated as a commitment.** Dates are when work was done. See
`SPRINTS.md` §0.7.
