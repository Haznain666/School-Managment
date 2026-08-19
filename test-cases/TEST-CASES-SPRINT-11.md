# Test cases — Sprint 11: Communications

Traces to [`RELEASE-NOTES-SPRINT-11.md`](../release-notes/RELEASE-NOTES-SPRINT-11.md).
Migration `0022_sprint11_comms.sql`, applied.

**A sent announcement cannot be recalled.** Some recipients will have received an
email. Use a **test class with test guardians** for every case below, never a
real class — and read UC-S11-14 before starting, because there is no undo.

**The audience rule is the case most likely to fail quietly.** "Addressing a
class means the children **and their guardians**" — a notice about a Class 5 trip
that reached only the ten-year-olds "would have gone out and still not worked".
That failure looks like success on every screen.

---

## Composing and addressing

#### UC-S11-01 · An announcement can be addressed five ways — P2
**Role** School administrator (`comms.write`) · **Traces to** "everyone at the school… people in a role… classes, or individual sections", each narrowable "to one campus"
1. Compose one of each and check the recipient count before sending.
- **Expect** all five available, and the count plausible for each.

#### UC-S11-02 · Addressing a class reaches the children **and** their guardians — P1
**Role** School administrator · **Traces to** "A notice about a Class 5 trip that reached only the ten-year-olds would have gone out and still not worked, so a class audience is that class's families"
1. Address a class. Read the delivery report.
- **Expect** both the students and their guardians are recipients.
- **Fail** if only students. Everything on screen still says "sent", which is why this needs the delivery report to catch.

#### UC-S11-03 · Staff are reached by role, never by the class they teach — P1
**Role** School administrator · **Traces to** "Staff are reached by addressing their role, never by addressing a class they teach"
1. Address a class. Check whether its teachers received it.
- **Expect** they did not.
- **Fail** if teachers appear — a class audience is families, and a school addressing parents must not be quietly copying staff.

#### UC-S11-04 · A campus narrowing actually narrows — P1
**Role** School administrator · **Traces to** "Any of those can be narrowed to **one campus**"
1. Address all parents, narrowed to campus 1, at a two-campus school.
- **Expect** no campus 2 recipient in the delivery report.

#### UC-S11-05 · A scheduled announcement goes out within about a minute — P2
**Role** School administrator (`comms.send`) · **Traces to** "A scheduled announcement goes out within about a minute of its time"
1. Schedule one two minutes ahead.
- **Expect** it goes out within about a minute of that time.

#### UC-S11-06 · A schedule missed during downtime still goes out — P1
**Role** Operator · **Traces to** "If the server was down when that moment passed, it goes out when the server comes back rather than being skipped"
1. Schedule one, stop the application before the time, restart after it.
- **Expect** it sends on restart.
- **Fail** if it is skipped silently — the school believes it told the parents.

#### UC-S11-07 · Sending asks for confirmation and says whether email goes too — P2
**Role** School administrator · **Traces to** "**Sending asks for confirmation**, and says whether an email will go with it"
1. Send with and without the email box ticked.
- **Expect** the confirmation states which, each time.

---

## The notice board

#### UC-S11-08 · Each portal lists what the school sent them, newest first — P2
**Role** Parent, student, teacher · **Traces to** "an **Announcements** page listing what the school has sent them, newest first"

#### UC-S11-09 · The unread badge counts, and opening clears only what was shown — P2
**Role** Parent · **Traces to** "Opening the page clears what is on screen — not everything ever sent, because a reader who did not scroll to page two has not read page two"
1. With enough announcements to paginate, open page 1 only. Re-read the badge.
- **Expect** page 2's items are still unread.
- **Fail** if opening clears everything.

#### UC-S11-10 · A child who changed class still sees the old class's notice — P1
**Role** Parent · **Traces to** "A child who moves class in May still sees the notice their old class was sent in April, and never sees one addressed to a class they were not in"
1. Send to class A in April. Move the child to class B in May. Send to class B.
2. Open the child's notice board.
- **Expect** both notices; nothing addressed to a class they were never in.
- **Fail** either way — losing April's notice, or gaining one from a class they never joined. "What appears is decided by what the school actually sent at the time", which means the delivery log, not a live audience recomputation.

---

## Email and the delivery report

