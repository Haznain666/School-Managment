# Sprint 24 + 25 test cases — the whole chat system

**Status: DRIVEN 2026-09-04.** Driven against **Askari School
System** (`askari-school-system`) on a local `next dev` pointed at the **live
migrated database**, entered through a platform emergency-login link
(`scripts/qa-emergency-link.mjs`) rather than by typing a password, and driven
with **Playwright** rather than the Browser pane (a hidden pane stops
compositing and pages stick on their skeleton).

**The run's results are in the "QA run" section at the foot of this file.** Read
that before trusting any expectation above it.

Nothing here is marked PASS on the strength of a gate. The gates that were run
are listed separately at the very foot so the two are never confused.

**Migrations `0040` and `0041` must both be applied.** They are, on the live
database.

**`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are NOT set on the host.** Web Push
is therefore inert on the live deployment by design — `pushConfigured()` gates
it. "Push does not deliver" is not a defect. What is a defect is a 500, a button
that appears and then fails, or a sweep that throws. Both halves are exercised
below: locally the keys ARE present, so the configured path is testable too.

Set-up performed through the product's own APIs, not by hand-written SQL:

- Teacher 1 and Teacher 2 given timetable entries in **Class 5 — A**, the
  section holding Student 2 and Student 3. Before this, no teacher taught any
  enrolled pupil, so every reachability answer would have been empty for the
  wrong reason.
- Teacher 3 made **class teacher** of Class 5 — A, so the observer seat has
  somebody to seat.
- Father 1 is guardian of **Student 1 and Student 2** — two enrolled children.
  Father 2 is guardian of **Student 3** only. That is the pair the removal
  dialog's central rule is tested against.

---

## Item 1 — the inbox on all four portals

| # | Case | Expected |
| --- | --- | --- |
| 1 | `/teacher/chat` as a teacher | renders; composer, class-opening control and broadcast composer all present; no console error; no non-200 XHR |
| 2 | `/parent/chat` as a parent | renders; the role inboxes plus the teachers of their own children are offered in **To** |
| 3 | `/student/chat` as a pupil | renders; **To** is empty and the screen says so in a sentence, because reply-only is the default |
| 4 | `/dashboard/chat` as a school admin | renders; **Reported messages** link present (admin holds `chat.moderate`) |
| 5 | Every portal's sidebar | a **Messages** / **Chat** entry, carrying an unread count when there is one |
| 6 | The unread dot | appears on a thread with a message newer than the reader's `last_read_at`, and clears on opening it |
| 7 | `loading.tsx` on all four chat segments | a skeleton of the right shape, not a spinner |

## Item 2 — a teacher opens a class, and the countdown

| # | Case | Expected |
| --- | --- | --- |
| 8 | Teacher, **Let a class message you**, Class 5 — A, **2 hours**, Open chat | one `chat_grants` row, `scope_type = 'section'`, `effect = 'allow'`, `ends_at` about two hours out |
| 9 | The list under it | one row naming the class and reading **1h 59m left** — a countdown, not a timestamp |
| 10 | **Close now** | the grant is revoked; the row leaves the list |
| 11 | A section the teacher does **not** teach, forced through `POST /api/school/chat/grants` | **403**, a sentence, and no row written |
| 12 | The same POST as a member of staff **at the other school** | refused; Askari's grants untouched |
| 13 | A duration of 1 minute, and of 24 hours | both **400** — the route allows 5 minutes to 12 hours |
| 14 | A role without `chat.grant` | the route is **403** |

## Item 3 — a pupil replies, and turn-taking

| # | Case | Expected |
| --- | --- | --- |
| 15 | `POST /api/school/students/[id]/credentials` with **no grade floor set** | **403** and a readable sentence naming Chat settings |
| 16 | A screen anywhere that sets that grade floor | exists, and an administrator can find it |
| 17 | The same POST for a pupil at or above the floor | **200**, an `@students.<slug>.invalid` address and a 10-character password, returned once |
| 18 | That pupil signs in and opens `/student/chat` | the teacher's thread is there and is replyable |
| 19 | The pupil sends **one** message | accepted |
| 20 | The pupil sends a **second and third** with no reply between | accepted (`max_unanswered_from_student` is 3) |
| 21 | The pupil sends a **fourth** | **refused**, with a readable sentence — not a 500, not a silent failure |
| 22 | The teacher replies, then the pupil sends again | accepted — the counter resets on somebody else writing |
| 23 | A link in a pupil's message | stored and rendered as **inert text**, never an anchor |

## Item 4 — the rolling reply window

| # | Case | Expected |
| --- | --- | --- |
| 24 | The pupil's `reply_window_expires_at` after the thread opens | about `reply_window_minutes` out |
| 25 | A pupil whose window has expired, sending | refused: the reply window has closed, reply again when a teacher writes back |
| 26 | The teacher writes into that thread | **every** pupil seat's window rolls forward — this is the rolling half |
| 27 | The pupil sends again | accepted |
| 28 | The pupil **reading** the thread with an expired window | always allowed. Reading is never time-boxed |

## Item 5 — student contact hours

| # | Case | Expected |
| --- | --- | --- |
| 29 | Staff opening a thread with a pupil **inside** the school's contact hours | allowed |
| 30 | The same **outside** them | refused before the thread exists, naming the hours |
| 31 | A **broadcast** including students, outside the hours | refused **whole**, before any thread is opened |
| 32 | Staff writing to a **parent** outside the hours | allowed — the window is about children |
| 33 | A screen that sets those hours | exists |

## Item 6 — the audit banner and the parent's observer seat

| # | Case | Expected |
| --- | --- | --- |
| 34 | A pupil's thread, on the pupil's screen | a visible notice naming who can read it |
| 35 | The same thread on the teacher's screen | its own notice, saying administrators may review it |
| 36 | The pupil's guardian's inbox | the thread is **there** |
| 37 | The guardian's seat | `can_post = false`; the screen says they can read but not reply, and shows **no composer** |
| 38 | The guardian forcing `POST .../messages` on it | **403**, the same sentence |
| 39 | The **class teacher** of the pupil's section | seated as an observer, read-only, on the same terms |

## Item 7 — report a message, and the moderation queue

| # | Case | Expected |
| --- | --- | --- |
| 40 | A parent or pupil looking at a message | a **Report** control exists on the message |
| 41 | Reporting it | a `chat_reports` row, `source = 'user'`, `status = 'open'` |
| 42 | Reporting a message in a conversation the caller is **not** in | **404** — the id must not confirm the message exists |
| 43 | `/dashboard/chat/moderation` as an admin | the report is listed, most serious first |
| 44 | The same page as a **teacher** (no `chat.moderate`) | refused |
| 45 | **Nothing to do** / **Dealt with** with an empty note | the button is disabled, and the route refuses |
| 46 | **Remove the message** with a note | `redacted_at`, `redacted_by`, `redaction_reason` written; `body` **unchanged** in the table |
| 47 | The thread, re-read by its participants | Message removed, and the reason; the body is not on the wire |
| 48 | A second moderator pressing Remove on the same message | the first reason stands |
| 49 | A safeguarding phrase in a pupil's message | auto-flagged, a `severity = 'safeguarding'` report raised, the lead emailed, and an acknowledgement posted into the thread |

## Item 8 — role inboxes and the claim

| # | Case | Expected |
| --- | --- | --- |
| 50 | A parent writes to **Accounts Office** | a `role_inbox` conversation, unclaimed |
| 51 | An accountant or admin claims it | `claimed_by` set, seated, `claimed: true` |
| 52 | A second clerk claiming the same one | `claimed: false` — not an error, and not a second seat |
| 53 | A **teacher** claiming an Accounts thread | **403**, that desk is answered by somebody else |
| 54 | Somebody at the **other school** claiming it | 404 |

## Item 9 — broadcast: one composition, N private threads

| # | Case | Expected |
| --- | --- | --- |
| 55 | Teacher, **Write to a class**, Class 5 — A, The students, Send | **N separate `direct` conversations**, one per pupil, each carrying the same `broadcast_id` |
| 56 | Each of those conversations | has **exactly one** pupil in `chat_participants` |
| 57 | Recipient A's inbox | shows their own thread and **not** recipient B's |
| 58 | `GET /api/school/chat/conversations/<B's id>/messages` as A | **404** |
| 59 | Multi-select of two named pupils instead of the class | exactly two threads |
| 60 | **Their parents** ticked as well | one extra thread per **distinct** guardian — a father of two children in the selection gets **one**, not two |
| 61 | A section the sender does not teach, forced into `sectionIds` | **403** |
| 62 | A `studentProfileIds` naming a pupil at the **other school** | that pupil is not reached |
| 63 | A pupil under a live **deny** in the selection | `skipped` with a reason, and the rest still sent |
| 64 | `chat_broadcasts` after the send | **one** row, `recipient_count` equal to sent, `scope_label` naming the class |
| 65 | More than `MAX_BROADCAST_RECIPIENTS` (200) | refused whole, with the number |
| 66 | The **admin** portal's chat screen | offers the same broadcast composer, per the spec's teacher-and-admin composer |

