# Release notes

One file per completed sprint, newest first. These say what a school gets and
what is not there yet. They are not the engineering handover — that is
`STATE.md` — and they are not the plan, which is `SPRINTS.md`.

| Sprint | Theme | Migration | Notes |
| --- | --- | --- | --- |
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

## Not a sprint, but it shipped

Between Sprint 8 and Sprint 0 the platform moved underneath everything above:
**Firebase Auth → Supabase Auth, Neon → Supabase Postgres, Vercel → Hostinger**,
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
