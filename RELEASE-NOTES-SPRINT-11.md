# Release notes — Sprint 11: Communications

**Status:** merged to `main`. **Not yet live — one database migration must be
applied first.** See *Before this can be used*, below.

Schools can now tell people things. An announcement goes to a notice board on
every portal it is addressed to, and — when the sender asks for it — to those
people's email as well. Every send keeps a record of who it reached and who it
could not.

---

## Before this can be used

**`db/migrations/0022_sprint11_comms.sql` has not been applied to the live
database.** The three tables it creates do not exist yet, so every screen in
this release will fail until it runs.

```bash
npm run db:migrate
```

This is a production change: one Supabase project serves every school, so
applying it affects all of them at once. Nothing else in this release needs any
configuration.

---

## What a school gets

### Announcements

A new **Communications** screen in the admin sidebar. Write a notice, choose who
it is for, and either send it now or set a time for it to go out.

An announcement can be addressed to:

- **everyone at the school**
- **people in a role** — all teachers, all parents, all students, and so on
- **classes**, or **individual sections**

Any of those can be narrowed to **one campus**.

Addressing a class means the children **and their guardians**. A notice about a
Class 5 trip that reached only the ten-year-olds would have gone out and still
not worked, so a class audience is that class's families. Staff are reached by
addressing their role, never by addressing a class they teach.

### The notice board

Parents, students and teachers each get an **Announcements** page listing what
the school has sent them, newest first, with a **New** marker on anything they
have not opened and an unread count on the sidebar link. Opening the page clears
what is on screen — not everything ever sent, because a reader who did not
scroll to page two has not read page two.

What appears is decided by what the school actually sent at the time. A child
who moves class in May still sees the notice their old class was sent in April,
and never sees one addressed to a class they were not in.

### Email

Tick **Email it as well** and every recipient with an address on their record
gets the notice by email, signed with the school's name.

The screen reports what was **queued**, never what was delivered — it hands the
messages to the outbox and returns rather than waiting on a mail server that has
been measured at over a minute and a half per message. A campaign to four
hundred families cannot run inside a page load at any speed.

### The delivery report

Every send records, per person and per channel, one of four outcomes:

| Outcome | Means |
| --- | --- |
| **Sent** | On their notice board, or accepted by the mail server |
| **Queued** | Waiting in the outbox to go out |
| **Failed** | The channel tried and could not — the platform retries these |
| **No address** | Never attempted; there was no email address on their record |

The last two are kept apart on purpose. A failure is ours to retry; a parent
with no email address is the school's to fix, and it is the only one of the four
an office can do something about today.

### Who can do what

Three new permissions, editable per school on the existing permissions screen:

| Permission | Default holders |
| --- | --- |
| `comms.read` — see announcements and who they reached | Admin, branch admin, principal, vice principal, coordinator, marketing |
| `comms.write` — write and schedule | the same |
| `comms.send` — release it, and email it | Admin, branch admin, principal, vice principal |

Writing and sending are deliberately separate, so a coordinator or the marketing
staff can prepare a notice that a head releases.

---

## Things worth knowing before you use it

- **A sent announcement cannot be edited or deleted.** People have already read
  it, some of them in an email that cannot be recalled, and the delivery log is
  the record that answers "did we tell the parents". Send a follow-up instead.
- **Sending asks for confirmation**, and says whether an email will go with it.
- **A scheduled announcement goes out within about a minute of its time.** If
  the server was down when that moment passed, it goes out when the server comes
  back rather than being skipped.
- **Announcements are plain text.** The line breaks you type are kept; there is
  no formatting, no attachments and no images.

---

## Not in this release

- **A delivery-report screen.** The report is computed and the composer shows a
  recipient count, but there is no page yet listing *which* parents had no email
  address. That list is the thing an office acts on, and it is one screen away.
- **Editing an unsent announcement from the screen.** The API supports it; the
  composer currently creates, sends and discards only.
- **WhatsApp delivery.** The channel is modelled and gated behind the paid
  add-on, and nothing sends over it yet. Email plus the notice board is the
  path.
- **GoHighLevel Social Planner** — deferred to Sprint 22, where the rest of the
  integration work lives.

---

## Also on `main` in this push

**Exam charts** (Sprint 10.5, Task 1). The exam page now shows a grade
distribution, subject-wise averages and a pass rate, and the exams overview
compares the last six exams. Grades are bucketed by **the bands your school
configured**, through the same rule that grades the report card — two schools
with identical marks see different charts, and the chart cannot contradict the
document printed from the same marks. Students absent from a paper are in no
grade band and no pass rate, and each chart says who it left out.

Needs no migration and no configuration.

---

## Verification

`typecheck`, `lint`, `build`, `check-theme` and `check-dashboard` are all green.

**Nothing in this release has been seen in a browser with a real school's data.**
Signing in has never worked from a development machine, which is a standing
limitation recorded in `STATE.md` §5d — it is not specific to this sprint. The
first person to use these screens against the live database will be the first
person to see them at all.