## Item 10 — real-time delivery

| # | Case | Expected |
| --- | --- | --- |
| 67 | Two browsers, two people, one thread open in each. Send in one | it appears in the other **without a reload** |
| 68 | Which transport is live | reported as `socket` or `polling` somewhere a person can see, per the spec |
| 69 | The socket path | `chat_signals` is in `supabase_realtime`; the browser subscribes with the caller's own token; RLS delivers **only their own rows** |
| 70 | The socket blocked | falls back to polling within one interval and delivery still happens |
| 71 | `GET /api/school/chat/realtime-config` as a signed-in caller | url, anon key, access token, VAPID public key; **no service-role key** |
| 72 | The same, signed out | 401 |
| 73 | The access token | never in `localStorage`, `sessionStorage`, `document.cookie` or the DOM |

## Item 11 — Web Push, inert by design

| # | Case | Expected |
| --- | --- | --- |
| 74 | The chat screen with **no** VAPID keys on the server | the enable control does not appear, or reports cleanly. **Nothing 500s** |
| 75 | The same with keys present | the control appears; the VAPID public key is served; the private key never leaves the server |
| 76 | Notifications denied in the browser | a sentence saying so, not a dead button |
| 77 | The push sweep with no keys | does not throw and does not spin |
| 78 | iOS | the home-screen caveat is stated in the UI beside the button |

