# Sprint 24 — chat, and the rules that stop it becoming WhatsApp

**Parents, teachers, students and the office can now message each other inside
the portal.** This is the module that replaces WhatsApp, decided on 2026-08-07
and built now. There is no per-message cost, no phone network, and no third
party holding the conversation.

It is deliberately **not** a chat app. A conversation cannot exist unless
something in the school's own data justifies it — who teaches you, whose child
you are, which desk owes you an answer. Nobody gets a contact list, and a
student gets no directory at all.

**There is a database migration — `0040`.** Eight new tables and three new
columns; it changes no existing row. See `SPRINT-24-DDL-NOTES.md`. It has been
applied and verified.

**Chat is off until you switch it on.** It is a module, like Admissions or
Fees, and a school that is not ready simply leaves it off.

---

## Students cannot message each other. At all. Ever.

This is the first thing to say, because it is the thing schools ask about first.

There is no setting that turns it on, no administrator who can grant it and no
support request that will unlock it. **The database itself refuses a second
student in any conversation.** It is not a rule in the software that a future
change might miss — it is a constraint, and a message that broke it would be
rejected by Postgres before it was written.

The same applies to parents: two parents cannot write in one conversation. Both
parents *can* read their child's threads, which is different and deliberate.

What follows from that is most of what schools worry about. Students cannot form
their own groups here, cannot flood each other, and cannot pass anything between
themselves — because there is no conversation for it to happen in.

---

## Students reply. They start a conversation only when you let them

Every student can always **reply** to a message a teacher sends them. That needs
no setting and no permission.

Starting one is different, and it takes two separate yeses:

1. the teacher has said students may start a chat with **her** — a per-teacher
   setting, off by default, and one teacher turning it on does not turn it on
   for anybody else; and
2. somebody has **opened** chat for that student, that class, or that year
   group.

Either one alone is a no.

### Opening a class for two hours

On the teacher's Messages screen: pick the class, pick how long, press **Open
chat**. A live countdown shows what is open and **Close now** ends it early.

A student who joins that class halfway through the window is covered by it
automatically, and closing it is one click rather than thirty.

The same control, from the admin portal, can open a single student, a whole
year group or a campus — and can **ban** a named person from chat entirely.

### A ban outranks an opening, and stays outranked

If the Principal bans a parent, a teacher cannot lift it — not by opening the
class, and not by trying to delete the ban. The person who set it, or somebody
senior to them, is the only one who can.

This matters more than it sounds. Without it, the person a parent is complaining
about could quietly undo the head's decision, and nothing anywhere would say so.

**A ban must say why.** The field is required. A ban a parent cannot be told the
grounds for is one the school cannot defend.

---

## Nobody can be shouted at

**A student may have three messages waiting for an answer.** The fourth is
refused until a human replies.

This is stricter than a daily limit and much more useful: "twenty a day" still
allows twenty in twenty seconds. Three-unanswered cannot be flooded through at
any speed, because the next one needs another person to act first. It also makes
the whole thing feel like correspondence rather than a group chat, which is what
it is.

Students are also capped at three open conversations at once.

---

## When students can be messaged, and when they cannot

**Staff cannot message a student between 8pm and 7am.** The send is refused, not
delayed — so it is a thing a school can say did not happen.

Separately, any member of staff can set their own **quiet hours**. Those work
the other way: the message still arrives, and the email about it waits until
morning. One protects a child from being contacted; the other protects an adult
from being disturbed.

Both hours are adjustable per school.

---

## The reply window rolls; reading never stops

A student's window to reply is open for an hour by default — and **every time a
teacher writes back, it opens again**.

That matters because of the case it avoids: the student asks at two, the window
shuts at three, the teacher answers at ten in the evening, and the student
cannot reply. To the teacher that reads as being ignored.

**Reading is never time-limited.** A student can re-read what a teacher told
them about tomorrow's exam for as long as the conversation exists.

---

## Who can read a student's conversation, and everybody is told

- **The parents can read it.** Read-only — they cannot write into it.
- **The class teacher can read it.**
- **School administrators can review it.**

A banner at the top of every such conversation says so, to everyone in it,
including the student.

The disclosure is the point. A school is responsible for what adults say to
children on a platform it runs, and the way to be responsible about that is to
make the oversight visible rather than secret. Covert monitoring is
surveillance; monitoring everyone knows about is a deterrent.

---

## If a student writes something worrying, somebody is told immediately

Every message is scanned for language about self-harm and abuse. A match does
three things at once:

- it **emails the school's safeguarding lead straight away** — not into a queue
  somebody opens on Monday;
- it opens a report, marked as the most serious kind and sorted to the top; and
- it tells the student, in the conversation, that a member of staff has been
  told.

**The message is never blocked.** Refusing it would teach a child in trouble
that the school's own channel rejects them for saying so.

Set the lead's address in Chat settings. If none is set, every school
administrator is emailed instead — which is worse than a named person, and much
better than nobody.

---

## Reporting, and removing a message

**Anyone can report a message** — a parent, a student, a teacher. A "report"
button only staff can press protects the wrong people.

Reports go to a queue on the admin portal, most serious first. Closing one
**requires a sentence** saying what the school decided; "dismissed" with no
reason is what makes people stop reporting.

A message can be removed. **It is not deleted.** The bubble becomes *"Message
removed"* and names who removed it, and the original text stays in the record
for any investigation that follows.

That is the same rule the accounts ledger follows, for the same reason: a parent
disputing what a teacher said in March is asking about October, and a record
that can be edited answers "it says this now", which is not an answer.

---

## Parents write to teachers, and to the office

A parent can message the teachers who actually teach their children this year —
the list keeps itself up to date from the timetable — plus four desks:

**School Office · Accounts Office · Admissions · Principal's Office**

A desk is answered by whoever is on it. Whichever member of staff picks the
conversation up owns it, and if that person leaves the school the conversation
does not go with them. Two clerks opening the same enquiry cannot both claim it.

---

## Students can now sign in

They could not before. Every student had a record in the system but no way to
reach it.

**Chat settings → the lowest class that gets a sign-in.** Nothing is issued
until you set it, and it is deliberately blank to begin with — a school has not
agreed to give logins to children just because it switched chat on.

Then, from a student's record: **Issue sign-in**. You get an address and a
password to hand over.

Two things to know:

- **the address never receives email.** It exists so the system knows who the
  student is, and it is built so that nothing in the product can ever send mail
  to a child by accident;
- **there is no "forgot password" link**, and there cannot be one. A student who
  forgets comes to the office and you press the button again. That is the only
  identity check that does not depend on an inbox a child may not control.

---

## Links in student messages are not clickable

A student can type a web address and it stays plain text. It stops this being
the notice board where somewhere else gets arranged.

## Attachments

**There are none yet.** Text only, everywhere, for everyone. Photographs and
voice notes arrive in the next release with the checks that have to come with
them.

---

## Getting told there is something waiting

An unread conversation sends **one email an hour at most**, saying only that
something is waiting — never the message itself. It respects your quiet hours,
and parents can switch it off in Settings alongside the announcement, fee and
attendance emails.

Messages currently arrive within about eight seconds while the page is open.
**Push notifications to a phone are the next release**, and until they land the
email is what reaches a parent who has not opened the portal that day.

---

## What is not in this release

Groups, announcement channels, attachments, voice notes, push notifications and
automatic purging of old conversations. All are the next release.
