# Sprint 25 — chat, part 2

Six items. Migration `0041`. Sprint 24 is on branch `claude/session-f506c4`,
PR #58, **not yet merged** — this sprint builds on that branch.

Product decisions taken 2026-09-04, all confirmed:

| Question | Answer |
| --- | --- |
| Real-time | Live delivery **and** Web Push. Both. |
| 30 students, one message | One private thread each. Never a 30-person thread. |
| Removal dialog | Hard delete **and** withdrawal/transfer-out. Not graduation. |
| Attachments | **Staff only**, students and parents text-only. **2 MB max.** |

---

## 1. Broadcast — compose once, thirty threads

**The shape, and why it cannot be anything else.** `chat_participants` carries
`chat_participants_one_student_idx`, a partial unique index making a second
pupil in a conversation a `23505`. A genuine thirty-person thread is therefore
not a thing this schema can hold, and that is deliberate — it is the control
that makes pupil-to-pupil messaging impossible. So a broadcast **fans out**:
one composition, N individual `direct` conversations, each private between the
teacher and one recipient.

No recipient ever learns who else received it.

### Selection

On the teacher and admin composer, a recipient picker offering:

- **A whole class** — every actively enrolled pupil in a section the sender may
  reach (`listTeacherSections` for a teacher; branch scope for an admin).
- **Named pupils** — multi-select within those classes.
- **The parents of either** — a switch, because "tell the class" and "tell the
  parents" are different messages and a teacher wants both separately.

Reuse `components/ui/MultiSelect.tsx`. Do not build a new one.

### The record

`chat_broadcasts` holds the composition once — sender, subject, body, a
human-readable scope label ("Class 7-B", "5 students"), and the recipient
count. Every conversation it created carries `broadcast_id`.

Two reasons it is a table rather than nothing: a teacher must be able to see
"sent to 7-B, 30 recipients" as **one** row in a sent list rather than thirty,
and a broadcast that half-failed must be diagnosable.

### Limits

- **`MAX_BROADCAST_RECIPIENTS = 200`.** A blast-radius limit, not a page size.
- Every recipient goes through `initiateProblem` individually. A pupil under a
  live deny is skipped, not refused — the broadcast reports
  `sent: 28, skipped: 2` with reasons rather than failing whole.
- Student contact hours apply. A broadcast to pupils at 11pm is refused
  outright, before any thread is opened.
- **Fan-out is chunked and sequential**, not `Promise.all`. Thirty threads is
  thirty transactions; a shared plan does not want them at once.

### Route

`POST /api/school/chat/broadcasts` — `{ sectionIds[], studentProfileIds[],
includeParents, includeStudents, subject, body }`, gated `chat.send`.
Returns `{ broadcastId, sent, skipped: [{name, reason}] }`.

---

## 2. Real-time — Supabase Realtime, replacing the poll

`@supabase/supabase-js` **is already a dependency** (2.112.2). The earlier note
in `useChatStream` claiming otherwise is wrong and must be deleted.

- `0041` runs `ALTER PUBLICATION supabase_realtime ADD TABLE chat_signals;`
  The publication exists and is currently empty.
- `chat_signals` already has RLS and a SELECT policy keyed on `auth.uid()`, so
  a subscriber receives only their own rows. Nothing about that changes.
- The browser client needs the project URL. **Do not add
  `NEXT_PUBLIC_SUPABASE_URL`** — a `NEXT_PUBLIC_*` value is baked at build time,
  so changing it on Hostinger requires a rebuild. Serve it instead from
  `GET /api/school/chat/realtime-config`, which returns
  `{ url, anonKey }` for a signed-in caller. The anon key is public by design.
- `useChatStream` keeps its exact signature. Subscribe to
  `postgres_changes` INSERT on `chat_signals`; **fall back to the existing poll**
  when the socket fails to connect or drops, and say which is live so the QA
  agent can prove both paths.
- On reconnect, call the existing `/chat/signals?since=` catch-up before
  trusting the socket — a socket that was down delivered nothing.

The signal still carries `{conversationId, messageId}` and nothing readable.
That contract does not change; only the transport under it does.

---

## 3. Web Push