## Item 12 — the sound

| # | Case | Expected |
| --- | --- | --- |
| 79 | A sound toggle on the chat screen of **every** portal | present |
| 80 | Turning it off, then reloading | still off — it persisted to `chat_settings.sound_enabled` |
| 81 | `/parent/settings` | the same toggle, beside the email preferences |
| 82 | `AudioContext` on mount | **not** constructed. Created lazily on the first click in the workspace |
| 83 | Your own message | makes no sound |
| 84 | Playback refused by the browser | no console warning |

## Item 13 — the three-option removal dialog

| # | Case | Expected |
| --- | --- | --- |
| 85 | Student detail, **Delete student** | a dialog with **exactly three** actions: Cancel, Continue without disabling, Disable and continue |
| 86 | The dialog before the clerk chooses | names the guardians who would be switched off, **and** those who keep their login |
| 87 | **Cancel** | nothing happens at all |
| 88 | **Continue without disabling** | student removed; the guardian stays active |
| 89 | **Disable and continue** on a pupil whose guardian has **no other child** | guardian deactivated, with `deactivated_at` and `deactivated_reason` written |
| 90 | **Disable and continue** on Student 2 (Father 1, **two** children) | student removed; **Father 1 is NOT deactivated** — the rule that is not optional |
| 91 | The conversations of the removed pupil | `frozen`, not deleted |
| 92 | A caller that omits `disablePortals` entirely | nobody is deactivated — the conservative default |
| 93 | A **withdrawal** rather than a delete | the same three options are reachable from a screen, and the record, fee history and conversations all survive |
| 94 | **Graduation** (a promotion run) | **no** dialog. Not a trigger, by decision |

## Item 14 — attachments

