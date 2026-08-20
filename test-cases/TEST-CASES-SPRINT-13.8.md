# Test cases — Sprint 13.8: sibling identity, and the sweep that had never run

Traces to [`RELEASE-NOTES-SPRINT-13.8.md`](../release-notes/RELEASE-NOTES-SPRINT-13.8.md)
and [`RELEASE-NOTES-ANNOUNCEMENT-SWEEP-AND-DEPLOY.md`](../release-notes/RELEASE-NOTES-ANNOUNCEMENT-SWEEP-AND-DEPLOY.md).
Migration `0026`.

**"Two enrolled students are siblings when they share a guardian."** Before this
release nothing in the product linked one student to another, and the only screen
that knew two children were related was the family voucher.

⚠ **Cases 01–04 need two students who share a guardian and one who does not.**
The sibling rule matches on the guardian's CNIC *or* their phone number, so a
seed that gives every guardian a distinct number will pass 01 and prove nothing.
Seed at least one family whose two children share a CNIC and **not** a phone, and
one that shares a phone and **not** a CNIC — those are the two halves of the rule
and they fail independently.

---

## The sibling rule

#### UC-S138-01 · Siblings appear on the student profile — P1 · **NEEDS SEED**
**Role** School administrator (`admissions.read`) · **Traces to** "Siblings at this school"
1. Open a student who shares a guardian with another.
- **Expect** a **Siblings at this school** card naming each sibling, their **admission number**, their class, and the guardian they are shared through.
- **Fail** if the admission number is absent. Without it an admin must search the name and hope there is only one Fatima Khan.

#### UC-S138-02 · An only child shows no card at all — P1
**Role** School administrator
1. Open a student whose guardians guard nobody else.
- **Expect** no sibling card. Not an empty card, not "No siblings" — nothing.
- **Fail** if an empty card renders. Most students are only children at a school and a permanent empty box teaches an admin to stop reading that region.

#### UC-S138-03 · Matched on CNIC where the phone numbers differ — P1 · **NEEDS SEED**
**Role** School administrator · **Traces to** "two guardian rows are the same person when they share a CNIC **or** a phone number"
1. Two students; the same father recorded on both with the **same CNIC** and **two different phone numbers**.
- **Expect** each names the other as a sibling.
- **Fail** if they do not. This is the case the whole release exists for — a parent who gave a second number is still one parent.

#### UC-S138-04 · Matched on phone where no CNIC is recorded — P1 · **NEEDS SEED**
**Role** School administrator
1. Two students; the same mother on both, **same phone**, **CNIC blank on both**.
- **Expect** each names the other as a sibling.
- **Fail** if they do not. Every guardian enrolled before this release is in exactly this state; a rule that ignored them would un-relate every existing family.

#### UC-S138-05 · A half-recorded CNIC relates nobody — P1
**Role** School administrator · **Traces to** the migration's "left exactly as it is"
1. Two unrelated students whose guardians both have a **partial** CNIC stored (say 11 digits), different numbers, different phones.
- **Expect** neither names the other.
- **Fail** if they are shown as siblings. A partial identity number matching another partial is how the system invents a family that does not exist.

#### UC-S138-06 · A withdrawn sibling still appears — P2 · **NEEDS SEED**
**Role** School administrator
1. Open a student whose elder brother left last year.
- **Expect** he is listed, with **no class** beside his name and a badge saying he is not currently enrolled.
- **Fail** if he is hidden. He is the reason the school's records mention this family twice.

---

## The enrolment lookup

#### UC-S138-07 · The CNIC is the first field on the guardian step — P1
**Role** School administrator (`admissions.write`)
1. Start an enrolment and reach step 2.
- **Expect** **CNIC / Smart Card** is the first field on the guardian card, spanning the width, masked, with an eye toggle.
- **Fail** if it sits below the name. Asking after the name is asking after the clerk has already decided this is a new person.

#### UC-S138-08 · A known CNIC fills the card in and names the children — P1 · **NEEDS SEED**
**Role** School administrator · **Traces to** "the card fills itself in from the record the school already holds"
1. Type the complete CNIC of a guardian who already has a child at the school.
- **Expect** name, phone, email and occupation fill in, **and** a panel naming that guardian's existing children with their admission numbers.
- **Fail** if the clerk has to re-type the father. Any difference in spelling creates a second person, and the two children are then related by nothing.

