# Sprint 29 — the bell that had never rung for a message

**Branch:** `claude/realtime-message-notifications-41eb1a`
**Migration:** none. **`0045` is still the next free migration number.**
**Merged:** `e528e5d` (PR #69)

---

## What this sprint is

One defect, reported by the product owner against Lahore Grammar with a
screenshot of both sides of it, in one sentence:

> *"LGS Defence Principal has messaged Father 1 but Father 1 has no
> notification in the bell icon, no counter on Messages … except email
> notification, Father 1 has no way of knowing that a message has arrived, even
> though he is on the portal."*

No new feature. Chat has worked since Sprint 24 and the messages were arriving
correctly; what did not exist was any way to find out about one without opening
the chat screen and looking.

It turned out to be **three separate faults, one per surface**, and all three
were confirmed in the code before anything was written. The most direct
evidence: `notifications` held **zero** `chat_message` rows across the entire
estate. Not a few. None, ever.

---

## 1. Chat never wrote to the bell

Every other feature in the product writes a row to `notifications` when
something happens to somebody — feedback, announcements, holiday notices. Chat
did not. It had been given a transport of its own in Sprint 24 (`chat_signals`
and the websocket over it) and used that instead, and that transport reaches
exactly one screen.

So the bell was not broken. It was correct, and the table was empty.

**`lib/chat-notifications.ts` is the fix.** It writes **one entry per
conversation per recipient**: a conditional `UPDATE … RETURNING` that claims the
recipient's existing *unread* entry for that thread, and an `INSERT` only when
that claims nothing. A teacher sending five lines is one event to a parent, not
five, and the claim shape is the one `CLAUDE.md` requires — seven server
processes, and a read-then-`if` lets all seven decide to insert.

Two decisions inside it are worth stating because they are easy to get wrong
later:

**The entry carries no message text.** `lib/chat-digest.ts` already says it to
every parent it mails — *"Messages are not sent by email, this is only a note to
say something is there"* — and the bell is that same promise on a different
surface. The entry names the sender and the thread's subject and stops. It also
means a message redacted an hour later leaves no copy of itself sitting in a
bell panel that nothing would ever revisit.

**It sends no mail.** `notify()` is the door for everything that wants the bell
*and* the email, and it is the right door for every caller except this one.
Chat already owns its mail: one digest per person per hour, claimed so that
seven processes send one, honouring quiet hours and the per-category email
preference. Routing chat through `notify()` would have mailed a parent once per
message **and** again in the digest, which is how people turn a school's email
off altogether.

**Opening the thread clears it**, so the badge can go down as well as up. A
badge that only ever grows is a badge people stop reading.

---

## 2. The administrative sidebar had no Messages badge

The parent, teacher and pupil sidebars have carried an unread count on Messages
since Sprint 24. The administrative one never did — so on the portal where the
principal, the head of campus and every clerk actually work, Messages was a link
with nothing on it, and the only sign that a parent had written to the school
office was somebody deciding to go and look.

`schoolNav` now takes `unreadChats` and the layout reads it, wrapped exactly as
the bell's count beside it is, for the reason §5aw records: this layout runs on
every page of the portal, and an unguarded read against a schema that has not
caught up is a portal nobody can open.

---

## 3. The stream only ever ran on the chat screen

`useChatStream` — the socket and its poll fallback — was mounted inside
`ChatWorkspace`. Every other page of every portal was deaf. That is the whole of
the reported bug: a parent on their dashboard when a message arrived had no
bell, no badge and no sound, and learned about it from an email an hour later.

**`ChatStreamProvider` moves it into the four portal layouts.** One socket per
portal now serves every page. `ChatWorkspace` subscribes to it instead of
opening a second one — two Supabase clients, two channels and two poll loops
against the same table would have *worked*, which is what makes that kind of
waste the sort nobody finds.

Three things happen when a signal arrives, in order: the **chime**, which is the
only one that reaches somebody who is not looking at the screen; the
**subscribers**, which is the chat screen refetching exactly as it always did;
and the **counts**.

The chime's three rules — never on first paint, never for your own message,
never twice for the same one — are now properties of the table rather than of
what the screen remembers, because `postMessage` writes a signal for every
seated participant **except the sender**, one per message. The gesture that lets
a browser make a sound is listened for once at the document, so it works for a
parent who has clicked anything at all.

**The poll interval had to change.** The poll does not stop until a real signal
has arrived over the wire — so somebody who never receives a message polls for
ever. At 8 seconds on one screen that is nothing; at 8 seconds on every page of
every portal it is a request per user per 8 seconds against an origin measured
at ~1s uncached. The layout runs at 45s and the chat screen claims 8s while it
is mounted, read from a ref so changing it does not tear the socket down.

---

## What QA changed, and it was the important part

The first design moved the bell and the badge with `router.refresh()`. The
argument for it was good: the layout already recomputes every count on each
render, so a refresh updates all of them from the code that was already the
single source of truth, with no new endpoint to disagree with it.

**It does not work on the page the browser hard-loaded.** It fires the request;
on a page reached by client-side navigation it also updates the DOM; on a
hard-loaded page it does not. Measured four times either way against a
standalone production build — same URL, same message, same everything, the only
difference being how the page was reached.

That is exactly the wrong way round for the person this sprint is for. A parent
opens the portal by typing the address or following a link from an email, lands
on their dashboard, and sits there. **That page is always the hard-loaded one**,
so the sprint would have shipped working everywhere except the one place the bug
was reported.

So the counts are read explicitly, from `/api/school/unread-counts`, which calls
the same two functions the five layouts call and adds no arithmetic of its own —
two callers, one implementation. It is not polled: the provider asks when a
signal has arrived, which is the same discipline `NotificationBell` already
describes for itself.

`router.refresh()` is kept alongside it, demoted to what it can be relied on
for — re-rendering the page's own content for somebody who navigated here.
Nothing this sprint promises depends on it any more.

---

## Smaller things in the same change

- **A bell entry deep-links to its thread.** `/parent/chat?conversation=<id>`,
  and `ChatWorkspace` opens it — on a phone too, where the rule otherwise leaves
  you in the inbox, because this time the person clicked a notification about a
  particular conversation. Checked against the inbox before it is trusted: an id
  in a query string is untrusted.
- **The conversation id is also the dedupe key**, because it is already in the
  `href`. No column was added to hold a key the row already carried.
- **`sound_enabled` rides along with `/chat/realtime-config`**, which is now
  fetched once per page rather than once per visit to the chat screen. A second
  round trip for one boolean on every page of every portal is a cost with
  nothing behind it.
- **`PortalNavItem.liveBadge`** marks the entries the stream keeps current.
  Pending applications and unread notices go on using the server's count —
  nothing pushes those, and a stale number beats a request per page for one.

---

## Why there is no migration

`notifications.kind` is free-form by design and carries no CHECK — its own
docblock has said so since Sprint 16, and Sprint 27 added `announcement` the
same way. `chat_signals` was already in the `supabase_realtime` publication.
`chat_message` is documented in `NOTIFICATION_KINDS` so a reader can see the
set, and nothing in the database had to change.

**`0045` is still the next free migration number.**

---

## Verification

| | |
| --- | --- |
| `npm run check-sprint29` | **26 ok, 0 failed** against the real schema |
| Green build | all twelve, plus `check-portals`, `check-sprint24/25/26` |
| Browser | driven end to end as Father 1 at Lahore Grammar |

`check-sprint29` executes every new and widened statement. Because this sprint
adds no migration there is no predicted `42P01`/`42703` to hide behind — every
statement **must** execute, and a failure is a real defect. The dedupe is proved
by writing two notifications inside a transaction that is **always rolled
back**, requiring the second to claim the first, and reading the row count back
afterwards to prove nothing survived. A conditional `UPDATE … RETURNING` against
a tenant that matches no row is a read that returns nothing, and reporting that
as a pass is exactly the trap `CLAUDE.md` names.

The browser run signed in with `scripts/qa-emergency-link.mjs`, so **no password
was handled at any point**. Hard-loaded `/parent` as Father 1; the principal
wrote through the real `postMessage`; the chime played, the bell went to
*1 unread* and the Messages badge to *1*, with no reload and no navigation.
Opening the bell entry deep-linked to the right thread and cleared both badges.

Every row written during QA was removed, and both markers on the conversation
restored to the timestamps the pre-QA snapshot recorded.

---

## One thing not observed on screen

The **administrative** sidebar's Messages badge was asserted in
`check-sprint29`, not seen rendered. The platform operator's *Login as Admin*
seat has no `school_users` row — the chat screen says so in as many words — so
`unreadChats` is structurally 0 for the only administrative session QA can open
without a member of staff's own password. What is new there is the number being
passed; `PortalSidebar` renders `item.badge` with markup the other three
sidebars have used since Sprint 24.