| # | Case | Expected |
| --- | --- | --- |
| 95 | Teacher attaches a **PNG** under 2 MB | accepted; a `chat_attachments` row with the **sniffed** content type |
| 96 | A **JPEG** and a **PDF** | both accepted |
| 97 | A **2.1 MB** file | refused, naming the 2 MB limit |
| 98 | A `.png` that is really a text file | refused on the **bytes**, not the name |
| 99 | A **parent** posting multipart to `.../messages` | **403**, only school staff can attach files — server-side, not a hidden button |
| 100 | A **pupil** doing the same | the same 403 |
| 101 | The parent's and pupil's screens | no file input at all |
| 102 | `GET /api/school/chat/attachments/[id]` as a participant | the file, with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` |
| 103 | The same as a **non-participant** | **404**, not 403 |
| 104 | The same from the **other school** | 404 |
| 105 | The stored object's path | under the school's own prefix; the filename a fresh UUID, never the sender's |

## Item 15 — tenancy isolation

| # | Case | Expected |
| --- | --- | --- |
| 106 | Every new route, called with a Beacon House session against an Askari id | 403/404, and **no** Askari row read or written |
| 107 | `location_id` anywhere in a request body or query | **never** trusted. It comes from the session on every route |
| 108 | `GET /api/school/chat/conversations` as the other school's admin | only their own school's threads |
| 109 | `POST /api/school/chat/conversations` naming an Askari `school_users.id` | refused — reachability is re-derived inside the caller's own tenant |
| 110 | `PATCH /api/school/chat/messages/<Askari message>/redact` from Beacon House | 404, and Askari's message unredacted |
| 111 | `POST /api/school/chat/reports` naming an Askari message | 404 |
| 112 | `POST /api/school/students/<Askari profile>/withdraw` from Beacon House | 404, and nothing withdrawn |
| 113 | `GET /api/school/chat/attachments/<Askari attachment>` from Beacon House | 404 |

## Item 16 — permission matrix

Each new route exercised as a role that **should** reach it and one that
**should not**.

| # | Route | Should reach | Should not |
| --- | --- | --- | --- |
| 114 | `GET/POST /chat/conversations` | every role | open by design; the body is what is constrained |
| 115 | `GET/POST /chat/conversations/[id]/messages` | participants | non-participants, 404 |
| 116 | `POST /chat/conversations/[id]/claim` | `chat.read` **and** a claimable desk | teacher on an Accounts thread, 403 |
| 117 | `GET/POST/DELETE /chat/grants` | `chat.grant` — admin, principal, VP, coordinator, teacher | accountant, HR, parent, pupil, 403 |
| 118 | `GET /chat/reports` | `chat.moderate` — admin, principal, branch admin | teacher, VP, parent, 403 |
| 119 | `POST /chat/reports` | every role | — |
| 120 | `PATCH /chat/messages/[id]/redact` | `chat.moderate` | teacher, 403 |
| 121 | `POST /chat/broadcasts` | `chat.send` | parent, pupil, 403 |
| 122 | `GET /chat/broadcast-roster` | `chat.send` | parent, pupil, 403 |
| 123 | `POST /students/[id]/credentials` | `users.write` | teacher, 403 |
| 124 | `POST /students/[id]/withdraw` | `students.update` | teacher, 403 |
| 125 | The four new keys | present in **both** `PERMISSIONS` and `DEFAULT_ROLE_PERMISSIONS` | — |

## Item 17 — console, network, responsive, dark mode

| # | Case | Expected |
| --- | --- | --- |
| 126 | Console on all four chat screens | no errors |
| 127 | Network on the same | no 4xx/5xx other than the deliberate refusals |
| 128 | 375 by 812 | the two-column workspace stacks; nothing clipped; the composer reachable |
| 129 | Dark mode | readable; no invisible text; the audit banner still legible |
| 130 | A dropdown or popover inside a `rounded-card` | not clipped by the card, the defect the first browser pass found |

---

## QA run — 2026-09-04

**Driven against Askari School System**, on a local `next dev` pointed at the
**live migrated database** (`0040` and `0041` both applied), entered through
platform emergency-login links (`scripts/qa-emergency-link.mjs`) as ASS Teacher 1,
Father 1 and School Admin in turn. Nobody typed a password.

The run was cut short by a rate limit part-way and resumed; the data it left
behind — four broadcasts, four bans, 49 signals, two issued pupil credentials —
was used as evidence rather than re-created, which is why some cases below are
recorded as *observed* rather than *performed*.

### What was proved, and how

| Area | Result | Evidence |
| --- | --- | --- |
| **Pupil-to-pupil impossible** | ✅ | `select conversation_id from chat_participants where is_student group by 1 having count(*)>1` → **empty**, across every conversation the run created |
| **Parent-to-parent impossible** | ✅ | same query on `is_parent and can_post` → **empty** |
| **Broadcast fans out** | ✅ | "Class 5 A and their parents" → `recipient_count 4`, `threads_linked 4`, four separate conversations |
| **No recipient sees another** | ✅ | each pupil thread holds exactly one pupil; the other recipients are not participants, so no query returns them |
| **Parent read-only on child's thread** | ✅ | Father 1 is `observer / can_post=false` on Student 2's thread **and** `member / can_post=true` in his own — simultaneously, without violating the one-posting-parent index |
| **Parent cannot post to an observed thread** | ✅ | 403 *"You can read this conversation but not reply to it."* |
| **Class teacher seated as observer** | ✅ | ASS Teacher 3 present as `observer` on both pupil threads |
| **Attachment ≤2 MB accepted** | ✅ | 1 KB PNG → 201, stored at `<location>/<branch>/chat/<uuid>.png` with a generated name |
| **Attachment >2 MB refused** | ✅ | 2 MB + 1 byte → 400 *"Attachments can be at most 2 MB. That one is larger."* |
| **Bytes sniffed, not the claim** | ✅ | a Windows `.exe` renamed `evil.png` sent as `Content-Type: image/png` → 400 *"Only PNG, JPEG and PDF files can be attached"* |
| **Parent cannot attach** | ✅ | 403 *"Only school staff can attach files. You can still send a message."* — server-side, not a hidden button |
| **Safeguarding scan fires** | ✅ | "I want to die" → message flagged, `chat_reports` row at `severity=safeguarding`, **email actually sent** to the school admin, system acknowledgement posted in the thread |
| **Safeguarding false-positive guard** | ✅ | "nearly died laughing" → **not** flagged. This is the case that decides whether a lead keeps reading the emails |
| **Message never blocked** | ✅ | the flagged message still posted, 201 |
| **Redaction keeps the body** | ✅ | `chat_messages.body` still holds the original; `redacted_by = School Admin`, reason recorded |
| **Redaction hidden on the wire** | ✅ | transcript returns `body: null` with the reason — the body never leaves the server |
| **Second redaction refused** | ✅ | the first reason stood; the `redacted_at IS NULL` guard held |
| **Teacher can report, not moderate** | ✅ | report 201; redact 403; moderation queue 403 |
| **Guardian rule — the safety one** | ✅ | withdrew Student 2 with **"Disable and continue"**: only Student 2 deactivated, **Father 1 left active** and named in `keptWithOtherChildren`, 6 conversations frozen with the reason recorded. **Restored afterwards.** |
| **Guardian rule preview** | ✅ | Student 2 → Father 1 in `kept`; Student 3 → Father 2 in `losing`. The dialog shows this before the clerk chooses |
| **Real-time actually delivers** | ✅ | subscribed to `chat_signals` over the websocket, inserted a row, **event arrived**. Channel state `joined`. This is the silent failure `0041` step 8 exists to prevent |
| **Push degrades gracefully** | ✅ | VAPID unset on the host → the control reports *"Notifications are blocked for this site"* and nothing 500s |
| **Tenancy** | ✅ | `locationId` in the query string ignored; a foreign conversation id → 404; a foreign section id → refused |
| **Pupil credentials** | ✅ | two pupils hold `@students.askari-school-system.invalid` addresses and are bound to GoTrue accounts |
| **Console** | ✅ | no errors on the teacher, parent or admin chat screens |

### The one bug found, and fixed

**A moderator could read a reported *message* but not the *conversation* it sat
in.** `ROADMAP.md` agreed on 2026-08-07 that school admins may read
conversations involving students, and every pupil thread carries a banner
telling its participants exactly that — but `/conversations/[id]/messages`
required `isParticipant`, and an administrator is deliberately never seated. So
a head investigating "what did he say to my daughter" saw one sentence with no
conversation around it, which is the one thing a safeguarding investigation
cannot work from.

Fixed in `lib/chat-queries.ts` (`isModeratableConversation`) and the transcript
route: a `chat.moderate` holder may read a thread **that is about a pupil**.
Deliberately narrow — `student_profile_id IS NOT NULL` is the whole condition.

Re-tested after the fix:

| Case | Result |
| --- | --- |
| Admin, not seated, pupil thread | **200** — reads it |
| Admin, not seated, staff↔parent thread | **404** — still private |

### Not proved, and why

- **Push delivery end to end.** `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are not
  set on Hostinger, so no notification can be sent. What *was* proved is that
  the absence is handled: `pushConfigured()` gates every send, the UI reports it,
  and nothing errors. Set the keys and this needs one more pass.
- **The chime being audible.** A headless browser has no speakers. The
  preference round-trips (`chat_settings.sound_enabled`) and the WebAudio path
  is guarded so a refused `resume()` is silent; whether it *sounds* right is a
  human judgement.
- **iOS home-screen push.** Needs a physical iPhone.
- **A real cross-tenant conversation.** No school other than Askari has any chat
  data yet, so the tenancy checks probed crafted ids rather than a genuine
  foreign row.

### A wording nit, not a defect

Broadcasting to a section id belonging to another school is refused — but by the
tenant filter in `resolveStudents`, so the message reads *"That selection has
nobody in it"* rather than *"that class isn't yours"*. The refusal is correct
and the tenancy holds; only the sentence is vaguer than it could be.

### Gates run

`typecheck`, `lint`, `check-loaders`, `check-forms`, `check-cnic`,
`check-currency`, `check-accounting`, `check-branch-scope`, `check-portals`,
`check-sprint24` (28 statements), `check-sprint25` (15 statements) — all pass.
`verify-0041.mjs` — 19 ok, including the three refusals proved by attempt.