#### UC-S138-09 · The lookup never overwrites what was typed — P1
**Role** School administrator
1. Type the guardian's **new** phone number first, then the CNIC of their existing record.
- **Expect** the phone you typed survives; only the empty fields fill in.
- **Fail** if the stored value replaces yours. The clerk is looking at the person; the database is looking at what was true last time.

#### UC-S138-10 · A partial CNIC returns nothing — P1 · **SECURITY**
**Role** School administrator
1. Call `/api/school/guardians/lookup` with 5, then 10, then 12 digits.
- **Expect** a refusal each time — no partial matching.
- **Fail** if a prefix returns anybody. The response carries a phone number, an email and children's names; a walkable prefix search is a directory dump.

#### UC-S138-11 · A converted application is looked up without a keystroke — P2 · **NEEDS SEED**
**Role** School administrator
1. Convert an accepted application whose guardian CNIC matches an existing parent.
- **Expect** the family panel appears on load, before the field is touched.
- **Fail** if it only appears after typing. This is the case most likely to be a returning family and the clerk never touches that field.

---

## Guardian rules

#### UC-S138-12 · The first guardian cannot be "Other" — P1
1. On a new enrolment, open the first guardian's Relationship dropdown.
- **Expect** only Father, Mother and Sibling.
- **Fail** if Other or Guardian is offered.

#### UC-S138-13 · The server refuses it too — P1 · **SECURITY**
1. `POST /api/school/students` with the first guardian's relationship set to `other`.
- **Expect** a 400.
- **Fail** if it is accepted. The dropdown is a courtesy; a stale tab or a script must not get past it.

#### UC-S138-14 · Father and Mother are each available once — P1
1. Record a father, then add a second guardian.
- **Expect** Father is gone from the second card's dropdown.
- **Fail** if two fathers can be saved. A duplicate is what splits one family into two on the sibling lookup and the family voucher.

#### UC-S138-15 · "Other" demands a relation in words — P1
1. Choose Other on a second guardian and try to continue with the relation blank.
- **Expect** refusal, and a **Relation with this student** text field.
- **Fail** if a bare "Other" saves. It tells a teacher ringing the number nothing.

#### UC-S138-16 · Editing cannot get around the rules — P1 · **SECURITY**
1. Add a lawful second guardian as `guardian`, then `PATCH` them to `father` on a student who already has one.
- **Expect** a 409.
- **Fail** if it succeeds. Editing is the obvious way around a create-time check.

#### UC-S138-17 · Converting an application is the documented exception — P2
1. Convert an application whose applicant described themselves as `guardian`.
- **Expect** it succeeds.
- **Fail** if it is refused. A one-click conversion must not fail over a word a parent chose on a public form weeks ago; refusing loses the admission.

---

## The CNIC field, everywhere

#### UC-S138-18 · Every CNIC field is the same field — P1
**Traces to** the `check-cnic` rule
1. Visit the enrolment guardian step, the guardian panel on a profile, the public application form, and the staff record.
- **Expect** all four masked, all four with an eye toggle, all four reformatting to `42101-1234567-1` as you type.
- **Fail** if any is a plain box. Two spellings of one number are two people to every query and look identical on screen.

#### UC-S138-19 · Blank is always allowed — P1
1. Save a guardian and a staff member with the CNIC empty.
- **Expect** both save.
- **Fail** if either is refused. An admissions desk with a queue will invent a number, and an invented CNIC is worse than an absent one now that the column decides who is related to whom.

#### UC-S138-20 · Any spelling is stored one way — P1
1. Enter `4210112345671`, then on another guardian `42101 1234567 1`.
- **Expect** both stored as `42101-1234567-1`, and the two treated as the same person.
- **Fail** if the column holds two spellings.

---

## The parent portal

#### UC-S138-21 · The header names the child being read — P1 · **NEEDS SEED**
**Role** Parent with **two or more** children
1. Sign in and look at the header on every screen.
- **Expect** a **Viewing** dropdown naming each child with their admission number; choosing one re-reads the page for that child.
- **Fail** if it is missing on any parent screen.

#### UC-S138-22 · One child is text, not a control — P1
**Role** Parent with one child
- **Expect** the name shown as plain text, no dropdown.
- **Fail** if a one-option dropdown renders.

