# Sprint 22 — one person, one record

**A member of your staff could exist twice in this product, and the two halves
never met.** Inviting a teacher from **Users & Staff** created a login. Adding
one from **HR → Staff** created an employment record. Neither screen created the
other, neither screen said so, and there was no way to join them afterwards.

That is not a tidiness problem. A teacher needs both:

- **no login** — no timetable can give them a period;
- **no employment record** — no class can name them as its class teacher, and
  payroll does not know they exist.

So a school that invited its teachers got people who could be timetabled and
could never take a home room, and a school that added them from HR got the
reverse. This release joins the two, both ways, and tells you where they are
already split.

**There is no database migration.** Nothing to apply, nothing to schedule.

---

## HR → Add staff member can now create the login

The **Add staff member** form has a new **Portal access** section at the foot,
with three choices:

| Choice | What it does |
| --- | --- |
| **No login needed** — the default | Exactly what the form did before |
| **Create a login** | Adds the portal account and emails them a link to set a password |
| **Link an existing account** | Joins this record to somebody already invited |

**"No login needed" is the default and will stay the default.** Most of a
school's payroll never signs in — drivers, guards, kitchen and cleaning staff —
and the form must not imply otherwise. If you choose it, nothing about adding a
staff member has changed: no new required field, no new request.

Choosing **Create a login** makes the form's own **Email** and **Phone**
required, and says why on screen: the email address is what the account is keyed
by, and the phone number is part of every directory record. It does not ask for
them twice — one person has one set of contact details.

The employment record is always saved **first**, and it is never thrown away. If
the login cannot be created — the address belongs to a colleague, the mail
server is down — the staff member is still on your payroll and the form tells
you what did not happen and why. You can finish the job from their profile.

## Invite Staff can now create the employment record

The **Invite staff** form has a new tick box, **"Also add an employment
record"**, on by default. Every role that form offers is a member of staff, so
in almost every case that is what you want.

It reveals four fields: **Employee code**, **Designation**, **Department** and
**Joining date**. The employee code is **filled in for you** — the next free
`EMP-<n>` at your school — and you can edit it. If somebody else has just taken
that code you are told so, naming the field, rather than being left to guess.

Same rule the other way round: the invitation is sent first and is never undone.
If the employment record cannot be filed, the person is still invited and the
screen says so.

## Joining up the records you already have

Every staff record and every user profile now carries the other half.

- **A staff member's profile** has a **Portal access** panel. Linked, it shows
  the account's name, role and campus with a link straight to it, plus
  **Unlink**. Not linked, it offers **Link an existing account** and **Create a
  login**.
- **A user's profile** has an **Employment record** panel — the mirror. Linked,
  it shows their employee code, designation and department, with a link to the
  HR record. Not linked, it offers **Add an employment record**.

**Unlink removes only the link.** The account keeps its role and its sessions;
the employment record keeps its payslips. Nothing is deleted.

## Saying so when a half is missing

Neither screen will ever refuse to save. Both now say what is missing:

- the **HR staff list** and profile show **No login** on anyone still employed
  with no portal account. On somebody marked as a class teacher, the profile adds
  the consequence: they cannot be assigned periods without a login;
- the **Users & Staff** list and profile show **No employment record** on any
  active member of staff who backs no HR record. For a teacher, the profile
  adds: they cannot be made a class teacher without one.

These are advisory. They change nothing about what any screen lets you do.

## Finding the ones already split

Both lists have a new filter, **off by default**:

- **HR → Staff → Portal access → Unlinked** — everyone employed with no login;
- **Users & Staff → Employment → No employment record** — every active member of
  staff with no HR record.

This is how you reconcile the records your school already has. Work down the
list, link or create, and the badges disappear from both screens as you go.

## Also fixed

**Inviting somebody on a colleague's email address reported the wrong problem.**
The invite screen said *"someone with that phone number already exists at this
school"* — about a number nobody held, with nothing on the form to correct, when
the real clash was the email address. It now names the address and the person
holding it. The same fault was fixed on the Add-member screen last sprint; the
invite screen had been missed.

## Who can do what

Creating a login from HR needs permission to manage **users** as well as **HR**;
adding an employment record from the invite screen needs permission to manage
**HR** as well as **users**. If you hold only one of the two, the other section
simply is not there — not greyed out and unexplained.

## Two things QA caught before this reached you

**A member of staff with only one name could not be given an employment
record.** The *Add an employment record* button on their profile refused to
save, asking for a first *and* last name — two fields that screen does not even
show. A great many people are recorded under a single name, and the same person
could be filed without complaint from the other screen, which made it look
arbitrary. It saves now, and the surname is simply left blank rather than filled
with a placeholder that would read like a real one.

**The staff list's "Has a login" filter listed people who had none.** Anyone who
had left the school and never had a login was being counted as having one. Both
halves of that filter are now exact: *Unlinked* shows current staff with no
login, *Has a login* shows only those who have one, and a resigned record with
no login appears in neither.

## What is not covered yet

**On the happy path, none of the three forms tells you the password-setup email
was sent.** They speak only when it could *not* be sent, which is the same way
the invite screen has always behaved. Nothing is lost — the email goes, and
*Send access email* on the person's profile will send it again — but if you want
positive confirmation on screen, say so and it is a small change.

**There is no bulk "link everybody by matching email address".** The two filters
find the split records and you link them one at a time. That is deliberate:
matching people by address is precisely what caused last sprint's problem, and a
wrong link here would put somebody on another person's payroll record.
