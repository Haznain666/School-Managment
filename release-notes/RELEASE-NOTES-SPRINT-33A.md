# Release notes — Sprint 33a: the three defects, the campus gap and the two notification faults

**Date:** 16 September 2026
**Part A of three.** Parts B (the Section Head role and HR leave) and C (the
portal work) follow, in that order.
**Migration:** `0046` — one column. It must be applied before this is deployed.

## Fixed

### A teacher could be timetabled into two lessons at once
The teacher portal showed 8:40–9:20 with one class followed by 9:05–9:45 with
another. Both rows were legal: a clash was only refused when the two lessons
used the **same period**, and those two periods belong to different bell
schedules — so nothing ever compared their times.

- Placing a lesson that overlaps one the teacher already has is now refused,
  and the refusal names the other class, the other period **and its times**.
- The timetable builder says so **before** the save, as soon as a teacher is
  chosen, rather than after the request comes back.
- A school with a single bell schedule sees no change at all.

**Existing overlaps are reported, never deleted.** The timetable screen now
carries a panel naming every teacher already double-booked, with both classes
and both clocks. Nothing is removed automatically — one of those two lessons is
a class somebody is sitting in, and choosing between them is the school's
decision, not the software's.

### An attachment sometimes did not arrive the first time
A file sent from a teacher to a parent could appear on the second look but not
the first. The message and its file were saved as two separate steps, and the
recipient's screen was woken by the first one — so it fetched the message in the
gap before the file existed.

They are now one step. A message is never visible without its attachment.

### The notification sound rang for messages already read
Opening a portal page — any page, on any device — could replay the chime for
messages that had been read hours earlier.

- Reading a conversation now clears its pending notifications **on the server**,
  so reading on a phone silences the laptop.
- The chime never sounds for the conversation already open on screen, and a
  burst of messages is one chime rather than five.
- A genuinely new message still rings, once, on every portal.

### The unread-message email came every hour, for ever, with no link
It now goes **once a day**, stops after **five** unanswered days for any one
conversation, and starts again the moment that conversation is read.

Each email now links **straight to the conversation**. Opening the link goes to
the thread rather than to an inbox to search through.

### Leave could be approved for another campus
A campus-bound approver could not *see* another campus's leave application, but
could still approve one if they had its id. The approval and the read now both
check the campus, and refuse.

### "Days used" showed 0
On the leave form the day count sat at 0 until somebody typed over it. It now
fills in from the dates the moment both are set, says what it counted —
*"5 days (2 March – 6 March)"* — and stays editable for a half day.

## Deployment

`db/migrations/0046_sprint33a_chat_digest_count.sql` adds one column,
`chat_participants.digest_count`. It is a metadata-only change: no table
rewrite, no long lock, every existing row reads 0.

Nothing else in this release needs configuration. No new permission key, so the
permission matrix is untouched.

## Not in this part

- The Section Head role, the chain of command and HR leave management — Part B.
- The parent timetable, the fee receipt, the recipient picker and teacher
  availability — Part C.
- Payroll's disagreement with the KPI resolver about a teacher timetabled across
  two divisions, and the 35 stale-list screens. Both are out of scope for this
  round by decision.
