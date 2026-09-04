# Sprint 25 — one message to a whole class, and a chat that arrives instantly

Six things. The headline is that **a teacher writes once and a class of thirty
gets it** — and the rest is what makes chat feel like a live conversation rather
than a page you have to remember to refresh.

**There is a database migration — `0041`.** Three new tables, five new columns.
It changes no existing row. It has been applied and verified.

---

## Write once, reach a class

On the teacher's Messages screen: **Write to a class**. Pick a class, or tick
individual students, choose whether it goes to the students, their parents, or
both, and send.

Thirty people get it. You wrote it once.

### What they actually get, because this is the part to be clear about

**Thirty separate private conversations — not a group.** Each student gets their
own thread with you. **No student can see who else received it**, no student can
see another student's reply, and each of them can answer you individually.

That is deliberate, and it is not a limitation the software happened to have. A
class group chat is the thing this product will not build: students cannot be in
a conversation together, at all, and the database refuses it. Sending to thirty
people is a convenience for *you*; it changes nothing about what they can see.

Replies come back as thirty ordinary conversations in your inbox.

### If somebody cannot be reached, the send still goes

A student who has been banned from chat, or an account switched off since you
opened the picker, is **skipped** — and the confirmation names them and says
why. A message to thirty does not fail because one of them is blocked.

A parent with three children in your selection gets **one** message, not three.

Up to 200 people in one send.

---

## Messages now arrive instantly

They appear as they are sent, while the page is open — no refresh, no waiting.

If the live connection cannot be made, the portal quietly falls back to checking
every few seconds and nothing breaks; you would not notice the difference except
in speed.

## And there is a sound

A short two-tone chime when a message arrives.

**Turn it off from the chat screen** — the switch is right there at the top of
Messages, on every portal, because that is where somebody who just heard it will
look. Parents can also find it in Settings with the email preferences.

It never plays for a message you sent yourself.

There is one sound and no way to choose a different one. That is on purpose.

---

## Notifications on your phone

**Notify me on this device**, on the chat screen, asks your browser to send you a
notification when a message arrives — even when the portal is closed.

The notification says somebody has written to you. **It never shows the
message**, because a notification appears on a locked screen in front of whoever
is holding the phone.

Two things worth knowing:

- **On iPhone this only works if you add the site to your Home Screen first.**
  Safari does not deliver notifications to a site open in a tab. The button says
  so rather than pretending.
- Parents can switch it off separately from the email digest, in Settings. You
  may want your phone to buzz and no email about the same message.

> **Not yet switched on.** This release ships the whole thing, but a pair of keys
> has to be set on the server before any notification can be sent. Until that is
> done the button reports honestly and everything else works exactly as
> described — the hourly email digest still reaches people.

---

## Removing a student now asks what to do about the family's logins

Deleting or withdrawing a student gives you **three buttons**, and each one is
its own decision:

| | |
| --- | --- |
| **Cancel** | Nothing happens. |
| **Continue without disabling** | The student goes. The family keep their logins. |
| **Disable and continue** | The student goes **and** their portal access is switched off, along with any parent who has no other child at the school. |

### The rule that protects families, whichever button you press

**A parent with another child still enrolled is never switched off.** Not by
either button, not by accident, not ever.

A father with four children here does not lose his login because his eldest
left — he would still be paying three sets of fees and checking three sets of
results. The dialog **names** the parents this applies to before you choose, so
you can see exactly who is and is not affected.

Conversations about a departing student are closed and kept, read-only,
whichever button you press. A record of what was said is not something a
withdrawal should erase.

### Withdrawing a student is now possible at all

Deleting a student who has paid anything has always been refused, with a message
telling you to *withdraw them instead*. **There was no way to do that.** There
is now: it ends their placement and keeps the record, the fee history and the
conversations.

---

## Staff can attach files

Teachers and office staff can send a **photo or a PDF** with a message — up to
**2 MB**, in PNG, JPEG or PDF.

**Students and parents cannot attach anything.** They can still write; the
attach button is not there, and the server refuses it even if something tries.

That is the whole safety story, and it is deliberate: every person who can put a
file into this system is a member of staff the school employs and can hold to
account. Nothing is scanned because nothing needs to be — a file arrives with a
name attached to a job.

Files are checked by what they actually contain, not what they are called. A
program renamed `photo.png` is refused.

Attachments are never on a public web address. They are served only to people in
that conversation.

---

## Also in this release

- **Administrators can now read a student's conversation in full** when
  reviewing a report, rather than just the one message that was reported. The
  banner in every student conversation has always said this could happen; now it
  actually can. It is limited to conversations involving a student — a message
  between two members of staff stays private.

## What is still to come

Voice notes. Attachments for parents and students. Automatic clearing of old
conversations. Group conversations are **not** coming, and that is a decision
rather than a backlog item.