#### UC-S138-23 · `?child=` reaches nobody else's record — P1 · **SECURITY**
**Role** Parent
1. Edit the URL to `?child=<another family's student id>`.
- **Expect** their own first child, silently.
- **Fail** if any other child's data appears. The portal scopes by the account link, never by the sibling rule — a household sharing a phone must not become a shared login.

#### UC-S138-24 · Every guardian can be invited — P2
1. On a student with two guardians who both have email addresses, look at the guardian panel.
- **Expect** each can be sent a portal invite independently.
- **Fail** if only the primary contact can.

---

## Super Admin

#### UC-S138-25 · Super Admin sees no family data — P1 · **PRIVACY**
1. Search the super-admin panel for any sibling or family surface.
- **Expect** none.
- **Fail** if a platform operator can read which children are related. This is deliberate and should stay that way.

---

## The announcement sweep

#### UC-S138-26 · A scheduled announcement is released — P1
**Role** School administrator (`comms.send`)
1. Schedule an announcement for two minutes from now. Wait.
- **Expect** it moves to **Sent** within about a minute of its time, appears on the notice board, and queues email if email was chosen.
- **Fail** if it stays **Scheduled** with its time in the past. That was the state of every scheduled announcement at every school before this release.

#### UC-S138-27 · A backlog is sent, not skipped — P1
1. Schedule one for a time already past.
- **Expect** it goes out on the next sweep.
- **Fail** if it is skipped as stale. A process that was down for an hour must send what it missed. ⚠ **Tell schools this before upgrading** — anything left scheduled with a past date will go out.

#### UC-S138-28 · Every parent receives exactly one copy — P1 · **REGRESSION**
**Role** Parent · **Traces to** the seven-process claim
1. Schedule an announcement with email to an audience of at least two parents.
2. Count the messages in each inbox, and the rows in the email queue.
- **Expect** exactly one per recipient.
- **Fail** on two or more. Production runs seven sweeper processes; before the atomic claim all seven would have queued a full run.

#### UC-S138-29 · A failed send is retried, not lost — P2
1. Make one send fail (unreachable SMTP, say) and watch the announcement's status.
- **Expect** it returns to **Scheduled** and the next sweep retries it.
- **Fail** if it is left as **Sent** having delivered nothing. The claim marks it sent before the work; the revert is what stops that becoming a lie.

#### UC-S138-30 · Sending immediately still works — P1 · **REGRESSION**
1. Press Send now on a draft.
- **Expect** unchanged behaviour.
- **Fail** on any change. This path was never broken and the claim rewrote the code it runs through.

---

## Existing data

#### UC-S138-31 · Families already on the roll are still families — P1 · **REGRESSION**
**Traces to** "the two keys are unioned, not ranked"
1. Before upgrading, note a family that the **family voucher** groups. Upgrade. Generate vouchers for the same month.
- **Expect** the same grouping.
- **Fail** if it splits. A father carrying a CNIC on a new child and none on the elder one must stay one family — this is the regression the union-find exists to prevent.

#### UC-S138-32 · Malformed CNICs were not guessed at — P1 · **DATA**
1. After migration `0026`, read any `student_guardians.cnic` that was not exactly thirteen digits.
- **Expect** unchanged, character for character. Production held a 32-character value; it must still be 32 characters.
- **Fail** if it was truncated into a plausible CNIC. That would invent a relationship between two unrelated children.

---

## Deployment

#### UC-S138-33 · A missing secret is named before the build — P2
1. Run *Deploy to Hostinger* with a required secret cleared.
- **Expect** failure within seconds naming that secret.
- **Fail** if it fails eight minutes later inside `ssh-keyscan`, or names only a step variable.

#### UC-S138-34 · An unverified deploy says so — P2
1. Run a deploy with `PRODUCTION_URL` unset.
- **Expect** success, with a warning that nothing confirmed the site is serving.
- **Fail** if the deploy is marked failed. Failing a deploy whose upload and restart both succeeded is the worst possible moment to report failure.

#### UC-S138-35 · School portals resolve — P1
1. Open `https://<slug>.schoolhub.codexmill.com/login`.
- **Expect** the school's sign-in page.
- **Fail** on a "school not found" page. ⚠ Note the hostname: schools are one label under the **platform** domain, not under the apex. `<slug>.codexmill.com` is not a thing and never was.