- Add `web-push`. Keys are `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, both
  **server-only**; the public key reaches the browser through
  `GET /api/school/chat/realtime-config` alongside the Supabase values, for the
  same build-time reason.
- `push_subscriptions` — one row per browser per person. `endpoint` is unique.
- `app/sw.js/route.ts` gains `push` and `notificationclick` handlers. It is
  currently a cache-only shell with neither.
- A push carries **no message body** — the sender's name and "sent you a
  message", and a URL. Same reasoning as `chat_signals`: a push notification
  renders on a lock screen.
- Sending is **fire-and-forget from a sweep, never inside the request**. A `410
  Gone` or `404` from the push service means the subscription is dead — delete
  the row, do not retry.
- Respect quiet hours and `notification_preferences.email_chat`'s sibling: add
  **`push_chat`** rather than reusing the email flag. A person may want a buzz
  and not an email.
- iOS only delivers after the site is added to the home screen. Say so in the
  UI beside the enable button rather than letting it silently not work.

---

## 4. Sound

- **One sound, chosen here, not selectable.** Generate it with the WebAudio API
  — two short sine tones, roughly 880Hz then 1320Hz, ~90ms each, gain
  enveloped to avoid a click. No audio file ships, nothing is fetched, and it
  works offline.
- `chat_settings.sound_enabled boolean not null default true`.
- A toggle **on the chat screen of every portal** — that is "the setting in each
  portal", and the chat screen is where somebody who just heard the sound will
  look for it. Also surface it in `/parent/settings` beside the email
  preferences.
- Browsers refuse audio before a user gesture. Create the `AudioContext` lazily
  on the first click anywhere in the workspace and keep it; never construct one
  on mount, and never log a warning when playback is refused.
- Do not play the sound for your own message.

---

## 5. Student removal — the three-option dialog

**Triggers:** hard delete of a student, and withdrawal / transfer-out.
**Not** graduation — the promotion run graduates a whole year group at once and
thirty dialogs is not a decision anybody can make.

The dialog offers exactly three, and each is its own ruling:

| Button | Does |
| --- | --- |
| **Cancel** | Nothing at all. The student is not removed. |
| **Continue without disabling** | Removes the student. Leaves the pupil's and guardians' portal accounts active. |
| **Disable and continue** | Removes the student **and** deactivates the pupil's account plus every guardian who has no other enrolled child. |

### The rule that is not optional

**A guardian with another child still enrolled is never deactivated**, whichever
button is pressed. One family, one login — deactivating a father because his
eldest left would lock him out of his other three children's fees. Compute this
from `student_guardians` → `student_profiles` → `student_enrollments` with
`status = 'active'`, excluding the student being removed.

Record `deactivated_at` and `deactivated_reason` on `school_users` so the
reason survives. "Why can this parent not sign in" is a support call.

The dialog is a client component over the existing `Modal`. The **API takes the
choice as a parameter** (`disablePortals: boolean`) rather than inferring it —
a dialog is a courtesy to the clerk, the server is the rule.

Freeze the student's conversations in the same operation, as Sprint 24 already
does on graduation (`freezeConversationsOnDeparture`).

---

## 6. Attachments — staff only, 2 MB

- **`MAX_CHAT_ATTACHMENT_BYTES = 2 * 1024 * 1024`.** Stated once, enforced in
  the route and shown in the UI.
- **Only a staff role may attach.** A student or parent attempting it is
  refused server-side, not merely hidden. Every uploader is therefore a known
  adult accountable to the school, which is what removes the need for
  NSFW scanning in this sprint.
- Accept `image/png`, `image/jpeg`, `application/pdf` — the
  `lib/feedback.ts` list. **Sniff the bytes** with `sniffImageType`
  (`lib/image-signature.ts`) and store the sniffed answer, exactly as
  `student_documents` does; never trust the browser's `Content-Type`.
- Storage path via `buildStoragePath({ type: 'chat' })`, filename a fresh
  `randomUUID()` — `x-upsert` would otherwise let `photo.jpg` overwrite itself.
- Served **through a proxy route**, never a public URL:
  `GET /api/school/chat/attachments/[id]` → `downloadObject` +
  `attachmentResponse`. That is the feedback shape, not the student-documents
  shape, and the difference matters — `attachmentResponse` sets
  `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, which
  is what stops a PDF executing on the portal's origin.
- Max **one attachment per message**. Validate before uploading; clean up the
  object if the row insert then fails.

---

## Migration `0041`

`db/migrations/0041_sprint25_chat_part2.sql`, following `0040`'s form: prose
header, `── Step N ──` banners, `--> statement-breakpoint`, no `BEGIN`,
`IF NOT EXISTS`. Register as `idx: 41` in `meta/_journal.json`.

1. `chat_settings.sound_enabled` boolean not null default true
2. `chat_broadcasts` table
3. `chat_conversations.broadcast_id` uuid → `chat_broadcasts.id` set null, indexed
4. `chat_attachments` table (message_id cascade, storage_path, file_name,
   content_type, size_bytes, created_at) — `feedback_attachments`' shape
5. `push_subscriptions` table, unique on `endpoint`
6. `notification_preferences.push_chat` boolean not null default true
7. `school_users.deactivated_at`, `school_users.deactivated_reason`
8. `ALTER PUBLICATION supabase_realtime ADD TABLE chat_signals;`

Apply with `scripts/apply-0041.mjs`, verify with `scripts/verify-0041.mjs`,
both copied from the `0040` pair. **`drizzle-kit migrate` cannot be used** —
pooler port **5432**, session mode.

Write `SPRINT-25-DDL-NOTES.md`.

---

## Verification

- `scripts/check-sprint25.ts`, copied from `check-sprint24`. Every new statement
  executed against the real schema with a nobody tenant. Pre-migration failures
  must be **exactly** `42P01` / `42703`; anything else is a real defect.
- Add to the green build. All existing checks keep passing.
- `verify-0041.mjs` must prove, by trying: a broadcast cannot create a
  conversation with two pupils; a 2.1 MB attachment is refused; a student
  attaching is refused.
- Browser QA on all four portals, both transports (socket and poll fallback).

## Out of scope, deliberately

Voice notes. Student and parent attachments. Per-school retention purge
(the sweep exists; the schedule does not). Group threads — permanently.
