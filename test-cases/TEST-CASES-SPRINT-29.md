# Sprint 29 test cases — the bell that had never rung for a message

**Status: DRIVEN 2026-09-06** against **Lahore Grammar School** on the **live
database**, entered through a platform emergency-login link
(`scripts/qa-emergency-link.mjs`) rather than by typing a password. The build
exercised was the **standalone production artefact** (`npm run build`, then
`node .next/standalone/server.js`), not `next dev` — §5bp is what a dev server's
stale client bundle costs.

**The run's results are recorded in §"QA run" at the foot of this file** — read
that before trusting any expectation above it. Nothing here is marked PASS on
the strength of a gate or of reading the source; `check-sprint29` proves the SQL
executes and proves nothing whatever about whether a badge appears.

Every row below is something a person opens a browser and does.

Set-up, and the live rows every case is written against:

| | |
| --- | --- |
| Conversation `ed14e7f0` | Father 1 ↔ LGS Defence Principal, subject **"Hello"** |
| Father 1 | `parent`, has a sign-in, seated in `ed14e7f0` |
| LGS Defence Principal | `principal`, seated in `ed14e7f0` and in `e8221b26` |
| Before the run | **zero** `chat_message` rows in `notifications`, estate-wide |

⚠ **The seat trap.** *Login as Admin* signs you in as the platform operator, who
has **no `school_users` row** at any school. The chat screen answers *"No account
at this school"*, and `countUnreadNotifications` / `countUnreadConversations` are
structurally 0 for that session. **Cases 1–20 cannot be run from it.** Use
`node scripts/qa-emergency-link.mjs lgs <address>`.

⚠ **Running the standalone server locally starts `instrumentation.ts`**, so
every tenant's sweeps run against the live database from your machine. Stop the
server when you are finished, and scope any `email_outbox` assertion to the
school under test.

---

## Item 1 — the bell learns that chat exists

Traces to: *"Father 1 has no notification in the bell icon"*, and *"one entry per
conversation, not one per message"*.

| # | Case | Expected |
| --- | --- | --- |
| 1 | As **Father 1**, open `/parent`. Note the bell | accessible name **"Notifications"** — no badge |
| 2 | The principal sends one message in `ed14e7f0`. Reload | bell reads **"Notifications, 1 unread"**, badge **1** |
| 3 | Open the bell panel | one entry, **"New message from LGS Defence Principal"**, body **"Hello"** — the thread's *subject*, **not** the message text |
| 4 | Read the entry's `href` | `/parent/chat?conversation=ed14e7f0-…` |
| 5 | The principal sends a **second** message in the same thread. Reload | still **one** entry, not two; its timestamp has moved to the top |
| 6 | Open the thread from the bell entry | the deep link opens **that** conversation, on desktop and at 375px |
| 7 | Return to `/parent` | the bell entry for that thread is **cleared** — badge gone |
| 8 | The principal sends a **third** message | a **new** unread entry appears; the read one is not reused |
| 9 | Check `email_outbox` scoped to LGS either side of cases 2–8 | **unchanged** — the bell sends no mail; the hourly digest owns that |
| 10 | Redact a message, then re-read the bell entry | the entry never held the message text, so nothing leaks |

## Item 2 — the Messages badge

Traces to: *"no identifier / counter on Message"*.

| # | Case | Expected |
| --- | --- | --- |
| 11 | As **Father 1** with nothing unread, read the sidebar | **"Messages"**, no badge — not "Messages 0" |
| 12 | The principal writes. Reload | **"Messages 1"** |
| 13 | Open the thread, then go back to `/parent` | badge gone |
| 14 | As a **teacher** and as a **pupil**, repeat 11–13 | identical |
| 15 | As an **administrator** with an unread thread, read the sidebar | **"Messages 1"** — new in this sprint; see the note at the foot |
| 16 | A school with the `chat` module **off** | no Messages entry at all, on any portal |

## Item 3 — it happens while you are sitting there

Traces to: *"Father 1 has no way of knowing that a message has arrived, **even
though he is on the portal**"*.

**Case 17 is the sprint.** It must be run on a page reached by typing the
address, never by clicking a link from another page — that distinction is the
whole of the QA finding in §5bs.

