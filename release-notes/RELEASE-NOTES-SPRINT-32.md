# Release notes — Sprint 32: Staff KPIs & Performance

**Date:** 15 September 2026
**Module:** Staff KPIs & Performance (new, switched on per school)

## What's new

### Staff performance, measured the same way every month
Owners and principals can now answer *"which of my staff are doing their job well?"*
with a number instead of a feeling.

- **KPIs for every role.** Write the expectations for a role once, for example
  *Punctuality* for Teachers. Everyone in that role is rated on it. A KPI is
  **monthly** or **annual**, and both are scored out of 10.
- **Ratings with comments.** Each month the people responsible give each person
  a score from 1 to 10 on each KPI, with a comment. A 10 on Punctuality reads as 100%.
- **One figure per person.** Every member of staff gets a **monthly overall**
  and a **yearly overall**, each a plain average of their KPI scores.
- **The senior rater counts.** If a coordinator and a principal both rate the
  same thing, the principal's score counts. The coordinator's rating is kept in
  the history and marked as not counting.
- **Nothing is ever overwritten.** Changing a rating adds a new entry. The
  earlier score stays in the history, so a disputed appraisal can be answered
  months later.

### Who does what
| Role | Defines KPIs | Rates | Sees |
| --- | --- | --- | --- |
| School Administrator | for every role | anyone, within the settings below | everyone |
| Principal / Vice Principal | for every role except Principal and Branch Admin (a Vice Principal also cannot define KPIs for Vice Principals) | their own teachers, coordinators, and (Principal only) their vice principal | the people they rate in full; everyone else's yearly overall |
| Branch Administrator | for every role except Principal and Branch Admin | coordinators and non-teaching staff at their campus, never teachers | their campus |
| Coordinator | none | the teachers a principal has assigned to them | those teachers, with everything except salary |
| HR Manager | none | none | every score |
| Accountant | none | none | the yearly overall only |
| Everyone else rated | none | none | their own scores (**My performance**) |

All of it can be changed in **Settings → Roles and permissions → Staff performance**.

### Every teacher has exactly one principal
At a school with several principals, each teacher belongs to the principal
whose classes they teach most. **Staff performance → Setup** shows every
teacher's principal and how that was decided. If a teacher's periods are split
equally, they are listed as **Unassigned** and the School Administrator chooses.
A principal can ask for a teacher to be transferred to or from them, and the
other principal accepts or declines. A transfer stays in place even when the
timetable changes.

### Setup
- **Mark principals' progress?** and **Mark branch admins' progress?**: two
  School Administrator settings, each with a choice of who rates them.
- **Coordinators and their teachers**: a principal chooses, teacher by teacher,
  whom each coordinator supervises.
- **Vice principals**: at a school with several principals, which principal each
  vice principal serves.

### Teachers see their own scores
Teachers have a new **My Performance** page in their portal, showing their
KPIs, the score that counts and its comment.

## Fixed
- **Announcements list stayed out of date after a save.** Saving a draft,
  sending an announcement or discarding one now updates the list straight away,
  without reloading the page.

## Good to know
- Staff KPIs & Performance is a **paid module**, switched on per school by the
  platform team. Schools without it see no menu entry for it.
- A school with no Branch Administrator and **one** principal has that
  principal rate the accountants, HR and marketing staff. With several
  principals and no Branch Administrator, only the School Administrator does.
- A month that has not started cannot be rated.

## Known issues
- **Chat, new conversation on a page opened directly:** the report that a new
  conversation does not appear in the list could not be reproduced this sprint
  and is still under investigation.
- Some other screens still rely on a page refresh to show a change. They are
  listed internally and being fixed screen by screen.