#### UC-S11-11 · The screen reports **queued**, never delivered — P1
**Role** School administrator · **Traces to** "The screen reports what was **queued**, never what was delivered"
1. Send with email to a large audience. Read the wording.
- **Expect** "queued".
- **Fail** on any claim of delivery — see UC-S00-11.

#### UC-S11-12 · A campaign to four hundred families does not run inside the request — P1
**Role** School administrator · **Traces to** "a mail server that has been measured at over a minute and a half per message. A campaign to four hundred families cannot run inside a page load at any speed"
1. Send with email to the largest audience available; time the response.
- **Expect** it returns promptly; the outbox fills and drains behind it.

#### UC-S11-13 · The four outcomes are distinct, and "No address" is not "Failed" — P1 · **NEEDS SEED**
**Role** School administrator · **Traces to** the outcome table, and "A failure is ours to retry; a parent with no email address is the school's to fix, and it is the only one of the four an office can do something about today"
1. Send with email to an audience including a guardian with **no** email address, and with SMTP misconfigured for at least one send.
2. Read the delivery report.
- **Expect** **Sent**, **Queued**, **Failed** and **No address** used correctly and kept apart.
- **Fail** if a guardian with no address is reported as Failed — the platform would retry forever something only the office can fix.

---

## Immutability

#### UC-S11-14 · A sent announcement cannot be edited or deleted — P1
**Role** School administrator · **Traces to** "People have already read it, some of them in an email that cannot be recalled, and the delivery log is the record that answers 'did we tell the parents'"
1. Send one. Attempt to edit and delete it — by screen and by route.
- **Expect** refused both ways.
- **Fail** if the API permits what the screen forbids.

#### UC-S11-15 · Announcements are plain text, and line breaks survive — P3
**Role** School administrator · **Traces to** "**Announcements are plain text.** The line breaks you type are kept; there is no formatting, no attachments and no images"
1. Send text with deliberate line breaks and some HTML-looking characters.
- **Expect** breaks preserved; no markup rendered on the board or in the email. `db/schema/email-outbox.ts` warns about "sending markup to someone's phone".

---

## Permissions

#### UC-S11-16 · `comms.write` without `comms.send` prepares but cannot release — P1
**Role** Coordinator, marketing · **Traces to** "Writing and sending are deliberately separate, so a coordinator or the marketing staff can prepare a notice that a head releases"
1. As a coordinator, write and schedule. Attempt to send, by button and by route.
- **Expect** write succeeds, send refused.

#### UC-S11-17 · The default holders match the table — P2
**Role** School administrator · **Traces to** the permissions table in the note
1. Compare the default matrix against: `comms.read`/`comms.write` — admin, branch admin, principal, vice principal, coordinator, marketing; `comms.send` — admin, branch admin, principal, vice principal.
- **Expect** exact match.

#### UC-S11-18 · `comms.read` shows who a notice reached — P2
**Role** Principal · **Traces to** "see announcements and who they reached"

---

## Migration and delivery-report integrity

#### UC-S11-19 · The permission constraint accepts the three `comms.*` keys — P1 · **AUTOMATED**
**Role** Operator, database · **Traces to** "the per-school permission constraint widened to accept the three `comms.*` keys"
1. Confirm the CHECK constraint accepts all three. See UC-S08-08.

#### UC-S11-20 · The delivery log is written once at send — P1
**Role** Operator · **Traces to** "The delivery log is written once at send and is what the notice board reads"
1. Send to a class; then change the class membership.
2. Re-read the delivery report and the notice boards.
- **Expect** unchanged — the log records who it went to at the time, not who is in the class now.

#### UC-S11-21 · The send outcome is shown, not discarded — P1
**Role** School administrator · **Traces to** the Sprint 12 note: "the composer **discarded the send outcome**, so the unreachable count was computed, stored and never shown to anybody"
1. Send to an audience containing unreachable recipients.
- **Expect** the unreachable count is **shown to the sender**.
- **Fail** if it is only in the database. A figure computed and never displayed is one nobody acts on, and this is a fixed defect that can regress.

---

## Not in this release

- **A delivery-report screen.** The report is computed and the composer shows a
  count, "but there is no page yet listing *which* parents had no email
  address". That list is the thing an office acts on. Do not raise it; it is one
  screen away and known.
- **Editing an unsent announcement from the screen** — the API supports it, the
  composer does not.
- **WhatsApp delivery** — modelled, gated behind the paid add-on, sends nothing.
- **GoHighLevel Social Planner** — deferred to Sprint 22.