| # | Case | Expected |
| --- | --- | --- |
| 17 | As **Father 1**, **hard-load** `/parent`. Click once anywhere (browsers refuse audio before a gesture). Leave it alone. The principal writes | within a few seconds and **with no reload**: the chime plays, the bell becomes **1 unread**, Messages becomes **1** |
| 18 | Repeat 17 having reached `/parent` by clicking **My Dashboard** from another page | identical |
| 19 | Repeat 17 on `/parent/fees` | identical — every page of the portal, not just the dashboard |
| 20 | With the thread open, the principal writes again | the message appears in the transcript; no double chime |
| 21 | Switch the sound off on the chat screen, then repeat 17 | badges move, **no chime** |
| 22 | Two tabs open on the same portal | each tab has its own socket and both update |
| 23 | Send yourself a message | **no** chime and **no** bell entry — the sender is excluded from the recipient list |

## Item 4 — what it must not cost

| # | Case | Expected |
| --- | --- | --- |
| 24 | On any non-chat page, watch the network for two minutes with the socket healthy | **no** `/chat/signals` polling once a signal has proved the wire |
| 25 | With Supabase unreachable, watch the same | polling at **45s**, not 8s |
| 26 | Open the chat screen and watch | polling at **8s** while it is mounted, back to 45s on leaving |
| 27 | Open the chat screen | exactly **one** Supabase socket for the portal, not two |
| 28 | Sign in to the **platform** portal (`/super-admin`) | the bell still works; no chat provider, no errors in the console |

---

## QA run — 2026-09-06

**Driven:** cases 1–9, 11–13, 17, 18, 19 and 23, as Father 1 at Lahore Grammar,
against the standalone production build on the live database.

| # | Result |
| --- | --- |
| 1–9 | **PASS.** Driven twice — once through the API path and once through `postMessage` directly. Case 5 confirmed one row, `created_at` bumped; case 8 confirmed a new row after a read. Case 9 verified with an LGS-scoped `email_outbox` count, unchanged. |
| 11–13 | **PASS.** |
| 17 | **PASS**, and it is the case that failed first. See below. |
| 18, 19 | **PASS.** |
| 23 | **PASS** by construction — `postMessage` excludes the sender when building the recipient list, and `check-sprint29` executes that statement. |
| 10, 14, 16, 20–22, 24–28 | **NOT RUN.** |

### Case 17 failed on the first implementation, and that is the sprint's finding

`router.refresh()` fires its request and **updates the DOM only on a page
reached by client-side navigation**. On a hard-loaded page it does not. Measured
four times either way: `/parent` hard-loaded, twice, no change; `/parent/fees`
and `/parent` after a soft navigation, both updated — same URL, same message,
same build. A plain reload immediately afterwards showed the correct counts, so
the server render was never in doubt.

Case 17 is the *only* one of the three that catches this, because 18 and 19 both
reach the page by navigation. A suite without case 17 would have passed a build
that failed for every real parent.

Fixed by reading the counts from `/api/school/unread-counts`, which calls the
same two functions the layouts call. Case 17 re-run against a fresh build:
chime, bell **1 unread**, Messages **1**, no reload.

### Two things about the environment, both of which cost time

- **The seat trap** at the head of this file. *Login as Admin* cannot exercise
  any of Item 1, 2 or 3.
- **Reading `auth.users` is blocked by the tool classifier**, so discovering a
  session's `auth.uid` that way is a dead end. The emergency link removes the
  need.

### Not observed on screen

**Case 15** — the administrative sidebar's badge. `check-sprint29` asserts
`schoolNav` emits `badge: 3` at three unread and omits it at zero, and
`PortalSidebar` renders `item.badge` with markup the other three sidebars have
used since Sprint 24. Producing an unread conversation for an administrator
needs a second member of staff's own session, which this run had no way to open.
**It is the one thing in this sprint nobody has looked at.**

### Tenant left as found

Seven QA messages, six bell entries and one planted signal deleted;
`chat_conversations.last_message_at` and Father 1's `chat_participants.
last_read_at` restored to the timestamps of the pre-QA snapshot
(`06:55:07.689Z` and `06:55:33.933Z`). Verified by reading both back.
